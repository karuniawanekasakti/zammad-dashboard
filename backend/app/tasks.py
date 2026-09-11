"""Celery tasks: periodic Zammad -> PostgreSQL sync.

Async core (run_incremental_sync / run_full_sync / sync_ticket_core) is shared with
FastAPI routers and the check_sync.py self-check. Celery tasks are thin sync wrappers
calling asyncio.run(). Each run creates its OWN engine + Redis client bound to that
run's event loop, then disposes them — asyncpg/redis clients are loop-bound, so a
module-level pool shared across asyncio.run() invocations would leak across loops.
"""
import asyncio
import json
from collections import Counter
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from time import perf_counter
from typing import Literal

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.celery_app import celery
from app.config import settings
from app.db_models import SettingRow
from app.repositories import get_setting, set_setting
from app.routers.agents import _group_ids, _map_agent
from app.routers.groups import _map_group
from app.routers.tickets import OPEN_STATES, _map_article, _map_history, _map_state, _map_ticket
from app.sync_operation import HEARTBEAT_SECONDS, LEASE_SECONDS, acquire, owns_lease, owns_token, release, renew, utcnow, with_progress
from app.zammad_client import zammad

SYNC_WATERMARK_KEY = "sync:last_ticket_updated_at"
LAST_RUN_KEY = "sync:last_run"
LAST_SUCCESS_KEY = "sync:last_successful_checkpoint"


def _map_groups(raw_groups: list[dict], raw_users: list[dict]):
    agent_counts = Counter(g for user in raw_users for g in _group_ids(user))
    return [_map_group(g, agent_counts[str(g["id"])]) for g in raw_groups]


def _missing_sla_fields(ticket: dict) -> bool:
    return _map_state(ticket.get("state") or "open") in OPEN_STATES and not (ticket.get("first_response_escalation_at") or ticket.get("close_escalation_at"))


async def _with_sla_details(raw_tickets: list[dict]) -> list[dict]:
    rows = []
    for ticket in raw_tickets:
        if not _missing_sla_fields(ticket):
            rows.append(ticket)
            continue
        try:
            # ponytail: accurate SLA detail beats sync speed; batch/limit this if Zammad sync gets slow.
            rows.append(await zammad.get_ticket(ticket["id"]))
        except Exception:
            rows.append(ticket)
    return rows


async def _sync_ticket_histories(session, ticket_ids: list[int], progress=None) -> int:
    """Fetch each ticket's history from Zammad and upsert the entries.

    One HTTP call per ticket (Zammad has no bulk history endpoint); failures are
    swallowed so one bad ticket can't fail the whole sync. Idempotent: rows are
    keyed by Zammad's history entry id, so re-runs upsert instead of duplicating.
    """
    from app.db_models import TicketHistoryRow
    from app.repositories import _upsert

    synced = 0
    for completed, ticket_id in enumerate(ticket_ids, 1):
        try:
            rows = _map_history(await zammad.get_ticket_history(ticket_id), ticket_id)
            for row in rows:
                await _upsert(session, TicketHistoryRow, row.model_dump())
            # Commit per ticket: history syncs thousands of rows over a long run, so a
            # single end-of-run commit would hold a table lock for the whole run and
            # lose all progress if interrupted. Per-ticket commits make it resumable.
            await session.commit()
        except Exception:
            await session.rollback()
        else:
            synced += 1
        if progress:
            await progress(synced, completed, len(ticket_ids))
    return synced


async def _with_engine(db_coro: Callable[[async_sessionmaker], Awaitable]):
    """Run db_coro against a fresh engine+session, dispose engine after."""
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        return await db_coro(session_factory)
    finally:
        await engine.dispose()


async def _invalidate_caches() -> None:
    r = Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        for prefix in ("tickets:*", "agents:*", "groups:*", "kpi:*"):
            async for key in r.scan_iter(match=prefix):
                await r.delete(key)
    finally:
        await r.aclose()


async def _record_last_run(kind: str, counts: dict, started_wall: datetime, started_mono: float, status: str) -> None:
    """Write sync-run telemetry and advance freshness only on success."""
    async def _do(session_factory):
        async with session_factory() as session:
            finished_at = datetime.now(timezone.utc)
            await set_setting(
                session,
                LAST_RUN_KEY,
                {
                    "kind": kind,
                    "triggered_by": "beat",
                    "tickets": counts.get("tickets", 0),
                    "users": counts.get("users", 0),
                    "groups": counts.get("groups", 0),
                    "duration_secs": round(perf_counter() - started_mono, 1),
                    "started_at": started_wall.isoformat(),
                    "finished_at": finished_at.isoformat(),
                    "status": status,
                },
            )
            if status == "ok":
                await set_setting(session, LAST_SUCCESS_KEY, {"value": finished_at.isoformat()})

    try:
        await _with_engine(_do)
    except Exception:
        pass  # telemetry write failure must not fail the sync


