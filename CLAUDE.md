# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Zammad Monitor** — a self-hosted intelligence/performance dashboard on top of an existing [Zammad](https://zammad.com) helpdesk instance. It reads Zammad only via its REST API (no DB access), syncs data into a local PostgreSQL store, and serves KPIs, SLA monitoring, agent analytics, and configurable alerts. Frontend is React + TypeScript (Vite), backend is FastAPI + SQLAlchemy (async). Full product spec in `PRD.md`.

## Architecture

Data flows one way: **Zammad → Celery workers → PostgreSQL → FastAPI → React**. The backend never serves live Zammad reads; it reads its own synced DB (with a Redis hot-cache in front) and backfills a single ticket from Zammad on a cache/DB miss.

```
Zammad (REST API + webhooks)
   │  Celery worker (app/tasks.py) — full + incremental sync
   ▼
PostgreSQL ←── Alembic migrations   Redis (broker + 2-min hot cache + pub/sub)
   │                                    ▲
 FastAPI routers ──(read DB + cache)────┘
   │  REST under root_path=/api/v1, JWT Bearer auth
   ▼
React (React Query + Zustand) ←── WebSocket /ws/{room} for live invalidation
```

### Backend (`backend/`)

- `app/main.py` — FastAPI app factory; each router mounted under `/api/v1/<prefix>`.
- `app/config.py` — pydantic-settings, reads `.env` (env file path is `backend/../.env`, i.e. repo root).
- `app/zammad_client.py` — the only place that talks to Zammad REST API (`ZammadClient`).
- `app/models.py` — Pydantic API schemas (`*Out`, `*In`). `app/db_models.py` — SQLAlchemy ORM rows (match the `*Out` schema field-for-field so `model_dump()`/`model_validate(from_attributes=True)` bridge them).
- `app/repositories.py` — DB access; every write is an upsert (`_upsert` = `INSERT ... ON CONFLICT (id) DO UPDATE`).
- `app/deps.py` — `get_current_user` (JWT decode), `require_roles()`, Redis client, token creation.
- `app/cache.py` — Redis cache (default TTL 120s) + `publish()` for WebSocket fan-out.
- `app/tasks.py` — Celery sync tasks. **The async core (`run_incremental_sync` / `run_full_sync` / `sync_ticket_core`) is shared with FastAPI routers; Celery tasks are thin `asyncio.run()` wrappers.** Each run creates its *own* engine + Redis client bound to that event loop, then disposes them — asyncpg/redis clients are loop-bound, so don't hoist a shared pool here.
- `app/celery_app.py` — Celery app with a **data-driven beat scheduler**: worker task `reload_schedules` reads DB `sync:schedules` setting → publishes to Redis key `sync:schedules:effective`; `RedisScheduler` refreshes from that key every few seconds. Admin edits to sync intervals take effect without a container restart.
- `app/routers/` — one module per resource. All read endpoints: get rows from DB via repositories → apply role scoping → optional cache. Note `tickets.py` defines the shared `_map_ticket`/`_map_article`/`_fetch_scoped` mappers that `tasks.py` and `kpi.py` import.

**Role scoping** is enforced in backend code (e.g. `_scope_filter` in `tickets.py`): admin sees all; agent sees own tickets; team_lead/project_manager see their `group_ids`. The JWT carries `role` + `group_ids`.

