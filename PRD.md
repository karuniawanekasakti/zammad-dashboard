# Zammad Monitor — Product Requirements Document

> **Version:** 1.0 | **Status:** Draft — Pending Engineering Review | **Date:** May 2025 | **CONFIDENTIAL**

| Property | Value |
|---|---|
| Document Version | 1.0 |
| Status | Draft — Pending Engineering Review |
| Last Updated | May 2025 |
| Owner | Lead Engineer / Architect |
| Deployment Target | Self-Hosted (On-Premise) |
| Zammad Integration | REST API + Webhooks (Real-time) |
| Primary Tech Stack | Python (FastAPI) + React (TypeScript) |
| Target Scale | Medium — 20–100 Agents, 500–5,000 Tickets/Day |
| Data Retention | 30 Days Rolling Window |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Stakeholder Roles & Access Matrix](#3-stakeholder-roles--access-matrix)
4. [Technology Stack](#4-technology-stack)
5. [System Architecture](#5-system-architecture)
6. [Database Design](#6-database-design)
7. [Queue Worker Architecture](#7-queue-worker-architecture-celery)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Real-Time Architecture](#9-real-time-architecture)
10. [Alert System](#10-alert-system)
11. [Frontend Design & Page Specifications](#11-frontend-design--page-specifications)
12. [API Endpoint Reference](#12-api-endpoint-reference)
13. [KPI Definitions & Calculation Logic](#13-kpi-definitions--calculation-logic)
14. [Report Export System](#14-report-export-system)
15. [Security Design](#15-security-design)
16. [Non-Functional Requirements](#16-non-functional-requirements)
17. [Deployment Architecture](#17-deployment-architecture)
18. [Development Roadmap & Phases](#18-development-roadmap--phases)
19. [Open Questions & Assumptions](#19-open-questions--assumptions)
20. [Glossary](#20-glossary)

---

## 1. Executive Summary

**Zammad Monitor** is a self-hosted intelligence and performance dashboard built on top of an existing Zammad helpdesk instance. It provides real-time visibility, KPI tracking, SLA monitoring, agent performance analytics, and multi-channel alerting across four distinct roles: Admin, Agent, Team Lead, and Project Manager.

The system connects to Zammad exclusively via its REST API and Webhook system — no direct database access is required. All data is synchronized into a local PostgreSQL database for fast querying, aggregation, and 30-day historical analysis. A Celery-based worker queue manages background sync, KPI computation, alert dispatch, and report generation.

> **Core Value Proposition:** Zammad's built-in reporting is limited. Zammad Monitor fills this gap by delivering real-time dashboards, configurable SLA breach alerts, agent workload balancing insights, and on-demand exportable reports — all without modifying or extending the Zammad installation itself.

---

## 2. Goals & Non-Goals

### 2.1 Goals

- Provide real-time ticket tracking and monitoring for all four user roles
- Monitor agent performance with KPIs: First Reply Time, Resolution Time, SLA Breach Rate, Ticket Reopen Rate
- Deliver configurable multi-channel alerting: In-App, Email, Slack/Teams, WhatsApp/Telegram
- Support fully configurable role-based data visibility scopes
- Enable on-demand PDF and Excel report exports
- Maintain 30-day rolling historical data for trend analysis
- Authenticate users via Zammad proxy auth (no separate user store)
- Be self-hosted with a Docker Compose-based deployment

### 2.2 Non-Goals (Out of Scope v1.0)

- TV Wallboard / Kiosk mode
- Multi-Zammad-instance (multi-tenant) support
- Modifying or creating tickets inside Zammad from this dashboard
- CSAT score collection (may be added if Zammad exposes it via API)
- Mobile native app (web-responsive only)
- Scheduled automated report delivery via email

---

## 3. Stakeholder Roles & Access Matrix

Four roles are in scope. Each role has a distinct dashboard view and configurable data visibility scope. Visibility rules are set by the Admin and stored in the system — not hard-coded.

| Role | Primary Concerns | Default Visibility | Can Configure Alerts |
|---|---|---|---|
| **Admin** | Full system oversight, all agents, all groups, system health | All tickets, all agents, all groups | Yes — global |
| **Team Lead** | Team performance, SLA compliance, agent workloads within group | Own group's tickets and agents | Yes — group scope |
| **Project Manager** | Ticket tracking by group/project/tag, SLA status | Assigned groups/projects | Yes — project scope |
| **Agent** | Own open tickets, SLA countdowns, personal KPI stats | Own tickets only (configurable) | Yes — personal only |

---

## 4. Technology Stack

### 4.1 Backend

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| API Framework | FastAPI | 0.111+ | REST API, WebSocket endpoints, Webhook receiver |
| Task Queue | Celery | 5.3+ | Async workers: sync, KPI calc, alerts, exports |
| Message Broker | Redis | 7.x | Celery broker + pub/sub for real-time WebSocket fan-out |
| Cache | Redis | 7.x | API response caching, rate limiting, session store |
| ORM | SQLAlchemy | 2.x (async) | Database models, migrations via Alembic |
| Database | PostgreSQL | 15+ | Primary data store for tickets, metrics, users, alerts |
| HTTP Client | httpx | 0.27+ | Async Zammad REST API client |
| Auth / JWT | python-jose + passlib | latest | JWT token issuance and validation |
| Email | aiosmtplib + Jinja2 | latest | Async SMTP email alerts with HTML templates |
| PDF Export | WeasyPrint | 60+ | HTML → PDF report generation |
| Excel Export | openpyxl | 3.x | Excel (.xlsx) report generation |
| Scheduling | Celery Beat | 5.3+ | Periodic task scheduling (sync, KPI, cleanup) |
| Container | Docker + Docker Compose | latest | Self-hosted deployment |
| Reverse Proxy | Nginx | 1.25+ | TLS termination, static files, WebSocket proxy |

### 4.2 Frontend

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Framework | React | 18+ | Component-based UI framework |
| Language | TypeScript | 5.x | Type safety across the frontend codebase |
| Build Tool | Vite | 5.x | Fast dev server, optimized production builds |
| Routing | React Router | v6 | Client-side routing and role-based route guards |
| State Management | Zustand | 4.x | Lightweight global state (user session, alerts) |
| Server State | TanStack Query | v5 | Data fetching, caching, background refetch |
| Charts | Recharts | 2.x | KPI trend charts, bar charts, area charts |
| UI Components | shadcn/ui + Radix UI | latest | Accessible component primitives |
| Styling | Tailwind CSS | 3.x | Utility-first CSS, dark mode support |
| Real-time | Native WebSocket API | — | Live ticket/metric updates from backend |
| Tables | TanStack Table | v8 | Sortable, filterable, paginated data tables |
| Forms | React Hook Form + Zod | latest | Form validation with schema-based rules |
| Notifications | Sonner (toast) | latest | In-app real-time alert toasts |
| Date/Time | date-fns | 3.x | Date formatting, SLA countdown calculations |
| Export Trigger | Axios | 1.x | Trigger PDF/Excel export API calls with progress |

### 4.3 Infrastructure (Self-Hosted Docker Compose)

| Service Name | Image | Purpose |
|---|---|---|
| `api` | python:3.12-slim (custom) | FastAPI application server (Uvicorn) |
| `worker` | python:3.12-slim (custom) | Celery worker — sync, KPI, alerts, exports |
| `beat` | python:3.12-slim (custom) | Celery Beat — periodic task scheduler |
| `redis` | redis:7-alpine | Message broker + cache + pub/sub |
| `postgres` | postgres:15-alpine | Primary database |
| `nginx` | nginx:1.25-alpine | Reverse proxy, static file serving, TLS |
| `flower` | mher/flower | Optional: Celery task monitoring UI (port 5555) |

---

## 5. System Architecture

### 5.1 High-Level Architecture Overview

> **Architecture Pattern:** Event-Driven + Polling Hybrid. Zammad pushes webhook events for real-time updates. A periodic Celery Beat job performs full reconciliation sync every 5 minutes to catch any missed events. The frontend receives live updates via WebSocket connections managed by the FastAPI backend using Redis pub/sub as the fan-out bus.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ZAMMAD INSTANCE                                │
│                   (existing, unmodified)                                │
└───────────────┬──────────────────────────┬──────────────────────────────┘
                │ Webhooks (HMAC-signed)    │ REST API (httpx)
                ▼                          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        NGINX (Reverse Proxy / TLS)                       │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
              ▼                                   ▼
   ┌─────────────────────┐             ┌──────────────────────┐
   │   FastAPI (api)     │◄────────────│  React Frontend      │
   │                     │  HTTP/WS    │  (Browser)           │
   │ - REST endpoints    │────────────►│                      │
   │ - WebSocket hub     │             └──────────────────────┘
   │ - Webhook receiver  │
   │ - Auth middleware   │
   └────────┬────────────┘
            │
     ┌──────┴──────┐
     │             │
     ▼             ▼
┌─────────┐  ┌──────────────────────────────────────────┐
│ Redis   │  │              PostgreSQL                   │
│         │  │                                          │
│ - Broker│  │ tickets | users | groups | snapshots     │
│ - Cache │  │ alert_rules | notifications | exports    │
│ - PubSub│  │ webhook_events | sync_logs | settings    │
└────┬────┘  └──────────────────────────────────────────┘
     │
     ├─────────────────────────────────────────┐
     │                                         │
     ▼                                         ▼
┌────────────────────────┐         ┌────────────────────────┐
│  Celery Worker         │         │  Celery Beat           │
│                        │         │                        │
│ - webhook queue        │         │ - sync every 5 min     │
│ - sync queue           │         │ - kpi every 2 min      │
│ - kpi queue            │         │ - alerts every 1 min   │
│ - alerts queue         │         │ - cleanup daily 02:00  │
│ - exports queue        │         │                        │
│ - cleanup queue        │         └────────────────────────┘
└────────────────────────┘
```

### 5.2 Data Flow (Webhook-Driven)

1. Zammad fires a webhook event (ticket created/updated/closed) to `POST /api/v1/webhooks/zammad`
2. FastAPI webhook receiver validates the HMAC-SHA256 signature, queues the event to Redis
3. A Celery worker picks up the event, fetches full ticket details from Zammad REST API
4. The worker writes normalized data to PostgreSQL and updates Redis cache
5. The worker publishes a WebSocket message to the Redis pub/sub channel
6. The FastAPI WebSocket manager fans out the update to all subscribed frontend clients
7. Celery Beat runs KPI recalculation every 2 minutes, alert check every 1 minute
8. Alert worker dispatches notifications via configured channels (Email, Slack, WhatsApp, Telegram)

### 5.3 Component Architecture

| Component | Responsibility | Technology |
|---|---|---|
| API Gateway Layer | Auth middleware, rate limiting, request routing | FastAPI + Nginx |
| Auth Service | Zammad credential proxy, JWT issuance, role resolution | FastAPI + python-jose |
| Webhook Receiver | HMAC validation, event ingestion, queue dispatch | FastAPI endpoint |
| Sync Engine | Full/incremental sync of tickets, users, groups from Zammad | Celery Worker + httpx |
| KPI Engine | Compute First Reply, Resolution, Breach Rate, Reopen Rate | Celery Worker + SQLAlchemy |
| Alert Engine | Evaluate alert rules, dispatch to all configured channels | Celery Worker |
| Export Engine | Generate PDF/Excel reports on demand | Celery Worker + WeasyPrint + openpyxl |
| WebSocket Hub | Manage client connections, fan-out updates via Redis pub/sub | FastAPI + Redis |
| Data Retention | Delete records older than 30 days, archive summaries | Celery Beat |

### 5.4 API Design Principles

- RESTful resource-based routes with versioned prefix `/api/v1/`
- JWT Bearer token authentication on all protected endpoints
- Role-based access control enforced at dependency injection level
- WebSocket endpoint at `/ws/{room}` for real-time subscriptions
- Webhook endpoint at `/api/v1/webhooks/zammad` with HMAC-SHA256 validation
- Consistent error envelope: `{ success, data, error, meta }`
- Pagination on all list endpoints using cursor-based pagination
- OpenAPI docs auto-generated by FastAPI at `/docs`

---

## 6. Database Design

All tables reside in a single PostgreSQL 15 database. SQLAlchemy 2.x (async) with Alembic handles migrations. Indexes are designed for the most frequent query patterns: by agent, by group, by date range, and by ticket state.

### 6.1 Core Tables

#### `users`

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID (PK) | NOT NULL | Internal primary key (UUID v4) |
| zammad_id | INTEGER | UNIQUE NOT NULL | Zammad user ID for API correlation |
| email | VARCHAR(255) | UNIQUE NOT NULL | User's email address |
| firstname | VARCHAR(100) | NOT NULL | First name synced from Zammad |
| lastname | VARCHAR(100) | NOT NULL | Last name synced from Zammad |
| login | VARCHAR(100) | UNIQUE NOT NULL | Zammad login username |
| role | ENUM | NOT NULL | `admin \| team_lead \| project_manager \| agent` |
| zammad_roles | JSONB | NOT NULL DEFAULT `'[]'` | Raw Zammad role names array |
| group_ids | JSONB | NOT NULL DEFAULT `'[]'` | Assigned Zammad group IDs |
| visibility_config | JSONB | NOT NULL DEFAULT `'{}'` | Custom visibility settings per role |
| notification_prefs | JSONB | NOT NULL DEFAULT `'{}'` | Alert channel preferences |
| is_active | BOOLEAN | NOT NULL DEFAULT TRUE | Soft delete / deactivation flag |
| last_synced_at | TIMESTAMPTZ | NULL | Last time record was synced from Zammad |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Record creation timestamp |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Record update timestamp |

#### `groups`

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID (PK) | NOT NULL | Internal primary key |
| zammad_id | INTEGER | UNIQUE NOT NULL | Zammad group ID |
| name | VARCHAR(255) | NOT NULL | Group name (e.g., IT Support, Billing) |
| note | TEXT | NULL | Group description |
| active | BOOLEAN | NOT NULL DEFAULT TRUE | Whether group is active in Zammad |
| last_synced_at | TIMESTAMPTZ | NULL | Last sync timestamp |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Record creation timestamp |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Record update timestamp |

#### `tickets`

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID (PK) | NOT NULL | Internal primary key |
| zammad_id | INTEGER | UNIQUE NOT NULL | Zammad ticket ID |
| number | VARCHAR(20) | NOT NULL | Zammad ticket number (e.g., 10042) |
| title | VARCHAR(500) | NOT NULL | Ticket subject/title |
| state | VARCHAR(50) | NOT NULL | `new \| open \| pending \| closed \| merged` |
| priority | VARCHAR(50) | NOT NULL | `low \| normal \| high \| very high` |
| group_id | UUID (FK) | NOT NULL | References `groups.id` |
| owner_id | UUID (FK) | NULL | References `users.id` — assigned agent |
| customer_id | UUID (FK) | NULL | References `users.id` — ticket requester |
| tags | TEXT[] | NOT NULL DEFAULT `'{}'` | Ticket tags array (for project tracking) |
| sla_policy_id | UUID (FK) | NULL | References `sla_policies.id` |
| first_response_at | TIMESTAMPTZ | NULL | Timestamp of first agent reply article |
| first_response_escalation_at | TIMESTAMPTZ | NULL | SLA first response deadline from Zammad |
| update_escalation_at | TIMESTAMPTZ | NULL | SLA update deadline from Zammad |
| close_escalation_at | TIMESTAMPTZ | NULL | SLA close deadline from Zammad |
| first_response_breached | BOOLEAN | NOT NULL DEFAULT FALSE | True if first reply SLA was breached |
| update_breached | BOOLEAN | NOT NULL DEFAULT FALSE | True if update SLA was breached |
| close_breached | BOOLEAN | NOT NULL DEFAULT FALSE | True if close SLA was breached |
| reopen_count | INTEGER | NOT NULL DEFAULT 0 | Number of times ticket was reopened |
| resolution_time_secs | INTEGER | NULL | Seconds from `created_at` to `closed_at` |
| first_reply_time_secs | INTEGER | NULL | Seconds from `created_at` to `first_response_at` |
| closed_at | TIMESTAMPTZ | NULL | When the ticket was closed |
| zammad_created_at | TIMESTAMPTZ | NOT NULL | Original Zammad ticket creation time |
| zammad_updated_at | TIMESTAMPTZ | NOT NULL | Last Zammad update time |
| raw_payload | JSONB | NULL | Full Zammad ticket JSON (for audit/replay) |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Local record creation |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Local record update |

#### `ticket_articles`

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID (PK) | NOT NULL | Internal primary key |
| zammad_id | INTEGER | UNIQUE NOT NULL | Zammad article ID |
| ticket_id | UUID (FK) | NOT NULL | References `tickets.id` |
| author_id | UUID (FK) | NULL | References `users.id` |
| type | VARCHAR(50) | NOT NULL | `email \| phone \| note \| web` |
| sender | VARCHAR(20) | NOT NULL | `agent \| customer \| system` |
| internal | BOOLEAN | NOT NULL DEFAULT FALSE | Internal note flag |
| zammad_created_at | TIMESTAMPTZ | NOT NULL | Article creation time in Zammad |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Local record creation |

#### `sla_policies`

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID (PK) | NOT NULL | Internal primary key |
| zammad_id | INTEGER | UNIQUE NOT NULL | Zammad SLA policy ID |
| name | VARCHAR(255) | NOT NULL | SLA policy name |
| first_response_time_mins | INTEGER | NULL | First response SLA in minutes |
| update_time_mins | INTEGER | NULL | Update SLA in minutes |
| solution_time_mins | INTEGER | NULL | Solution/close SLA in minutes |
| calendar_id | INTEGER | NULL | Zammad business hours calendar ID |
| active | BOOLEAN | NOT NULL DEFAULT TRUE | Active flag |
| last_synced_at | TIMESTAMPTZ | NULL | Last sync from Zammad |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Local record creation |

---

### 6.2 Metrics & Analytics Tables

#### `agent_performance_snapshots`

Hourly snapshots computed by the KPI Engine. Used for trend charts and historical analysis within the 30-day window.

| Column | Type | Description |
|---|---|---|
| id | UUID (PK) | Primary key |
| agent_id | UUID (FK) | References `users.id` |
| group_id | UUID (FK) | References `groups.id` (agent's group at snapshot time) |
| snapshot_hour | TIMESTAMPTZ | Truncated to hour — partition key |
| open_tickets | INTEGER | Count of open tickets at snapshot time |
| closed_tickets | INTEGER | Tickets closed in this hour |
| first_reply_avg_secs | INTEGER | Avg first reply time in this hour |
| resolution_avg_secs | INTEGER | Avg resolution time in this hour |
| sla_breached_count | INTEGER | SLA breaches in this hour |
| sla_total_count | INTEGER | Total SLA-applicable tickets in this hour |
| reopen_count | INTEGER | Tickets reopened in this hour |
| created_at | TIMESTAMPTZ | Record creation timestamp |

#### `group_performance_snapshots`

Hourly group-level aggregates. Queried by Project Manager and Admin dashboards.

| Column | Type | Description |
|---|---|---|
| id | UUID (PK) | Primary key |
| group_id | UUID (FK) | References `groups.id` |
| snapshot_hour | TIMESTAMPTZ | Truncated to hour |
| open_tickets | INTEGER | Open tickets for this group at snapshot time |
| closed_tickets | INTEGER | Closed in this hour |
| new_tickets | INTEGER | New tickets received in this hour |
| sla_breach_rate | DECIMAL(5,2) | Breach percentage (0.00–100.00) |
| avg_first_reply_secs | INTEGER | Average first reply across all agents |
| avg_resolution_secs | INTEGER | Average resolution time |
| created_at | TIMESTAMPTZ | Record creation timestamp |

---

### 6.3 Notification & Alert Tables

#### `alert_rules`

| Column | Type | Description |
|---|---|---|
| id | UUID (PK) | Primary key |
| name | VARCHAR(255) | Human-readable rule name |
| created_by_id | UUID (FK) | Admin/Team Lead who created the rule |
| scope_type | ENUM | `global \| group \| agent` — alert scope |
| scope_id | UUID | NULL for global; group or agent UUID otherwise |
| condition_type | ENUM | `sla_breach \| ticket_open_too_long \| high_workload \| reopen \| sla_approaching \| no_activity` |
| condition_params | JSONB | Threshold values: `{ threshold_mins: 30, priority: "high" }` |
| channels | TEXT[] | `['email', 'slack', 'telegram', 'whatsapp', 'in_app']` |
| is_active | BOOLEAN | Whether rule is currently active |
| cooldown_mins | INTEGER | Minutes before the same rule fires again per target |
| created_at | TIMESTAMPTZ | Record creation |
| updated_at | TIMESTAMPTZ | Record update |

#### `notification_events`

| Column | Type | Description |
|---|---|---|
| id | UUID (PK) | Primary key |
| rule_id | UUID (FK) | References `alert_rules.id` |
| recipient_id | UUID (FK) | References `users.id` — who receives the alert |
| ticket_id | UUID (FK) | References `tickets.id` — triggering ticket |
| channel | ENUM | `email \| slack \| telegram \| whatsapp \| in_app` |
| status | ENUM | `pending \| sent \| failed \| read` (in_app only) |
| payload | JSONB | The rendered notification content |
| error_message | TEXT | NULL or error detail if delivery failed |
| sent_at | TIMESTAMPTZ | When successfully dispatched |
| read_at | TIMESTAMPTZ | When user read in-app notification |
| created_at | TIMESTAMPTZ | Record creation |

#### `notification_channels`

| Column | Type | Description |
|---|---|---|
| id | UUID (PK) | Primary key |
| user_id | UUID (FK) | References `users.id` |
| channel_type | ENUM | `email \| slack \| telegram \| whatsapp \| in_app` |
| config | JSONB | Channel-specific config: `{ webhook_url, chat_id, phone_number }` |
| is_active | BOOLEAN | Whether channel is enabled for this user |
| verified_at | TIMESTAMPTZ | When channel was tested and verified |
| created_at | TIMESTAMPTZ | Record creation |

---

### 6.4 System & Audit Tables

#### `webhook_events`

| Column | Type | Description |
|---|---|---|
| id | UUID (PK) | Primary key |
| event_type | VARCHAR(100) | `ticket.created \| ticket.updated \| ticket.closed` etc. |
| zammad_ticket_id | INTEGER | Raw ticket ID from webhook payload |
| raw_payload | JSONB | Full raw webhook JSON for replay/debug |
| processed | BOOLEAN | Whether Celery worker has processed it |
| processed_at | TIMESTAMPTZ | Processing completion timestamp |
| error | TEXT | Error detail if processing failed |
| received_at | TIMESTAMPTZ | When webhook was received |

#### `sync_logs`

| Column | Type | Description |
|---|---|---|
| id | UUID (PK) | Primary key |
| sync_type | ENUM | `full \| incremental \| webhook` |
| started_at | TIMESTAMPTZ | Sync start time |
| finished_at | TIMESTAMPTZ | Sync completion time |
| tickets_synced | INTEGER | Number of ticket records processed |
| errors | INTEGER | Number of errors encountered |
| status | ENUM | `running \| success \| partial \| failed` |
| detail | JSONB | Additional sync metadata and error details |

#### `report_exports`

| Column | Type | Description |
|---|---|---|
| id | UUID (PK) | Primary key |
| requested_by_id | UUID (FK) | References `users.id` |
| report_type | ENUM | `agent_performance \| sla_summary \| ticket_volume \| group_stats` |
| format | ENUM | `pdf \| xlsx` |
| parameters | JSONB | `{ date_from, date_to, group_id, agent_id, ... }` |
| status | ENUM | `queued \| generating \| ready \| failed` |
| file_path | VARCHAR(500) | Path to generated file on disk |
| file_size_bytes | INTEGER | Generated file size |
| expires_at | TIMESTAMPTZ | File deletion time (auto-expire after 24 hours) |
| created_at | TIMESTAMPTZ | Request creation time |
| completed_at | TIMESTAMPTZ | Generation completion time |

#### `settings`

| Column | Type | Description |
|---|---|---|
| id | UUID (PK) | Primary key |
| key | VARCHAR(255) | UNIQUE — setting key (e.g., `zammad.base_url`) |
| value | JSONB | Setting value (any JSON type) |
| description | TEXT | Human-readable description |
| updated_by_id | UUID (FK) | Last admin who changed this setting |
| updated_at | TIMESTAMPTZ | Last update timestamp |

---

### 6.5 Database Indexes

| Table | Index | Type | Reason |
|---|---|---|---|
| tickets | idx_tickets_state | BTREE | Filter open/closed tickets |
| tickets | idx_tickets_owner_id | BTREE | Agent dashboard queries |
| tickets | idx_tickets_group_id | BTREE | Group/project manager queries |
| tickets | idx_tickets_zammad_updated_at | BTREE | Incremental sync ordering |
| tickets | idx_tickets_tags | GIN | Tag-based filtering for project tracking |
| tickets | idx_tickets_breached | BTREE | SLA breach queries (partial index) |
| ticket_articles | idx_articles_ticket_id | BTREE | Join with tickets table |
| ticket_articles | idx_articles_sender_time | BTREE (composite) | First reply time calculation |
| agent_performance_snapshots | idx_aps_agent_hour | BTREE (composite) | Trend queries by agent+hour |
| group_performance_snapshots | idx_gps_group_hour | BTREE (composite) | Trend queries by group+hour |
| notification_events | idx_notif_recipient_read | BTREE | Unread notifications query |

---

## 7. Queue Worker Architecture (Celery)

All background processing is handled by Celery 5.3+ with Redis 7 as the message broker. Workers are split into logical queues to allow independent scaling and priority control.

### 7.1 Queues & Worker Pools

| Queue Name | Priority | Concurrency | Assigned Tasks |
|---|---|---|---|
| `webhook` | CRITICAL | 8 | Process incoming Zammad webhook events immediately |
| `sync` | HIGH | 4 | Full/incremental ticket sync from Zammad REST API |
| `kpi` | NORMAL | 4 | KPI computation, snapshot generation |
| `alerts` | HIGH | 4 | Alert rule evaluation and notification dispatch |
| `exports` | LOW | 2 | PDF/Excel report generation (CPU-bound, separate pool) |
| `cleanup` | LOW | 1 | Data retention, expired file cleanup, log rotation |

### 7.2 Celery Beat — Scheduled Tasks

| Task | Schedule | Queue | Description |
|---|---|---|---|
| `sync_incremental` | Every 5 min | sync | Pull tickets updated since last sync from Zammad |
| `sync_full_reconcile` | Every 6 hours | sync | Full ticket/user/group reconciliation |
| `sync_sla_policies` | Every 1 hour | sync | Refresh SLA policies from Zammad |
| `compute_kpi_snapshots` | Every 2 min | kpi | Generate agent and group hourly snapshots |
| `evaluate_alert_rules` | Every 1 min | alerts | Check all active alert rules, fire if triggered |
| `cleanup_old_data` | Daily at 02:00 | cleanup | Delete records older than 30-day rolling window |
| `cleanup_expired_exports` | Every 1 hour | cleanup | Delete report files older than 24 hours |
| `health_check_zammad` | Every 5 min | sync | Verify Zammad API connectivity, alert on failure |

### 7.3 Key Worker Task Definitions

#### Webhook Processor (`webhook` queue)

- Validate HMAC-SHA256 signature against configured Zammad webhook secret
- Persist raw payload to `webhook_events` table immediately
- Fetch complete ticket data via Zammad REST API `GET /api/v1/tickets/{id}`
- Upsert ticket, articles, and related entities in PostgreSQL
- Trigger KPI recalculation for affected agent and group
- Publish WebSocket update message to Redis channel: `ws:tickets:{group_id}`
- Evaluate alert rules for affected ticket

#### KPI Snapshot Generator (`kpi` queue)

- Read tickets closed/updated in the last 2-minute window
- Compute: avg `first_reply_time_secs`, avg `resolution_time_secs`, breach counts
- Upsert `agent_performance_snapshots` and `group_performance_snapshots`
- Update Redis cache keys: `kpi:agent:{id}:current`, `kpi:group:{id}:current`
- Publish updated KPI to WebSocket channel for live dashboard refresh

#### Alert Engine (`alerts` queue)

- Load all active `alert_rules` from database
- For each rule, evaluate condition against current ticket/agent/group state
- Respect `cooldown_mins` to prevent duplicate alert storms
- For each triggered rule, create `notification_events` records per channel
- Fan out dispatch subtasks: `send_email`, `send_slack`, `send_whatsapp`, `send_telegram`, `push_in_app`

#### Export Generator (`exports` queue)

- Load `report_exports` record by task ID, update status to `generating`
- Query aggregated data from PostgreSQL within requested date range and scope
- For PDF: render Jinja2 HTML template → WeasyPrint → write to disk
- For Excel: build openpyxl workbook with formatted sheets → write to disk
- Update `report_exports` record: `status=ready`, `file_path`, `file_size_bytes`, `completed_at`
- Publish WebSocket notification to requesting user: export ready

---

## 8. Authentication & Authorization

### 8.1 Authentication Flow (Zammad Proxy Auth)

```
Client                    Zammad Monitor API             Zammad
  │                              │                          │
  │  POST /api/v1/auth/login     │                          │
  │  { login, password }         │                          │
  │─────────────────────────────►│                          │
  │                              │  GET /api/v1/users/me    │
  │                              │  Basic Auth (forwarded)  │
  │                              │─────────────────────────►│
  │                              │  200 OK { user data }    │
  │                              │◄─────────────────────────│
  │                              │                          │
  │                              │  Upsert user in DB       │
  │                              │  Map roles               │
  │                              │  Issue JWT (8h)          │
  │                              │                          │
  │  200 OK { token, user }      │                          │
  │◄─────────────────────────────│                          │
  │                              │                          │
  │  All subsequent requests:    │                          │
  │  Authorization: Bearer {JWT} │                          │
  │─────────────────────────────►│                          │
```

> **Security Note:** The user's Zammad credentials are NEVER stored by Zammad Monitor. They are used once to validate against the Zammad API and immediately discarded. The resulting JWT is the only credential managed by this system.

**Token specifications:**
- Algorithm: HS256
- Expiry: 8 hours
- Payload: `{ sub: user_uuid, role, group_ids, exp }`
- Storage: In-memory only (not localStorage)

### 8.2 Role-to-Permission Matrix

| Permission | Admin | Team Lead | Project Manager | Agent |
|---|:---:|:---:|:---:|:---:|
| View all tickets | ✅ | Group only | Assigned groups | Own only* |
| View all agents | ✅ | Group only | Assigned groups | ❌ |
| View KPI dashboards | ✅ (global) | ✅ (group) | ✅ (group) | ✅ (self) |
| View SLA status | ✅ (all) | ✅ (group) | ✅ (group) | ✅ (self) |
| Configure alert rules | ✅ (global) | ✅ (group) | ✅ (group) | ✅ (self only) |
| Configure notification channels | ✅ | ✅ | ✅ | ✅ |
| Configure role visibility | ✅ | ❌ | ❌ | ❌ |
| Trigger report export | ✅ (all) | ✅ (group) | ✅ (group) | ✅ (self) |
| Manage users | ✅ | ❌ | ❌ | ❌ |
| Manage system settings | ✅ | ❌ | ❌ | ❌ |
| View sync logs / health | ✅ | ❌ | ❌ | ❌ |

_* Agent visibility is 'Own only' by default but is configurable by Admin to 'Group peers visible'._

### 8.3 Zammad Role Mapping

| Zammad Role | Mapped Internal Role | Notes |
|---|---|---|
| Admin | `admin` | Full system access |
| Agent + tag `team_lead` | `team_lead` | Requires Zammad custom attribute or tag convention |
| Agent + tag `project_manager` | `project_manager` | Requires Zammad custom attribute or tag convention |
| Agent | `agent` | Default for all agents without special tags |
| Customer | Blocked | Customers cannot log in to Zammad Monitor |

---

## 9. Real-Time Architecture

### 9.1 WebSocket Design

FastAPI manages persistent WebSocket connections from all logged-in clients. Redis pub/sub is used as a fan-out bus so Celery workers can publish updates without knowing which API instance handles which client.

| WebSocket Room | Subscribers | Published By | Events |
|---|---|---|---|
| `/ws/global` | Admin only | Any worker | System health, sync status, global KPI updates |
| `/ws/group/{group_id}` | Admin, Team Lead, PM for that group | Webhook/KPI worker | Ticket updates, SLA changes, group KPI refresh |
| `/ws/agent/{agent_id}` | That agent + their Team Lead | Webhook/KPI worker | Own ticket updates, SLA countdown, personal KPI |
| `/ws/alerts/{user_id}` | Any authenticated user | Alert worker | Personal in-app notifications |
| `/ws/export/{user_id}` | User who triggered export | Export worker | Export progress and `ready` event |

### 9.2 WebSocket Message Envelope

```json
{
  "type": "ticket.updated",
  "payload": {
    "ticket_id": "uuid",
    "state": "open",
    "sla_breached": false,
    "first_response_remaining_secs": 1800
  },
  "timestamp": "2025-05-08T10:30:00Z",
  "room": "group/550e8400-e29b-41d4-a716-446655440000"
}
```

**Event types:**

| Event | Room | Description |
|---|---|---|
| `ticket.updated` | group, agent | Ticket state/SLA/owner changed |
| `ticket.sla_breach` | group, agent, alerts | SLA threshold exceeded |
| `kpi.refresh` | global, group, agent | New KPI snapshot available |
| `alert.fired` | alerts | Alert rule triggered |
| `export.ready` | export | Report generation complete |
| `sync.status` | global | Sync job status update |

---

## 10. Alert System

### 10.1 Alert Channels

| Channel | Mechanism | Config Required | Notes |
|---|---|---|---|
| In-App | WebSocket push to `/ws/alerts/{user_id}` | None | Always available; stored in `notification_events` |
| Email | SMTP via aiosmtplib + Jinja2 HTML template | SMTP host, port, credentials | System-level SMTP config in settings table |
| Slack | HTTP POST to Slack Incoming Webhook URL | Webhook URL per user/team | Supports Block Kit formatted messages |
| Microsoft Teams | HTTP POST to Teams Incoming Webhook URL | Webhook URL per user/team | Adaptive Card format |
| WhatsApp | Meta Cloud API or Twilio WhatsApp API | API key + phone number | Template messages only (Meta policy) |
| Telegram | Telegram Bot API `sendMessage` | Bot token + `chat_id` per user | Plain text or Markdown format |

### 10.2 Alert Rule Conditions

| Condition Type | Parameters | Example Trigger |
|---|---|---|
| `sla_breach` | `{ escalation_type: first_response\|update\|close }` | Ticket first response SLA breached |
| `sla_approaching` | `{ minutes_before: 15, escalation_type: ... }` | SLA deadline within 15 minutes |
| `ticket_open_too_long` | `{ threshold_hours: 24, priority: "high" }` | High priority ticket open > 24 hours |
| `high_agent_workload` | `{ threshold_open_tickets: 20 }` | Agent has > 20 open tickets simultaneously |
| `ticket_reopened` | `{ reopen_count_gte: 1 }` | Any ticket is reopened after closure |
| `no_activity` | `{ threshold_hours: 8, state: "open" }` | Open ticket has no update for 8 hours |

### 10.3 Alert Delivery Pipeline

```
Celery Beat (every 1 min)
    │
    ▼
evaluate_alert_rules task
    │
    ├── Load all active alert_rules
    ├── For each rule:
    │       ├── Query tickets/agents matching condition
    │       ├── Check cooldown (skip if fired recently)
    │       └── Create notification_events for each channel
    │
    ▼
Channel dispatch subtasks (parallel):
    ├── push_in_app     → WebSocket to /ws/alerts/{user_id}
    ├── send_email      → SMTP via aiosmtplib
    ├── send_slack      → HTTP POST to webhook URL
    ├── send_teams      → HTTP POST to webhook URL
    ├── send_telegram   → Telegram Bot API
    └── send_whatsapp   → Meta Cloud API / Twilio
```

---

## 11. Frontend Design & Page Specifications

### 11.1 Application Shell

- Persistent left sidebar navigation — collapses to icon-only on small screens
- Top header bar: current user name, role badge, unread notification bell, settings shortcut
- Notification drawer: slide-out panel showing all in-app alerts with read/unread state
- Global WebSocket status indicator (connected / reconnecting / offline)
- Dark mode support via Tailwind CSS `dark:` classes — user preference stored in localStorage
- Fully responsive down to 768px tablet width

### 11.2 Page Inventory

| Route | Page Name | Roles | Description |
|---|---|---|---|
| `/login` | Login | All (unauthenticated) | Zammad credential input, auth via proxy API |
| `/dashboard` | Home Dashboard | All | Role-specific KPI summary, quick stats, recent alerts |
| `/tickets` | Ticket List | All | Filterable/sortable ticket table with SLA indicators |
| `/tickets/:id` | Ticket Detail | All | Timeline, SLA countdown, article history, tags |
| `/agents` | Agent Overview | Admin, TL | All agents: open count, SLA status, KPI mini-cards |
| `/agents/:id` | Agent Detail | Admin, TL, Agent (own) | Full KPI history charts for one agent |
| `/groups` | Group Overview | Admin, TL, PM | Group-level KPI table and trend sparklines |
| `/groups/:id` | Group Detail | Admin, TL, PM | Ticket list + KPI charts scoped to one group |
| `/sla` | SLA Monitor | Admin, TL, PM | SLA breach heatmap, at-risk ticket list, trend |
| `/performance` | Performance | Admin, TL, PM | Agent ranking table, KPI trend charts, comparisons |
| `/reports` | Reports | All (scoped) | On-demand export builder: type, date range, format |
| `/alerts` | Alert Rules | All (scoped) | CRUD alert rules, channel config, notification prefs |
| `/settings` | System Settings | Admin only | Zammad connection, SMTP, retention, role mappings |
| `/settings/channels` | Channel Settings | All | Configure personal Slack/Telegram/WhatsApp/Email |

### 11.3 Dashboard Home — Per Role Layout

#### Admin Dashboard

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Total Open  │Agents Online│ SLA Breach  │ Avg Resolu- │
│  Tickets    │             │ Rate Today  │  tion Time  │
└─────────────┴─────────────┴─────────────┴─────────────┘
┌───────────────────────────┬─────────────────────────────┐
│ Ticket Volume (30d bar)   │ SLA Breach Trend (line)     │
└───────────────────────────┴─────────────────────────────┘
┌───────────────────────────┬─────────────────────────────┐
│ Agent Workload Table      │ Recent Alerts Feed          │
│ (name, open, at-risk)     │                             │
└───────────────────────────┴─────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ Sync Health: Last sync 2m ago | Zammad API: ✅ Online   │
└─────────────────────────────────────────────────────────┘
```

#### Team Lead Dashboard

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Group Open  │ Agents in   │ Group SLA   │ Avg First   │
│  Tickets    │   Group     │ Breach Rate │  Reply Time │
└─────────────┴─────────────┴─────────────┴─────────────┘
┌───────────────────────────┬─────────────────────────────┐
│ Agent Workload Bar Chart  │ SLA At-Risk Ticket List     │
│ (open tickets per agent)  │                             │
└───────────────────────────┴─────────────────────────────┘
┌───────────────────────────┬─────────────────────────────┐
│ Recent Group Activity     │ Top Breached This Week      │
└───────────────────────────┴─────────────────────────────┘
```

#### Project Manager Dashboard

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Total Group │  Resolved   │ SLA Breach  │  Reopen     │
│  Tickets    │   Today     │    Rate     │    Rate     │
└─────────────┴─────────────┴─────────────┴─────────────┘
┌───────────────────────────┬─────────────────────────────┐
│ Tickets by Tag/Project    │ Resolution Time Trend       │
│ (donut chart)             │ (line chart)                │
└───────────────────────────┴─────────────────────────────┘
┌───────────────────────────┬─────────────────────────────┐
│ Group Ticket Table        │ Priority Distribution       │
│ (status breakdown)        │ (stacked bar)               │
└───────────────────────────┴─────────────────────────────┘
```

#### Agent Dashboard

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│  My Open    │ My SLA At-  │ My Avg 1st  │  My Reopen  │
│  Tickets    │    Risk     │ Reply Time  │    Rate     │
└─────────────┴─────────────┴─────────────┴─────────────┘
┌─────────────────────────────────────────────────────────┐
│ My Open Tickets Table                                   │
│ # | Title | Priority | SLA Countdown | State | Updated │
│ ─ Green (safe) | Amber (<2h) | Red (breached) ─        │
└─────────────────────────────────────────────────────────┘
┌───────────────────────────┬─────────────────────────────┐
│ First Reply Trend (7d)    │ Resolution Time Trend (7d)  │
└───────────────────────────┴─────────────────────────────┘
```

### 11.4 SLA Monitor Page

- **At-Risk Tickets table** — sorted by closest SLA deadline (nearest first)
- **SLA status badges** — `🟢 On Track` | `🟡 Warning <2h` | `🔴 Breached`
- **Live countdown timers** — ticking per row, colour transitions at thresholds
- **SLA Breach Heatmap** — 7-day × 24-hour grid showing breach concentration
- **Filter controls** — by group, agent, priority, SLA type (first_response / update / close)
- **Summary bar** — total breached today | total at-risk now | trend arrow

### 11.5 Ticket List Page

- TanStack Table with server-side sorting, filtering, cursor-based pagination
- **Columns:** `#` | Title | State (badge) | Priority | Group | Agent | SLA Status | Updated | Actions
- **Quick filters:** State tabs (All / New / Open / Pending / Closed), Priority, Group
- **Search bar:** full-text search by ticket title or number
- **SLA column:** countdown or `Breached (+2h 14m)` badge
- **Reopen indicator:** shows count badge if reopened
- Row click → `/tickets/:id` detail page

### 11.6 SLA Status Color System

| Status | Condition | Color | Badge Text |
|---|---|---|---|
| Safe | > 2 hours remaining | Green `#16a34a` | `On Track` |
| Warning | < 2 hours remaining | Amber `#d97706` | `At Risk` |
| Critical | < 30 minutes remaining | Orange `#ea580c` | `Critical` |
| Breached | Past deadline | Red `#dc2626` | `Breached +Xh Ym` |

---

## 12. API Endpoint Reference

### 12.1 Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/login` | None | Proxy auth via Zammad, returns JWT |
| POST | `/api/v1/auth/logout` | JWT | Client-side JWT invalidation |
| GET | `/api/v1/auth/me` | JWT | Current user profile and role |

### 12.2 Tickets

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/tickets` | JWT | List tickets (paginated, filtered by role scope) |
| GET | `/api/v1/tickets/:id` | JWT | Single ticket with articles and SLA data |
| GET | `/api/v1/tickets/:id/timeline` | JWT | Ticket activity timeline |
| GET | `/api/v1/tickets/sla-at-risk` | JWT | Tickets approaching SLA deadline |
| GET | `/api/v1/tickets/breached` | JWT | All breached tickets in scope |

### 12.3 KPIs & Performance

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/kpi/summary` | JWT | Current KPI summary for the caller's scope |
| GET | `/api/v1/kpi/agents/:id/trend` | JWT | Agent KPI trend (hourly, last N days) |
| GET | `/api/v1/kpi/groups/:id/trend` | JWT | Group KPI trend (hourly, last N days) |
| GET | `/api/v1/kpi/sla-breach-rate` | JWT | SLA breach rate over time |
| GET | `/api/v1/kpi/volume` | JWT | Ticket volume over time |

### 12.4 Agents & Groups

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/agents` | JWT (Admin/TL) | List all agents with current workload stats |
| GET | `/api/v1/agents/:id` | JWT | Agent profile + full KPI history |
| GET | `/api/v1/groups` | JWT | List groups in caller's scope |
| GET | `/api/v1/groups/:id/stats` | JWT | Group performance stats and ticket breakdown |

### 12.5 Alerts & Notifications

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/alert-rules` | JWT | List alert rules in caller's scope |
| POST | `/api/v1/alert-rules` | JWT | Create new alert rule |
| PUT | `/api/v1/alert-rules/:id` | JWT | Update alert rule |
| DELETE | `/api/v1/alert-rules/:id` | JWT | Delete alert rule |
| GET | `/api/v1/notifications` | JWT | List in-app notifications for caller |
| PATCH | `/api/v1/notifications/:id/read` | JWT | Mark notification as read |
| PATCH | `/api/v1/notifications/read-all` | JWT | Mark all notifications as read |
| GET | `/api/v1/channels` | JWT | List caller's notification channel configs |
| POST | `/api/v1/channels` | JWT | Add/update a notification channel |
| POST | `/api/v1/channels/:id/test` | JWT | Send test message to verify channel |

### 12.6 Reports & Exports

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/reports/export` | JWT | Queue a new on-demand export job |
| GET | `/api/v1/reports/exports` | JWT | List caller's past export jobs |
| GET | `/api/v1/reports/exports/:id/status` | JWT | Poll export job status |
| GET | `/api/v1/reports/exports/:id/download` | JWT | Download the generated file (streamed) |

### 12.7 Webhooks & System

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/webhooks/zammad` | HMAC Secret | Receive Zammad webhook events |
| GET | `/api/v1/system/health` | None | Service health check |
| GET | `/api/v1/system/sync-status` | JWT (Admin) | Last sync time, errors, Zammad API status |
| POST | `/api/v1/system/sync/trigger` | JWT (Admin) | Manually trigger a full sync |

### 12.8 Standard Response Envelopes

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 142,
    "next_cursor": "abc123"
  }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "SLA_001",
    "message": "Ticket not found",
    "detail": {}
  }
}
```

---

## 13. KPI Definitions & Calculation Logic

### 13.1 First Reply Time

**Definition:** Elapsed time from ticket creation to the first non-customer, non-system article on the ticket.

- **Formula:** `min(ticket_articles.zammad_created_at WHERE sender = 'agent' AND internal = false) - tickets.zammad_created_at`
- **Unit:** Seconds (displayed as `Xh Ym`)
- **Aggregation:** Average per agent per time window
- **Condition:** Only calculated when ticket has at least one agent article
- **Stored in:** `tickets.first_reply_time_secs`

### 13.2 Resolution Time

**Definition:** Elapsed time from ticket creation to ticket reaching `closed` state.

- **Formula:** `tickets.closed_at - tickets.zammad_created_at`
- **Unit:** Seconds (displayed as hours or days)
- **Aggregation:** Average per agent and per group per time window
- **Stored in:** `tickets.resolution_time_secs`

### 13.3 SLA Breach Rate

**Definition:** Percentage of SLA-applicable tickets that breached any of their SLA thresholds.

- **Formula:** `COUNT(tickets WHERE first_response_breached OR update_breached OR close_breached) / COUNT(tickets WHERE sla_policy_id IS NOT NULL) × 100`
- **Calculated per:** Agent, Group, Global — each as independent rates
- **Time window:** Configurable (today / 7 days / 30 days)
- **Source data:** `tickets.first_response_breached`, `update_breached`, `close_breached`

### 13.4 Ticket Reopen Rate

**Definition:** Percentage of resolved tickets that were subsequently reopened at least once.

- **Formula:** `COUNT(tickets WHERE reopen_count >= 1 AND state IN ('closed')) / COUNT(tickets WHERE state IN ('closed')) × 100`
- **Tracking mechanism:** `tickets.reopen_count` — incremented each time Zammad fires a webhook where state transitions from `closed → open`
- **Aggregation:** Per agent, per group, global

> **Note:** All KPI calculations run in Celery worker processes against the local PostgreSQL database — never hitting the Zammad API at query time. This ensures dashboard response times are fast (<200ms) regardless of Zammad server load. The KPI snapshot tables are the primary data source for all chart endpoints.

---

## 14. Report Export System

### 14.1 Export Flow

```
User configures report
    │ POST /api/v1/reports/export
    ▼
Backend creates report_exports record (status: queued)
    │ Returns export_id
    ▼
Frontend subscribes to /ws/export/{user_id}
    │
    ▼
Celery Export Worker picks up job
    ├── Queries aggregated data from PostgreSQL
    ├── Renders file (PDF via WeasyPrint / Excel via openpyxl)
    └── Writes to EXPORT_STORAGE_PATH on disk
    │
    ▼
Updates report_exports: status=ready
    │
    ▼
Publishes WebSocket: { type: "export.ready", export_id }
    │
    ▼
User downloads: GET /api/v1/reports/exports/:id/download
    │ (Streamed file response)
    ▼
File auto-expires after 24 hours (cleanup worker)
```

### 14.2 Available Report Types

| Report Type | Format | Key Columns |
|---|---|---|
| **Agent Performance** | PDF + Excel | Agent, Open, Closed, Avg First Reply, Avg Resolution, SLA Breach Rate, Reopen Rate |
| **SLA Summary** | PDF + Excel | Ticket #, Title, Group, Agent, SLA Policy, Breach Type, Minutes Overdue |
| **Ticket Volume** | PDF + Excel | Date, New, Closed, Pending, Total Open, By Priority Breakdown |
| **Group Statistics** | PDF + Excel | Group, Agents, Open, Closed, Avg Resolution, SLA Breach Rate |

### 14.3 Export Technical Notes

- PDF generation via **WeasyPrint** — Jinja2 HTML template rendered to PDF
- Excel generation via **openpyxl** — multiple sheets with formatted headers, alternating row colors, auto-width columns
- Files stored in `EXPORT_STORAGE_PATH` (default: `/data/exports`)
- File naming: `{report_type}_{scope}_{date_from}_{date_to}_{user_id}.{ext}`
- Auto-expiry: 24 hours after generation (enforced by cleanup worker)
- Download streamed via `StreamingResponse` — no double file load into memory

---

## 15. Security Design

### 15.1 Authentication & Session

- JWT signed with HS256 using a 256-bit secret stored as environment variable
- JWT expiry: 8 hours — no refresh token (re-auth required)
- Credentials never stored — Zammad credential used once per login and discarded
- HTTPS enforced via Nginx TLS termination (Let's Encrypt or self-signed for intranet)

### 15.2 Webhook Security

- All Zammad webhooks validated with HMAC-SHA256 signature in `X-Hub-Signature-256` header
- Webhook secret configured in both Zammad and Zammad Monitor settings table
- Requests with invalid or missing signatures rejected with HTTP 401
- Raw payloads stored in `webhook_events` for replay/audit purposes

### 15.3 Authorization

- Every API endpoint enforces RBAC via FastAPI dependency injection
- Data scoping applied at query level — users cannot access data outside their `visibility_config`
- Admin-only endpoints return HTTP 403 for non-admin JWT tokens
- Visibility configuration changes are logged

### 15.4 Data Protection

- PostgreSQL connection uses SSL in production
- Redis connection requires AUTH password
- Environment variables used for all secrets (no secrets in code or Docker images)
- Export files stored with restricted filesystem permissions (`chmod 640`)
- Report files auto-expire after 24 hours
- 30-day data retention strictly enforced by cleanup worker

### 15.5 Rate Limiting

| Endpoint Category | Rate Limit |
|---|---|
| `/api/v1/auth/login` | 10 requests / minute / IP |
| `/api/v1/webhooks/zammad` | 500 requests / minute |
| All other authenticated endpoints | 300 requests / minute / user |
| `/api/v1/reports/export` (POST) | 5 requests / hour / user |

---

## 16. Non-Functional Requirements

### 16.1 Performance Targets

| Metric | Target | Notes |
|---|---|---|
| API response time (p95) | < 200ms | Excluding export generation |
| Dashboard initial load | < 2 seconds | All KPI cards populated |
| WebSocket update delivery | < 500ms from webhook receipt | End-to-end ticket update latency |
| Webhook processing time | < 3 seconds per event | From receipt to DB write + WS push |
| KPI snapshot freshness | < 2 minutes | Celery Beat schedule |
| Report PDF generation | < 30 seconds | Up to 30 days of data |
| Report Excel generation | < 15 seconds | Up to 30 days of data |
| Concurrent WebSocket clients | 100+ | Medium scale target |

### 16.2 Reliability & Availability

- Target uptime: 99.5% (self-hosted, excluding planned maintenance)
- Celery workers use retry with exponential backoff on Zammad API failures
- Webhook events persisted before processing — no event loss on worker crash
- Docker Compose `restart: unless-stopped` on all services
- Health check endpoint used by Docker Compose healthcheck directives

### 16.3 Scalability

- Celery worker pools independently scalable per queue via `--concurrency` flag
- Redis pub/sub supports horizontal FastAPI scaling behind Nginx upstream
- PostgreSQL connection pooling via SQLAlchemy `AsyncSession` with `asyncpg`
- Stateless FastAPI containers — multiple replicas possible behind Nginx load balancer

### 16.4 Observability

- Structured JSON logging via Python `structlog` on all services
- Celery task monitoring via Flower dashboard (optional, port 5555)
- `sync_logs` table provides full audit trail of all data sync operations
- `webhook_events` table enables replay/debug of any missed event
- `/api/v1/system/health` exposes service dependency health (DB, Redis, Zammad API)

---

## 17. Deployment Architecture

### 17.1 Docker Compose Service Map

| Service | Port (internal) | Exposed | Health Check |
|---|---|---|---|
| `nginx` | 80, 443 | 80, 443 | `HTTP GET /health` |
| `api` (FastAPI) | 8000 | No (via nginx) | `GET /api/v1/system/health` |
| `worker` (Celery) | — | No | `celery inspect ping` |
| `beat` (Celery Beat) | — | No | Process liveness |
| `redis` | 6379 | No | `redis-cli ping` |
| `postgres` | 5432 | No | `pg_isready` |
| `flower` (optional) | 5555 | Configurable | `HTTP GET /` |

### 17.2 Docker Compose Skeleton

```yaml
version: "3.9"

services:
  nginx:
    image: nginx:1.25-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d
      - ./nginx/ssl:/etc/nginx/ssl
      - frontend_dist:/usr/share/nginx/html
    depends_on: [api]

  api:
    build: ./backend
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - ZAMMAD_BASE_URL=${ZAMMAD_BASE_URL}
      - ZAMMAD_API_TOKEN=${ZAMMAD_API_TOKEN}
      - ZAMMAD_WEBHOOK_SECRET=${ZAMMAD_WEBHOOK_SECRET}
    depends_on: [postgres, redis]
    restart: unless-stopped

  worker:
    build: ./backend
    command: celery -A app.worker worker -Q webhook,sync,kpi,alerts,exports,cleanup --loglevel=info
    environment: *api-env
    depends_on: [postgres, redis]
    restart: unless-stopped

  beat:
    build: ./backend
    command: celery -A app.worker beat --loglevel=info
    environment: *api-env
    depends_on: [postgres, redis]
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes: [redis_data:/data]
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: zammad_monitor
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes: [postgres_data:/var/lib/postgresql/data]
    restart: unless-stopped

  flower:
    image: mher/flower
    command: celery flower --broker=${REDIS_URL}
    ports: ["5555:5555"]
    depends_on: [redis]
    profiles: ["monitoring"]

volumes:
  postgres_data:
  redis_data:
  frontend_dist:
```

### 17.3 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ZAMMAD_BASE_URL` | ✅ | Zammad instance URL (e.g., `https://support.company.com`) |
| `ZAMMAD_API_TOKEN` | ✅ | Zammad API token with read access to all tickets |
| `ZAMMAD_WEBHOOK_SECRET` | ✅ | HMAC secret shared with Zammad webhook config |
| `DATABASE_URL` | ✅ | PostgreSQL connection string (asyncpg driver) |
| `REDIS_URL` | ✅ | Redis connection string with AUTH password |
| `JWT_SECRET_KEY` | ✅ | 256-bit random secret for JWT signing |
| `JWT_EXPIRY_HOURS` | No | JWT token lifetime in hours (default: `8`) |
| `EXPORT_STORAGE_PATH` | No | Filesystem path for generated reports (default: `/data/exports`) |
| `SMTP_HOST` | No | SMTP server hostname for email alerts |
| `SMTP_PORT` | No | SMTP port (default: `587`) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASSWORD` | No | SMTP password |
| `SMTP_FROM_EMAIL` | No | From address for alert emails |
| `DATA_RETENTION_DAYS` | No | Days to retain data (default: `30`) |
| `LOG_LEVEL` | No | Logging level: `DEBUG \| INFO \| WARNING \| ERROR` (default: `INFO`) |

### 17.4 Nginx Configuration Highlights

```nginx
server {
    listen 443 ssl http2;

    # Frontend SPA
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    # API reverse proxy
    location /api/ {
        proxy_pass http://api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket upgrade
    location /ws/ {
        proxy_pass http://api:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

---

## 18. Development Roadmap & Phases

### Phase 1 — Foundation _(Weeks 1–3)_

**Goal:** Working infrastructure, data pipeline, and authentication.

- Docker Compose infrastructure setup (postgres, redis, nginx, fastapi, celery)
- Database schema creation with Alembic migrations
- Zammad REST API client (httpx) with auth, retry, rate limiting
- Webhook receiver endpoint with HMAC validation
- Full ticket sync worker (Celery task)
- Incremental sync worker + Celery Beat schedule
- JWT authentication with Zammad proxy auth
- User model and role mapping logic
- FastAPI project structure with dependency injection
- Basic unit tests for sync and auth flows

**Deliverable:** Data flowing from Zammad into PostgreSQL, authentication working.

---

### Phase 2 — Core API & Real-Time _(Weeks 4–6)_

**Goal:** All API endpoints working, frontend shell running, live updates functional.

- All REST API endpoints (tickets, agents, groups, KPI)
- WebSocket hub with Redis pub/sub fan-out
- KPI Snapshot Engine (Celery worker + Beat schedule)
- Role-based access control on all endpoints
- React project setup (Vite, TypeScript, Tailwind, shadcn/ui)
- Login page + JWT auth context
- Application shell: sidebar, header, notification bell
- Home Dashboard page (all 4 role variants)
- Ticket List page with TanStack Table

**Deliverable:** Dashboard live with real data, WebSocket updates working.

---

### Phase 3 — Monitoring & Alerts _(Weeks 7–9)_

**Goal:** Full alert system across all 6 channels, SLA monitoring pages.

- Alert Rules engine (Celery worker + Beat schedule)
- In-App notification system (WebSocket push)
- Email alert channel (aiosmtplib + Jinja2)
- Slack alert channel
- Teams alert channel
- Telegram alert channel
- WhatsApp alert channel
- Channel configuration UI in Settings
- Alert Rules management UI
- SLA Monitor page with live countdown timers
- Agent Overview and Agent Detail pages

**Deliverable:** Admins receiving alerts across all channels, SLA monitor live.

---

### Phase 4 — Analytics & Exports _(Weeks 10–12)_

**Goal:** Full analytics, on-demand exports, production-ready deployment.

- Agent Performance page with KPI trend charts
- Group Statistics page
- Report Export queue worker (WeasyPrint PDF + openpyxl Excel)
- Report builder UI page
- WebSocket progress updates for export jobs
- Data Retention cleanup worker
- Admin System Settings page
- Role visibility configuration UI
- End-to-end integration testing
- Production deployment documentation
- Security hardening review

**Deliverable:** Full production-ready system, all features shipped.

---

## 19. Open Questions & Assumptions

### 19.1 Open Questions Requiring Decision

| # | Question | Impact | Owner |
|---|---|---|---|
| 1 | How are 'Team Lead' and 'Project Manager' roles identified in Zammad? Via custom attributes, tags, or a separate mapping table in this app? | **High** — affects auth flow | Admin Team |
| 2 | Which WhatsApp provider will be used — Meta Cloud API (free, complex setup) or Twilio (paid, simpler)? | **Medium** — affects cost + implementation | Engineering |
| 3 | Will the export storage path be a local disk path, or is NFS/shared storage needed for multi-replica deployments? | **Medium** — affects Phase 1 infra | Engineering |
| 4 | Should the Zammad API token be a system admin token (full read access) or scoped per-user? | **High** — affects security model | Admin Team |
| 5 | Are there custom ticket fields in Zammad that need to be tracked (e.g., project name, customer tier, contract type)? | **Medium** — affects filtering/reporting | Business Owner |

### 19.2 Assumptions Made in This PRD

- Zammad version **6.x or later** is in use (REST API v1 compatible)
- Webhook delivery from Zammad to Zammad Monitor is possible on the network (same subnet or accessible via VPN)
- A PostgreSQL 15 server is available or will be provisioned via Docker Compose
- Business hours calendars for SLA calculation are fully managed in Zammad — not replicated in this system
- CSAT scores are not currently enabled in the Zammad instance
- The 'Team Lead' and 'Project Manager' roles will be distinguished via Zammad user tags or a custom attribute named `monitor_role`
- Self-signed TLS certificates are acceptable for intranet-only deployment
- A minimum of **8GB RAM and 4 CPU cores** are available on the host server for all Docker services
- The Zammad API token used for sync has at minimum `ticket.read`, `user.read`, `group.read`, and `sla.read` permissions

---

## 20. Glossary

| Term | Definition |
|---|---|
| **SLA** | Service Level Agreement — a time-bound commitment to respond to or resolve a ticket |
| **SLA Breach** | A ticket that exceeded its SLA deadline (first response, update, or close) |
| **First Reply Time** | Time from ticket creation to first non-automated agent response |
| **Resolution Time** | Time from ticket creation to ticket being moved to 'closed' state |
| **Reopen Rate** | Percentage of resolved tickets that were subsequently reopened |
| **KPI** | Key Performance Indicator — a quantifiable measure of performance |
| **Celery Beat** | A periodic task scheduler for Celery — equivalent to a cron daemon |
| **Webhook** | An HTTP callback fired by Zammad when a ticket event occurs |
| **HMAC** | Hash-based Message Authentication Code — used to verify webhook authenticity |
| **JWT** | JSON Web Token — a signed, self-contained authentication token |
| **Fan-out** | Broadcasting one message to multiple WebSocket subscribers via Redis pub/sub |
| **Snapshot** | A point-in-time record of computed KPIs stored for historical trend queries |
| **Proxy Auth** | Using Zammad's own API to validate credentials without storing them locally |
| **asyncpg** | A high-performance async PostgreSQL driver for Python |
| **Cursor Pagination** | Pagination using an opaque cursor token instead of page numbers — stable under concurrent writes |

---

*© 2025 Internal Engineering — All Rights Reserved*
*Zammad Monitor PRD v1.0 — CONFIDENTIAL*