async def run_incremental_sync(progress=None, record_run: bool = True, advance_watermark: bool = True) -> dict:
    """Pull tickets updated since the last sync watermark, upsert them."""
    from app.db_models import TicketRow
    from app.repositories import _upsert

    started_wall = datetime.now(timezone.utc)
    started_mono = perf_counter()
    updated_since = None

    async def _do(session_factory):
        nonlocal updated_since
        async with session_factory() as session:
            if progress:
                await progress("fetching_tickets")
            setting = await get_setting(session, SYNC_WATERMARK_KEY)
            if setting:
                updated_since = setting.get("value")
            raw = await _with_sla_details(await zammad.get_all_tickets(per_page=100, updated_since=updated_since))
            tickets = [_map_ticket(t) for t in raw]
            for t in tickets:
                await _upsert(session, TicketRow, t.model_dump())
            # Refresh history only for tickets that changed since the watermark.
            if progress:
                await progress("syncing_histories", {"tickets": len(tickets)})

            async def history_progress(synced: int, completed: int, total: int) -> None:
                if progress:
                    await progress("syncing_histories", {"histories": synced}, completed, total)

            histories = await _sync_ticket_histories(session, [t["id"] for t in raw], history_progress)
            if progress:
                await progress("finalizing", {"tickets": len(tickets), "histories": histories})
            await session.commit()
            # Advance watermark to now, not to a ticket's updated_at (a stale ticket
            # would pin the watermark to the past and stall future increments).
            if advance_watermark:
                await set_setting(session, SYNC_WATERMARK_KEY, {"value": datetime.now(timezone.utc).isoformat()})
        return len(tickets)

    try:
        count = await _with_engine(_do)
        if record_run:
            await _record_last_run("incremental", {"tickets": count}, started_wall, started_mono, "ok")
        await _invalidate_caches()
        return {"synced": count, "updated_since": updated_since}
    except Exception:
        if record_run:
            await _record_last_run("incremental", {}, started_wall, started_mono, "error")
        raise


async def run_full_sync(progress=None, record_run: bool = True, advance_watermark: bool = True) -> dict:
    """Full reconcile: tickets (all), users, groups."""
    from app.db_models import GroupRow, TicketRow, UserRow
    from app.repositories import _upsert

    started_wall = datetime.now(timezone.utc)
    started_mono = perf_counter()
    counts: dict = {}

    async def _do(session_factory):
        if progress:
            await progress("fetching_tickets")
        raw_tickets = await _with_sla_details(await zammad.get_all_tickets(per_page=100))
        if progress:
            await progress("fetching_users", {"tickets": len(raw_tickets)})
        raw_users = await zammad.get_users(per_page=200)
        if progress:
            await progress("fetching_groups", {"tickets": len(raw_tickets), "users": len(raw_users)})
        raw_groups = await zammad.get_groups()

        tickets = [_map_ticket(t) for t in raw_tickets]
        users = [_map_agent(u) for u in raw_users]
        groups = _map_groups(raw_groups, raw_users)

        async with session_factory() as session:
            for t in tickets:
                await _upsert(session, TicketRow, t.model_dump())
            for u in users:
                await _upsert(session, UserRow, u.model_dump(mode="json"))
            for g in groups:
                await _upsert(session, GroupRow, g.model_dump(mode="json"))
            # ponytail: one history call per ticket; this is the backfill path for
            # accurate open-at timestamps, so it's slow on first run by design.
            processed = {"tickets": len(tickets), "users": len(users), "groups": len(groups)}
            if progress:
                await progress("syncing_histories", processed)

            async def history_progress(synced: int, completed: int, total: int) -> None:
                if progress:
                    await progress("syncing_histories", {"histories": synced}, completed, total)

            histories = await _sync_ticket_histories(session, [t["id"] for t in raw_tickets], history_progress)
            if progress:
                await progress("finalizing", {**processed, "histories": histories})
            await session.commit()
            if advance_watermark:
                await set_setting(session, SYNC_WATERMARK_KEY, {"value": datetime.now(timezone.utc).isoformat()})

        counts.update(tickets=len(tickets), users=len(users), groups=len(groups))
        return counts

    try:
        counts = await _with_engine(_do)
        if record_run:
            await _record_last_run("full", counts, started_wall, started_mono, "ok")
        await _invalidate_caches()
        return counts
    except Exception:
        if record_run:
            await _record_last_run("full", counts, started_wall, started_mono, "error")
        raise


