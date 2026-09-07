# Deployment

This project deploys with Docker Compose on the same Linux server that runs production Zammad. The dashboard binds to loopback by default so it does not take over Zammad's public `80/443` listener.

> This document is the server-setup runbook. Production releases are deployed automatically by GitHub Actions when a release tag is pushed — see [docs/CI-CD.md](../docs/CI-CD.md) for the release/deploy/rollback flow. The manual deploy below remains the fallback.

## Server prerequisites

- Docker with the Compose plugin (`docker compose version`).
- Git and curl.
- A checked-out copy of this repo.
- A server-owned `.env` file in the repo root.
- An existing public reverse proxy entry for the dashboard domain/path that forwards to `http://127.0.0.1:8080`.

The deploy script does not edit or reload the existing Zammad reverse proxy.

## Required `.env`

Create `.env` on the server. Do not copy local development secrets.

```dotenv
ZAMMAD_BASE_URL=https://your-zammad.example.com
ZAMMAD_API_TOKEN=replace-with-zammad-token
ZAMMAD_WEBHOOK_SECRET=replace-with-webhook-secret
JWT_SECRET_KEY=replace-with-256-bit-random-secret
POSTGRES_PASSWORD=replace-with-dashboard-db-password
REDIS_PASSWORD=replace-with-dashboard-redis-password
DATABASE_URL=postgresql+asyncpg://postgres:replace-with-dashboard-db-password@db:5432/zammad_dashboard
REDIS_URL=redis://:replace-with-dashboard-redis-password@redis:6379/0
CORS_ORIGINS=[]
JWT_EXPIRY_HOURS=8

# Optional deployment knobs
DEPLOY_BIND_HOST=127.0.0.1
DEPLOY_HTTP_PORT=8080
DEPLOY_BRANCH=master
DEPLOY_PULL=false
```

Generate a JWT secret with:

```bash
openssl rand -hex 32
```

Required backend variables are read by `backend/app/config.py`: `ZAMMAD_BASE_URL`, `ZAMMAD_API_TOKEN`, `ZAMMAD_WEBHOOK_SECRET`, `JWT_SECRET_KEY`, `DATABASE_URL`, and `REDIS_URL`. `POSTGRES_PASSWORD` and `REDIS_PASSWORD` are used by Docker Compose to start this dashboard's private database/cache; keep them in sync with `DATABASE_URL` and `REDIS_URL`.

Frontend production build variables are set by `docker-compose.prod.yml`: `VITE_USE_BACKEND=true`, `VITE_API_BASE=/api/v1`, and optional `VITE_WS_BASE`. If the dashboard is exposed over HTTPS, set `VITE_WS_BASE=wss://<dashboard-domain>/api/v1` before building so browser WebSockets use TLS.

## Same-server Zammad notes

- Keep this project in its own directory; Docker Compose will create project-scoped container names from that directory.
- The dashboard's Postgres and Redis containers are separate from Zammad's services. Do not point `DATABASE_URL` at the Zammad database, and do not reuse Zammad's Redis URL/password.
- The dashboard web container binds to `127.0.0.1:8080` by default. Change `DEPLOY_HTTP_PORT` if that port is already used.
- Add a dashboard virtual host/path to the existing public reverse proxy manually. Example upstream target:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Use a distinct dashboard domain when possible. Path-based hosting needs extra Vite/router work and is not configured in this repo.

## Deploy

```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh
```

The script:

1. Validates required commands and `.env` values.
2. Warns about branch mismatch or uncommitted changes.
3. Optionally runs `git pull --ff-only` when `DEPLOY_PULL=true`.
4. Builds images.
5. Applies database migrations as a one-shot container (`docker compose run --rm --no-deps api alembic upgrade head`) — a failing migration aborts the deploy before any container is switched.
6. Starts/switches containers and waits for `GET /api/v1/system/health` through the local web container.
7. Prints service status and the local upstream URL.

The migration also still runs in `backend/Dockerfile` before Uvicorn starts (running it twice is a no-op):

```bash
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Set `DEPLOY_APP_VERSION=<tag>` in the environment to bake a version string into the frontend build (shown in the sidebar); the deploy workflow sets this automatically, and manual deploys default to `dev`.

## Useful commands

```bash
./deploy/deploy.sh status
./deploy/deploy.sh logs api
./deploy/deploy.sh logs web
./deploy/deploy.sh health
```

Manual migration if needed:

```bash
docker compose --env-file .env -f docker-compose.yml -f deploy/docker-compose.prod.yml exec api alembic upgrade head
```

Rollback to a known-good Git revision:

```bash
git checkout <known-good-ref>
./deploy/deploy.sh
```

## Backups

The dashboard database lives in the Docker volume `postgres_data` for this Compose project. Back it up before major upgrades. Never run `docker compose down -v` in production unless you intentionally want to delete dashboard data.
