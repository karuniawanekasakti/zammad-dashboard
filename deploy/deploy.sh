#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE=(docker compose --env-file .env -f docker-compose.yml -f deploy/docker-compose.prod.yml)

log() { printf '\033[1;34m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mWarning:\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

load_deploy_env() {
  DEPLOY_BRANCH="${DEPLOY_BRANCH:-$(env_value DEPLOY_BRANCH || true)}"
  DEPLOY_BRANCH="${DEPLOY_BRANCH:-master}"
  DEPLOY_PULL="${DEPLOY_PULL:-$(env_value DEPLOY_PULL || true)}"
  DEPLOY_PULL="${DEPLOY_PULL:-false}"
  DEPLOY_BIND_HOST="${DEPLOY_BIND_HOST:-$(env_value DEPLOY_BIND_HOST || true)}"
  DEPLOY_BIND_HOST="${DEPLOY_BIND_HOST:-127.0.0.1}"
  DEPLOY_HTTP_PORT="${DEPLOY_HTTP_PORT:-$(env_value DEPLOY_HTTP_PORT || true)}"
  DEPLOY_HTTP_PORT="${DEPLOY_HTTP_PORT:-8080}"
  DEPLOY_HEALTH_HOST="${DEPLOY_HEALTH_HOST:-$(env_value DEPLOY_HEALTH_HOST || true)}"
  DEPLOY_HEALTH_HOST="${DEPLOY_HEALTH_HOST:-$DEPLOY_BIND_HOST}"
  if [[ "$DEPLOY_HEALTH_HOST" == "0.0.0.0" ]]; then
    DEPLOY_HEALTH_HOST="127.0.0.1"
  fi
  BASE_URL="http://${DEPLOY_HEALTH_HOST}:${DEPLOY_HTTP_PORT}"
}

usage() {
  cat <<'USAGE'
Usage: ./deploy.sh [deploy|status|logs|health]

Environment knobs:
  DEPLOY_BRANCH=master        Branch to warn against when deploying
  DEPLOY_PULL=false           Set true to git pull before building
  DEPLOY_BIND_HOST=127.0.0.1  Host interface for the web container
  DEPLOY_HTTP_PORT=8080       Host port for the web container
  DEPLOY_HEALTH_HOST=...      Host used by curl health checks
USAGE
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

compose() {
  "${COMPOSE[@]}" "$@"
}

env_value() {
  local key="$1" line value
  [[ -f .env ]] || return 1
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" .env | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  value="${line#*=}"
  value="${value%$'\r'}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value#"${value%%[![:space:]]*}"}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

require_env() {
  local key="$1" value
  value="$(env_value "$key" || true)"
  [[ -n "$value" ]] || fail ".env must set $key"
  case "$value" in
    changeme|changeme-256bit-secret|dev-secret-change-in-production|replace-with-*|https://support.example.com|https://your-zammad.example.com)
      fail ".env contains placeholder value for $key"
      ;;
  esac
}

preflight() {
  log "[1/6] Checking environment..."
  require_cmd git
  require_cmd docker
  require_cmd curl
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not available"
  docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable"

  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Not inside a git work tree"
  [[ -f docker-compose.yml && -f deploy/docker-compose.prod.yml && -f deploy/Dockerfile.frontend ]] || fail "Run from the zammad-dashboard repo root"
  [[ -f .env ]] || fail "Missing .env. Create it on the server; do not copy local secrets blindly. See deploy/DEPLOYMENT.md."
  load_deploy_env

  require_env ZAMMAD_BASE_URL
  require_env ZAMMAD_API_TOKEN
  require_env ZAMMAD_WEBHOOK_SECRET
  require_env JWT_SECRET_KEY
  require_env DATABASE_URL
  require_env REDIS_URL
  require_env POSTGRES_PASSWORD
  require_env REDIS_PASSWORD

  if ! env_value CORS_ORIGINS >/dev/null; then
    warn "CORS_ORIGINS is unset. Same-origin proxying is fine; set it if using a separate frontend origin."
  fi

  local branch
  branch="$(git branch --show-current || true)"
  if [[ -n "$branch" && "$branch" != "$DEPLOY_BRANCH" ]]; then
    warn "Current branch is '$branch', expected '$DEPLOY_BRANCH'. Continuing."
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    warn "Working tree has uncommitted changes. They will be included in the Docker build."
  fi
}

pull_if_requested() {
  log "[2/6] Updating source code..."
  if [[ "$DEPLOY_PULL" == "true" ]]; then
    git pull --ff-only
  else
    printf 'Skipping git pull (set DEPLOY_PULL=true to enable).\n'
  fi
}

build_images() {
  log "[3/6] Building images..."
  compose build
}

migrate() {
  log "[4/6] Applying database migrations..."
  compose run --rm --no-deps api alembic upgrade head
}

start_containers() {
  log "[5/6] Starting containers..."
  compose up -d --remove-orphans
}

health() {
  load_deploy_env
  curl -fsS "${BASE_URL}/api/v1/system/health"
  printf '\n'
}

wait_for_health() {
  log "Running health check..."
  local attempts=30
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "${BASE_URL}/api/v1/system/health" >/tmp/zammad-dashboard-health.json 2>/dev/null; then
      printf 'Health: '
      cat /tmp/zammad-dashboard-health.json
      printf '\n'
      rm -f /tmp/zammad-dashboard-health.json
      return 0
    fi
    sleep 2
  done

  rm -f /tmp/zammad-dashboard-health.json
  warn "Health check failed at ${BASE_URL}/api/v1/system/health"
  compose ps >&2 || true
  compose logs --tail=80 api >&2 || true
  return 1
}

summary() {
  log "[6/6] Deployment summary"
  compose ps
  cat <<SUMMARY

Deployment completed successfully.
Local dashboard upstream: ${BASE_URL}
Health endpoint: ${BASE_URL}/api/v1/system/health

Configure the existing production Zammad reverse proxy to route the dashboard domain/path to:
  http://${DEPLOY_BIND_HOST}:${DEPLOY_HTTP_PORT}

Useful commands:
  ./deploy/deploy.sh status
  ./deploy/deploy.sh logs api
  ./deploy/deploy.sh health
SUMMARY
}

deploy() {
  preflight
  pull_if_requested
  build_images
  migrate
  start_containers
  wait_for_health
  summary
}

case "${1:-deploy}" in
  deploy) deploy ;;
  status) compose ps ;;
  logs) shift; compose logs -f --tail=200 "$@" ;;
  health) health ;;
  help|-h|--help) usage ;;
  *) usage; fail "Unknown command: ${1:-}" ;;
esac