async def sync_ticket_core(ticket_id: int) -> dict | None:
    """Fetch one ticket + its articles from Zammad and upsert both."""
    from app.db_models import TicketArticleRow, TicketRow
    from app.repositories import _upsert

    async def _do(session_factory):
        raw = await zammad.get_ticket(ticket_id)
        ticket = _map_ticket(raw)
        articles_raw = await zammad.get_ticket_articles(ticket_id)
        articles = [_map_article(a, ticket_id) for a in articles_raw]
        async with session_factory() as session:
            await _upsert(session, TicketRow, ticket.model_dump())
            for a in articles:
                await _upsert(session, TicketArticleRow, a.model_dump())
            await _sync_ticket_histories(session, [ticket_id])
            await session.commit()
        return {"ticket": ticket.model_dump(mode="json"), "articles": [a.model_dump() for a in articles]}

    return await _with_engine(_do)


# --- Managed operation lifecycle --------------------------------------------

async def _write_operation(operation: dict, expected_operation_id: str | None = None) -> bool:
    async def _do(session_factory):
        async with session_factory() as session:
            row = await session.get(SettingRow, LAST_RUN_KEY)
            if expected_operation_id and (not row or row.value.get("operation_id") != expected_operation_id):
                return False
            if row:
                row.value = operation
            else:
                session.add(SettingRow(key=LAST_RUN_KEY, value=operation))
            await session.commit()
            return True

    return await _with_engine(_do)


async def _operation_was_recorded(operation_id: str) -> bool:
    async def _do(session_factory):
        async with session_factory() as session:
            row = await session.get(SettingRow, LAST_RUN_KEY)
            return bool(row and row.value.get("operation_id") == operation_id)

    return await _with_engine(_do)


async def _record_managed_failure(operation: dict, exc: Exception) -> bool:
    failed = dict(
        operation,
        status="failed",
        finished_at=utcnow().isoformat(),
        error=f"{str(exc)[:300]} Partial writes may have occurred.",
        partial_writes=True,
    )
    return await _write_operation(failed, operation["operation_id"])


async def _complete_operation(operation: dict) -> bool:
    async def _do(session_factory):
        async with session_factory() as session:
            row = await session.get(SettingRow, LAST_RUN_KEY)
            if not row or row.value.get("operation_id") != operation["operation_id"]:
                return False
            row.value = operation
            value = {"value": operation["finished_at"]}
            checkpoint = await session.get(SettingRow, LAST_SUCCESS_KEY)
            watermark = await session.get(SettingRow, SYNC_WATERMARK_KEY)
            if checkpoint:
                checkpoint.value = value
            else:
                session.add(SettingRow(key=LAST_SUCCESS_KEY, value=value))
            if watermark:
                watermark.value = value
            else:
                session.add(SettingRow(key=SYNC_WATERMARK_KEY, value=value))
            await session.commit()
            return True

    return await _with_engine(_do)


