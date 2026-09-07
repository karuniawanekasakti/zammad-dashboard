# CI/CD

How code reaches production:

```
Code → Pull Request → CI → Merge to master → Release tag → GitHub Actions → Deploy
```

Vocabulary follows the `CONTEXT.md` glossary: a **Release** is an annotated
semver tag on `master`, a **Deploy** is making the production server run
exactly one release, and a **Rollback** is a deploy of an earlier release.

## Flow overview

- Every pull request and every push to `master` runs the CI gate
  (`.github/workflows/ci.yml`):
  - **frontend**: `npm ci --legacy-peer-deps` → `npm run lint` → `npm run build`
  - **backend**: `python -m compileall backend/app` (syntax),
    `python deploy/check_deploy_files.py` (deploy-artifact consistency),
    `docker build ./backend` (dependency/packaging)
- Pushing a release tag `vX.Y.Z` (strict semver, no pre-release suffix) runs
  the deploy workflow (`.github/workflows/deploy.yml`) on the self-hosted
  runner installed on the production server.
- Merging to `master` never changes production by itself. Only a tag deploys.
- Deploys are serialized (`concurrency: production-deploy`); two tags pushed
  close together run one after another, never in parallel.

## One-time setup (server)

These steps happen once, on the production server, by a server admin. No
automation can do them — the repo is public and never contains credentials.

1. **Server checkout**: clone the repo to `/opt/zammad-dashboard` (the
   conventional path the deploy workflow uses; the marker file lives there).
2. **Server `.env`**: provision as described in `deploy/DEPLOYMENT.md`. It
   already contains everything the deploy needs; all secrets stay only there.
3. **Self-hosted runner**: install the GitHub Actions runner as an
   unprivileged user that has docker access, labeled `production`:
   - GitHub → repo *Settings → Actions → Runners → New self-hosted runner*,
     follow the Linux instructions. The registration token shown there is a
     short-lived, one-time, server-side value — never commit it.
   - During `config.sh`, add the label `production`.
   - Install the runner as a service (`./svc.sh install && ./svc.sh start`)
     so it survives reboots.
   - The runner user needs: read/write on `/opt/zammad-dashboard`, and docker
     access (e.g. member of the `docker` group).
   - The runner makes outbound connections only — no inbound firewall holes,
     no VPN, no SSH.

## Releasing

From a clean, up-to-date local `master`:

```bash
./deploy/release.sh 1.2.0
```

The script rejects non-semver input (including a `v` prefix or pre-release
suffixes), a dirty working tree, a non-`master` checkout, a `master` that is
not in sync with `origin/master`, and versions whose tag already exists. On
success it creates the annotated tag `v1.2.0` and pushes it — the push is
what triggers the deploy.

Fallback without the helper:

```bash
git fetch origin
git tag -a v1.2.0 -m "Release v1.2.0" master
git push origin v1.2.0
```

## What a deploy does

The deploy workflow, in order:

1. **CI gate** — re-runs the exact same CI jobs as pull requests (via
   `workflow_call`). A tag can never deploy code that would fail CI.
2. **Checkout** — in `/opt/zammad-dashboard` on the server:
   `git fetch --tags && git checkout -f <tag>`. The server checkout sits on a
   detached HEAD at exactly the tagged commit. A dirty-tree warning from
   `deploy.sh` after a CI deploy means someone edited the server by hand —
   treat it as an integrity signal.
3. **Deploy** — `./deploy/deploy.sh deploy` with `DEPLOY_APP_VERSION=<tag>`:
   preflight `.env` validation → build images → **one-shot migration**
   (`docker compose run --rm --no-deps api alembic upgrade head`) → switch
   containers → wait for the health endpoint. A failed migration aborts
   before any container is switched; a failed build leaves the old version
   running. The tag is baked into the frontend build, so the sidebar shows
   the running version.
4. **Record** — the deployed tag is written to
   `/opt/zammad-dashboard/.deployed-version` (the rollback anchor).

## Failure behavior

If any step after the CI gate fails, the workflow automatically rolls back:
it reads `.deployed-version`, checks out that tag, redeploys it, and
re-records it on success. The run fails either way with an `::error::`
annotation:

- **rolled back** — the previous version is serving again; investigate the
  failed release and cut a new one when fixed.
- **CRITICAL: manual intervention required** — there was no previous version
  recorded, or the rollback deploy also failed. Get on the server.

GitHub's default workflow-failure email is the only notification channel.

## Manual rollback (healthy-but-bad release)

A release that deployed successfully but is functionally broken is rolled
back by deploying the previous release: GitHub → *Actions → Deploy →
Re-run* is not enough across tags — instead push nothing and re-run the
deploy workflow for the previous tag (or, on the server, check out the
previous tag in `/opt/zammad-dashboard` and run
`DEPLOY_APP_VERSION=<prev-tag> ./deploy/deploy.sh deploy`, then write the tag
into `.deployed-version`). See the Rollback definition in `CONTEXT.md`.

## The `.deployed-version` marker

- **Bootstrap**: created automatically by the first successful tag deploy.
  Before the first tag deploy, you may seed it manually with the version the
  server is actually running, or leave it absent (a failed first deploy then
  reports CRITICAL instead of rolling back — acceptable, nothing was running
  under this pipeline before).
- **Recovery**: if the file is lost, restore it from the checkout itself:
  `git -C /opt/zammad-dashboard describe --tags` prints the checked-out tag.

## Migration discipline

Migrations run *before* containers are switched, so a failed migration
safely aborts the deploy. The converse is not safe: if a release's migration
*succeeded* but the deploy fails afterwards, automatic rollback starts the
previous app version against the **newer** schema. Therefore every migration
must be backward compatible with the previously deployed release (add
columns nullable, never drop/rename in the same release that stops using
them, etc.).

## Adding real tests to the gate later

The gate deliberately contains only checks the project already has. To add a
test suite later, install the framework as a devDependency (frontend) or in
`backend/requirements.txt` (backend), add an `npm run test` /
`pytest` script, and add one `run:` step to the corresponding job in
`.github/workflows/ci.yml`. The deploy workflow reuses those jobs, so the
deploy-time gate grows automatically.

## Resource note

The production server is the same box that runs production Zammad. Docker
builds during deploys share that box's CPU/IO. For this app's release
cadence that is acceptable; if builds ever disturb Zammad, schedule releases
off-peak or move image builds to a registry flow (currently out of scope by
design — the server builds images locally).