**Sync watermark**: `settings` table key `sync:last_ticket_updated_at`. Incremental sync pulls tickets `updated_at > watermark` then advances the watermark to *now* (not a ticket's timestamp — a stale ticket would pin it to the past). `sync:last_run` stores telemetry shown on the Settings page.

**Auth**: login proxies credentials to Zammad `users/me?expand=true`, maps Zammad roles/note/group-perms to internal `admin | team_lead | project_manager | agent` (`_map_role` in `routers/auth.py`), mints a JWT. There is no separate user store — users are upserted into Postgres from Zammad.

### Frontend (`src/`)

- `lib/api.ts` — single `api` export: `VITE_USE_MOCK === "true"` → `mockApi` (in-memory from `lib/mock-data.ts`), else `apiClient` from `lib/api-client.ts` (fetch-based). `api-client.ts` methods must stay signature-identical to `mockApi`. All backend calls go through this one abstraction; pages never call fetch directly.
- `lib/api-client.ts` — reads JWT from the `zm-auth` localStorage key (Zustand persist), auto-logouts on 401.
- `stores/auth.ts` — Zustand store (persisted as `zm-auth`); `useScope()` derives the current user's role/group_ids scope.
- `hooks/use-realtime.ts` — opens `ws://<host>/api/v1/ws/{room}?token=...` when `VITE_USE_BACKEND === "true"`; invalidates React Query keys on `ticket.*` / `kpi.refresh` / `alert.fired` / `export.ready` events.
- `components/` — layout, shared (`chart-card`, `kpi-card`, `sla-badge`…), and `ui/` (shadcn-style Radix primitives). `pages/` — one per route; roles are guarded in `App.tsx` with `<RequireAuth roles={[...]}>`.

## Development

Infra runs in Docker (Postgres, Redis, API, Celery worker + beat). Frontend runs locally against it via Vite's proxy.

```bash
# Backend + infra (root): starts Postgres, Redis, API (:8000), worker, beat
docker compose up --build

# One-time / after DB model changes
docker compose exec api alembic upgrade head

# Frontend (root): Vite dev server on :5173, proxies /api/v1 and /ws to :8000
npm install
npm run dev

# Frontend build + lint
npm run build    # tsc -b && vite build
npm run lint     # eslint .
```

### Local backend without Docker

The `backend/.venv` already has all deps installed (Python 3.12). Point env vars at local services (`REDIS_URL`, `DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/...`) and run `uvicorn app.main:app --port 8000` from `backend/`.

### Environment

- `.env` (repo root) — real backend config. `.env.example` — frontend-only docs.
- `VITE_USE_BACKEND=true` uses the real API; `VITE_USE_MOCK=true` uses mock data (offline/demo). If `VITE_USE_BACKEND` is unset the mock is used (`api.ts` checks `VITE_USE_MOCK`).
- Backend reads settings from env vars / `.env` (root). `ZAMMAD_BASE_URL` + `ZAMMAD_API_TOKEN` point at the live Zammad instance.

### Self-checks (no test framework installed)

The backend has no pytest/unittest; verification is via runnable scripts and assert-based checks. Run inside the api container (needs live DB + Zammad):

```bash
docker compose exec api python check_sync.py            # full sync + verifies DB counts > 0
docker compose exec api python check_ticket_sorting.py  # monkeypatches tickets.py, asserts list order
```

`check_ticket_sorting.py` is the pattern for testing router logic without a DB: patch `cache_get`/`cache_set`/`zammad` module attributes on `app.routers.tickets`, call the endpoint function directly, `assert` on the result, run with `python`.

## Not implemented yet (per PRD)

The API exposes `/settings/reports`-style placeholder endpoints; the frontend `api-client.ts` stubs `listExports`/`createExport` to no-ops — report export (PDF/Excel) is not built. Alert dispatch to external channels (email/slack/teams/telegram/whatsapp) is defined in the schema but not implemented — `alerts.py` stores rules and `notifications.py` stores in-app notifications only.

## Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Git Management

This project uses Git with a simple branching strategy suited for a solo developer.

### Branching Strategy

```
main          ← production-ready, always stable
  └── develop ← daily integration, base for all new features
        ├── feat/crm-project-crud
        ├── feat/dashboard-charts
        ├── fix/login-token-refresh
        └── chore/update-dependencies
```

**Branch rules:**
- `main` — only accepts merges from `develop` via PR/MR after testing
- `develop` — primary working branch; direct pushes allowed for small changes
- `feat/*` — new features; branch from `develop`, merge back to `develop`
- `fix/*` — bug fixes; branch from `develop` (or `main` for production hotfixes)
- `chore/*` — maintenance, dependency updates, refactors without functional changes
- `docs/*` — documentation-only changes

### Branch Naming Convention

```
feat/<short-description>      # feat/crm-project-filter
fix/<bug-description>         # fix/pagination-offset
chore/<task-description>      # chore/upgrade-sqlalchemy
docs/<document-description>   # docs/update-api-spec
```

- Use `kebab-case`, all lowercase
- Maximum 5 words, specific and descriptive
- Avoid generic names like `feat/update` or `fix/bug`

### Commit Message Convention

Format follows **Conventional Commits**:

```
<type>(<scope>): <short description>

[optional body — further explanation]

[optional footer — breaking change, closes issue]
```

**Types used:**

| Type | When to use |
|---|---|
| `feat` | Adding a new feature |
| `fix` | Fixing a bug |
| `refactor` | Code change without adding a feature or fixing a bug |
| `chore` | Dependency updates, configuration, tooling |
| `docs` | Documentation-only changes |
| `style` | Formatting, whitespace — no logic changes |
| `test` | Adding or modifying tests |
| `perf` | Performance optimizations |
| `revert` | Reverting a previous commit |

**Scopes relevant to this project:**

| Scope | Description |
|---|---|
| `auth` | Authentication endpoints / logic |
| `crm` | CRM Project (model, router, service, components) |
| `users` | User management |
| `dashboard` | Dashboard page & charts |
| `db` | Migrations, schema, models |
| `ui` | UI components / shadcn |
| `config` | Vite, Tailwind, FastAPI settings |
| `deploy` | Nginx, Docker, systemd, deploy scripts |

**Correct commit examples:**
```bash
git commit -m "feat(crm): add filter by kc_supervisi on list endpoint"
git commit -m "fix(auth): refresh token not returning new refresh token"
git commit -m "chore(db): add migration for kc_supervisi enum update"
git commit -m "refactor(ui): extract CrmProjectFilters into separate component"
git commit -m "docs: update API.md with export endpoint params"
```

**Incorrect commit examples:**
```bash
git commit -m "update"          # ❌ too generic
git commit -m "fix bug"         # ❌ no scope and no description
git commit -m "WIP"             # ❌ never commit WIP to develop/main
git commit -m "asdfgh"          # ❌ obviously not allowed
```

### .gitignore

Ensure the `.gitignore` file at the project root includes:

```gitignore
# Environment
.env
.env.local
.env.production
backend/.env

# Python
__pycache__/
*.py[cod]
*.pyo
.venv/
venv/
*.egg-info/
dist/
.pytest_cache/

# Node
node_modules/
frontend/dist/
frontend/.vite/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp

# Logs
*.log
logs/

# Build artifacts
*.pyc
```

