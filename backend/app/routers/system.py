"""System health and admin endpoints."""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, get_redis, require_roles
from app.models import ApiResponse, Role
from app.repositories import get_setting
from app.zammad_client import zammad

router = APIRouter()

SYNC_WATERMARK_KEY = "sync:last_ticket_updated_at"


@router.get("/health")
async def health(db: Annotated[AsyncSession, Depends(get_db)]):
    try:
        redis_ok = bool(await (await get_redis()).ping())
    except Exception:
        redis_ok = False
    try:
        db_ok = bool((await db.execute(text("select 1"))).scalar_one())
    except Exception:
        db_ok = False
    zammad_ok = await zammad.health_check()
    return {
        "status": "healthy" if redis_ok and db_ok and zammad_ok else "degraded",
        "redis": "ok" if redis_ok else "down",
        "database": "ok" if db_ok else "down",
        "zammad": "ok" if zammad_ok else "down",
    }


@router.get("/sync-status", response_model=ApiResponse)
async def sync_status(current: Annotated[dict, Depends(require_roles(Role.admin))], db: Annotated[AsyncSession, Depends(get_db)]):
    zammad_ok = await zammad.health_check()
    setting = await get_setting(db, SYNC_WATERMARK_KEY)
    last_sync_at = setting.get("value") if setting else None
    return ApiResponse(data={"zammad_online": zammad_ok, "last_sync_at": last_sync_at})


@router.post("/sync/trigger", response_model=ApiResponse)
async def trigger_sync(current: Annotated[dict, Depends(require_roles(Role.admin))]):
    try:
        from app.tasks import sync_full_reconcile

        sync_full_reconcile.delay()
        return ApiResponse(data={"triggered": True, "task": "sync_full_reconcile"})
    except Exception:
        # Broker unreachable — fall back to cache invalidation so reads still refresh.
        from app.cache import cache_delete

        await cache_delete("tickets:*")
        await cache_delete("agents:*")
        await cache_delete("groups:*")
        await cache_delete("kpi:*")
        return ApiResponse(data={"triggered": False, "error": "celery unavailable, cache cleared"})