async def _execute_managed_sync(*, kind: str, operation: dict, lease_value: str, redis: Redis, close_redis: bool = False) -> dict:
    write_lock = asyncio.Lock()

    async def update_operation(
        phase: str | None = None,
        processed: dict | None = None,
        completed: int | None = None,
        known_total: int | None = None,
    ) -> None:
        nonlocal lease_value, operation
        async with write_lock:
            now = utcnow()
            operation.update(
                renewed_at=now.isoformat(),
                lease_expires_at=datetime.fromtimestamp(now.timestamp() + LEASE_SECONDS, timezone.utc).isoformat(),
            )
            if phase:
                operation = with_progress(operation, phase, processed, completed=completed, known_total=known_total)
            renewed_value = await renew(redis, lease_value, operation)
            if not renewed_value:
                raise RuntimeError("sync operation lease ownership was lost")
            lease_value = renewed_value
            if not await _write_operation(operation, operation["operation_id"]):
                raise RuntimeError("sync operation evidence was superseded")

    async def progress(
        phase: str,
        processed: dict | None = None,
        completed: int | None = None,
        known_total: int | None = None,
    ) -> None:
        await update_operation(phase, processed, completed, known_total)

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            await update_operation()

    operation.update(status="running", started_at=utcnow().isoformat())
    started_mono = perf_counter()
    heartbeat_task = None
    sync_task = None
    try:
        await update_operation()
        heartbeat_task = asyncio.create_task(heartbeat())
        sync_task = asyncio.create_task(
            run_full_sync(progress, record_run=False, advance_watermark=False)
            if kind == "full"
            else run_incremental_sync(progress, record_run=False, advance_watermark=False)
        )
        done, _pending = await asyncio.wait({sync_task, heartbeat_task}, return_when=asyncio.FIRST_COMPLETED)
        if heartbeat_task in done:
            heartbeat_task.result()
        result = await sync_task
        heartbeat_task.cancel()
        await asyncio.gather(heartbeat_task, return_exceptions=True)
        heartbeat_task = None
        if not await owns_lease(redis, lease_value):
            return {"skipped": True, "reason": "lease ownership lost"}
        processed = dict(operation["processed"])
        processed.update(result if kind == "full" else {"tickets": result["synced"]})
        completed = dict(
            with_progress(operation, "finalizing", processed),
            status="succeeded",
            processed=processed,
            tickets=processed.get("tickets", 0),
            users=processed.get("users", 0),
            groups=processed.get("groups", 0),
            finished_at=utcnow().isoformat(),
            duration_secs=round(perf_counter() - started_mono, 1),
        )
        if not await _complete_operation(completed):
            return {"skipped": True, "reason": "operation evidence superseded"}
        return result
    except Exception as exc:
        if sync_task and not sync_task.done():
            sync_task.cancel()
            await asyncio.gather(sync_task, return_exceptions=True)
        if await owns_token(redis, lease_value):
            await _record_managed_failure(operation, exc)
        raise
    finally:
        if heartbeat_task:
            heartbeat_task.cancel()
            await asyncio.gather(heartbeat_task, return_exceptions=True)
        await release(redis, lease_value)
        if close_redis:
            await redis.aclose()


async def _run_managed_sync(
    kind: Literal["incremental", "full"],
    operation_id: str | None = None,
    source: Literal["manual", "automatic", "scheduled"] = "scheduled",
    lease_value: str | None = None,
    redis: Redis | None = None,
) -> dict:
    close_redis = redis is None
    redis = redis or Redis.from_url(settings.redis_url, decode_responses=True)
    if lease_value:
        operation = json.loads(lease_value)["operation"]
        if not await owns_lease(redis, lease_value) or not await _operation_was_recorded(operation["operation_id"]):
            if close_redis:
                await redis.aclose()
            return {"skipped": True, "reason": "obsolete operation"}
    else:
        claim = await acquire(redis, kind, source, operation_id=operation_id)
        if not claim:
            if close_redis:
                await redis.aclose()
            return {"skipped": True, "reason": "operation slot occupied"}
        operation, lease_value = claim.operation, claim.lease_value
        await _write_operation(operation)
    return await _execute_managed_sync(kind=kind, operation=operation, lease_value=lease_value, redis=redis, close_redis=close_redis)


# --- Celery tasks -----------------------------------------------------------

@celery.task(name="app.tasks.sync_incremental", bind=True, max_retries=3)
def sync_incremental(self, operation_id=None, source="scheduled", lease_value=None):
    return asyncio.run(_run_managed_sync("incremental", operation_id or self.request.id, source, lease_value))


@celery.task(name="app.tasks.sync_full_reconcile", bind=True, max_retries=3)
def sync_full_reconcile(self, operation_id=None, source="scheduled", lease_value=None):
    return asyncio.run(_run_managed_sync("full", operation_id or self.request.id, source, lease_value))


@celery.task(name="app.tasks.sync_ticket", max_retries=3)
def sync_ticket(ticket_id: int):
    return asyncio.run(sync_ticket_core(ticket_id))


@celery.task(name="app.tasks.reload_schedules")
def reload_schedules():
    """Read sync schedule intervals from the settings table and publish to Redis.

    Runs periodically so admin edits to `sync:schedules` take effect on the next
    beat tick without a container restart. The beat process (separate from worker)
    reads from Redis via RedisScheduler.
    """
    from app.repositories import get_setting as _get_setting
    from app.routers.settings import DEFAULT_SCHEDULES, SCHEDULES_KEY
    from app.celery_app import publish_schedules_to_redis

    async def _do(session_factory):
        async with session_factory() as session:
            s = await _get_setting(session, SCHEDULES_KEY)
            return s or DEFAULT_SCHEDULES

    try:
        schedules = asyncio.run(_with_engine(_do))
        inc = int(schedules.get("incremental_seconds", 300))
        full = int(schedules.get("full_reconcile_seconds", 21600))
        effective = {"incremental_seconds": inc, "full_reconcile_seconds": full}
        publish_schedules_to_redis(effective)
        return effective
    except Exception as exc:
        return {"error": str(exc)}
