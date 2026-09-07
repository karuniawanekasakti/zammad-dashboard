from pathlib import Path

deploy_dir = Path(__file__).resolve().parent
root = deploy_dir.parent
script = deploy_dir / "deploy.sh"
compose = deploy_dir / "docker-compose.prod.yml"
nginx = deploy_dir / "nginx.conf"
docs = deploy_dir / "DEPLOYMENT.md"

assert script.read_text().startswith("#!/usr/bin/env bash\nset -euo pipefail")
assert "--env-file .env -f docker-compose.yml -f deploy/docker-compose.prod.yml" in script.read_text()
assert "DEPLOY_BIND_HOST:-127.0.0.1" in compose.read_text()
assert "DEPLOY_HTTP_PORT:-8080" in compose.read_text()
assert "REDIS_PASSWORD" in compose.read_text()
assert "POSTGRES_PASSWORD" in compose.read_text()
assert "proxy_pass $api_upstream;" in nginx.read_text()
assert "location /api/v1/" in nginx.read_text()
assert "same Linux server that runs production Zammad" in docs.read_text()
print("deploy file checks passed")
