"""Admin settings: Celery/worker config, manual sync triggers, health monitoring."""
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.deps import get_db, get_redis, require_roles
from app.models import ApiResponse, Role
from app.repositories import get_setting, set_setting
from app.sync_operation import acquire, current as current_operation, new_operation, project
from app.zammad_client import zammad

router = APIRouter()

SCHEDULES_KEY = "sync:schedules"
LAST_RUN_KEY = "sync:last_run"
LAST_SUCCESS_KEY = "sync:last_successful_checkpoint"
SYNC_WATERMARK_KEY = "sync:last_ticket_updated_at"
FRESHNESS_GRACE_SECONDS = 120

MIN_SECONDS = 30
MAX_SECONDS = 86400 * 7

DEFAULT_SCHEDULES = {"incremental_seconds": 300, "full_reconcile_seconds": 21600}


class SchedulesIn(BaseModel):
    incremental_seconds: int = Field(ge=MIN_SECONDS, le=MAX_SECONDS)
    full_reconcile_seconds: int = Field(ge=MIN_SECONDS, le=MAX_SECONDS)


class SyncTriggerIn(BaseModel):
    kind: Literal["incremental", "full"] = "incremental"
    source: Literal["manual", "automatic"] = "manual"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)


def _normalize_last_run(last_run: dict | None) -> dict | None:
    if not last_run:
        return None
    normalized = dict(last_run)
    normalized["status"] = {
        "ok": "succeeded",
        "error": "failed",
    }.get(normalized.get("status"), normalized.get("status"))
    return normalized


def _freshness(checkpoint: datetime | None, schedules: dict, now: datetime, checkpoint_source: str | None) -> dict:
    if checkpoint is None:
        return {"status": "never_synced", "last_success_at": None, "checkpoint_source": None}
    stale_after = checkpoint + timedelta(seconds=int(schedules.get("incremental_seconds", DEFAULT_SCHEDULES["incremental_seconds"])) + FRESHNESS_GRACE_SECONDS)
    return {
        "status": "up_to_date" if now <= stale_after else "out_of_date",
        "last_success_at": checkpoint.isoformat(),
        "stale_after": stale_after.isoformat(),
        "checkpoint_source": checkpoint_source,
    }


async def _sync_status(db: AsyncSession, now: datetime, redis=None) -> dict:
    schedules = (await get_setting(db, SCHEDULES_KEY)) or DEFAULT_SCHEDULES
    checkpoint_setting = await get_setting(db, LAST_SUCCESS_KEY)
    checkpoint_source = "dedicated"
    if not checkpoint_setting:
        checkpoint_setting = await get_setting(db, SYNC_WATERMARK_KEY)
        checkpoint_source = "watermark" if checkpoint_setting else None
    checkpoint = _parse_datetime(checkpoint_setting.get("value") if checkpoint_setting else None)
    latest_attempt = _normalize_last_run(await get_setting(db, LAST_RUN_KEY))
    active = await current_operation(redis, latest_attempt, now=now) if redis else None
    projected_attempt = project(active or latest_attempt, now)
    execution = active if active and projected_attempt.get("status") in {"queued", "running"} else None
    return {
        "freshness": _freshness(checkpoint, schedules, now, checkpoint_source),
        "execution": execution,
        "latest_attempt": projected_attempt,
        "now": now.isoformat(),
    }


def _sync_tasks(kind: str):
    from app.tasks import sync_full_reconcile, sync_incremental

    return sync_full_reconcile if kind == "full" else sync_incremental


def _get_worker_status() -> dict:
    """Ping the Celery 'sync' queue for reachable workers."""
    try:
        from app.celery_app import celery

        responses = celery.control.ping(timeout=3)
        workers = [r for resp in responses for r in resp]
        return {"reachable": True, "workers": workers}
    except Exception as exc:
        return {"reachable": False, "workers": [], "error": str(exc)}


async def _get_health(db: AsyncSession) -> dict:
    redis_ok = False
    try:
        redis_ok = bool(await (await get_redis()).ping())
    except Exception:
        pass
    db_ok = False
    try:
        db_ok = bool((await db.execute(text("select 1"))).scalar_one())
    except Exception:
        pass
    zammad_ok = await zammad.health_check()
    return {
        "redis": "ok" if redis_ok else "down",
        "database": "ok" if db_ok else "down",
        "zammad": "ok" if zammad_ok else "down",
    }


