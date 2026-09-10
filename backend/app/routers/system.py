"""System health and admin endpoints."""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
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


@router.get("/config", response_model=ApiResponse)
async def public_config(current: Annotated[dict, Depends(get_current_user)]):
    return ApiResponse(data={"zammad_base_url": settings.zammad_base_url})


@router.get("/sync-status", response_model=ApiResponse)
async def sync_status(current: Annotated[dict, Depends(require_roles(Role.admin))], db: Annotated[AsyncSession, Depends(get_db)]):
    zammad_ok = await zammad.health_check()
    setting = await get_setting(db, SYNC_WATERMARK_KEY)
    last_sync_at = setting.get("value") if setting else None
    return ApiResponse(data={"zammad_online": zammad_ok, "last_sync_at": last_sync_at})


@router.post("/sync/trigger", response_model=ApiResponse)
async def trigger_sync(
    current: Annotated[dict, Depends(require_roles(Role.admin))],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis=Depends(get_redis),
):
    """Legacy Full Reconcile trigger routed through the shared operation slot."""
    from app.routers.settings import SyncTriggerIn, trigger_sync as trigger_settings_sync

    return await trigger_settings_sync(SyncTriggerIn(kind="full", source="manual"), current, db, redis)
