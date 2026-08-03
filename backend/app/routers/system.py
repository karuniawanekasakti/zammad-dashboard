"""System health and admin endpoints."""
from typing import Annotated

from fastapi import APIRouter, Depends

from app.deps import get_current_user, get_redis, require_roles
from app.models import ApiResponse, Role
from app.zammad_client import zammad

router = APIRouter()


@router.get("/health")
async def health():
    redis = await get_redis()
    redis_ok = await redis.ping()
    zammad_ok = await zammad.health_check()
    return {
        "status": "healthy" if redis_ok and zammad_ok else "degraded",
        "redis": "ok" if redis_ok else "down",
        "zammad": "ok" if zammad_ok else "down",
    }


@router.get("/sync-status", response_model=ApiResponse)
async def sync_status(current: Annotated[dict, Depends(require_roles(Role.admin))]):
    zammad_ok = await zammad.health_check()
    return ApiResponse(data={"zammad_online": zammad_ok, "last_sync_at": None})


@router.post("/sync/trigger", response_model=ApiResponse)
async def trigger_sync(current: Annotated[dict, Depends(require_roles(Role.admin))]):
    # In production this would queue a Celery task
    from app.cache import cache_delete
    await cache_delete("tickets:*")
    await cache_delete("agents:*")
    await cache_delete("groups:*")
    await cache_delete("kpi:*")
    return ApiResponse(data={"triggered": True})