@router.get("", response_model=ApiResponse)
async def get_settings(
    current: Annotated[dict, Depends(require_roles(Role.admin))],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
):
    schedules = (await get_setting(db, SCHEDULES_KEY)) or DEFAULT_SCHEDULES
    sync_status = await _sync_status(db, _utcnow(), redis)
    return ApiResponse(
        data={
            "schedules": schedules,
            "last_run": sync_status["latest_attempt"],
            **sync_status,
            "worker": _get_worker_status(),
            "health": await _get_health(db),
            "zammad_base_url": app_settings.zammad_base_url,
            "data_retention_days": 30,
        }
    )


@router.put("/schedules", response_model=ApiResponse)
async def update_schedules(payload: SchedulesIn, current: Annotated[dict, Depends(require_roles(Role.admin))], db: Annotated[AsyncSession, Depends(get_db)]):
    data = payload.model_dump()
    await set_setting(db, SCHEDULES_KEY, data)
    from app.celery_app import publish_schedules_to_redis

    publish_schedules_to_redis(data)
    return ApiResponse(data={"schedules": data, "applied_on_next_beat": True})


@router.post("/sync", response_model=ApiResponse)
async def trigger_sync(
    payload: SyncTriggerIn,
    current: Annotated[dict, Depends(require_roles(Role.admin))],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
):
    now = _utcnow()
    try:
        claim = await acquire(redis, payload.kind, payload.source, now=now)
    except Exception:
        operation, _lease_value = new_operation(payload.kind, payload.source, now=now)
        failed = dict(
            operation,
            status="failed",
            finished_at=now.isoformat(),
            error="The sync operation slot is unavailable.",
        )
        try:
            await set_setting(db, LAST_RUN_KEY, failed)
        except Exception:
            pass
        return ApiResponse(data={"triggered": False, "attached": False, "kind": payload.kind, "operation": failed, "error": failed["error"]})
    if not claim:
        active = await current_operation(redis, now=now)
        if active:
            return ApiResponse(data={"triggered": False, "attached": True, "kind": payload.kind, "operation": active})
        return ApiResponse(data={"triggered": False, "attached": False, "kind": payload.kind, "operation": None, "error": "sync operation unavailable"})

    try:
        await set_setting(db, LAST_RUN_KEY, claim.operation)
        _sync_tasks(payload.kind).delay(claim.operation["operation_id"], payload.source, claim.lease_value)
        return ApiResponse(data={"triggered": True, "attached": False, "kind": payload.kind, "operation": claim.operation})
    except Exception:
        from app.sync_operation import release

        failed = dict(
            claim.operation,
            status="failed",
            finished_at=_utcnow().isoformat(),
            error="The sync worker could not be queued.",
        )
        try:
            await set_setting(db, LAST_RUN_KEY, failed)
        except Exception:
            pass
        await release(redis, claim.lease_value)
        return ApiResponse(data={"triggered": False, "attached": False, "kind": payload.kind, "operation": failed, "error": failed["error"]})


@router.post("/cache/purge", response_model=ApiResponse)
async def purge_cache(current: Annotated[dict, Depends(require_roles(Role.admin))]):
    r = await get_redis()
    count = 0
    try:
        for prefix in ("tickets:*", "agents:*", "groups:*", "kpi:*"):
            async for key in r.scan_iter(match=prefix):
                await r.delete(key)
                count += 1
    except Exception as exc:
        return ApiResponse(data={"purged": 0, "error": str(exc)})
    return ApiResponse(data={"purged": count})


@router.get("/status", response_model=ApiResponse)
async def status(
    current: Annotated[dict, Depends(require_roles(Role.admin))],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
):
    sync_status = await _sync_status(db, _utcnow(), redis)
    return ApiResponse(
        data={
            "worker": _get_worker_status(),
            "health": await _get_health(db),
            "last_run": sync_status["latest_attempt"],
            **sync_status,
        }
    )
