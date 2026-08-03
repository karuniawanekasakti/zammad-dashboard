"""Notification endpoints."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends

from app.cache import cache_get, cache_set
from app.deps import get_current_user
from app.models import ApiResponse

router = APIRouter()


def _store_key(user_id: str) -> str:
    return f"notifications:{user_id}"


@router.get("", response_model=ApiResponse)
async def list_notifications(current: Annotated[dict, Depends(get_current_user)]):
    notifs = await cache_get(_store_key(current["sub"])) or []
    return ApiResponse(data=notifs)


@router.patch("/{notif_id}/read", response_model=ApiResponse)
async def mark_read(notif_id: str, current: Annotated[dict, Depends(get_current_user)]):
    key = _store_key(current["sub"])
    notifs = await cache_get(key) or []
    for n in notifs:
        if n["id"] == notif_id:
            n["status"] = "read"
            n["read_at"] = datetime.now(timezone.utc).isoformat()
    await cache_set(key, notifs, ttl=86400)
    return ApiResponse(data=None)


@router.patch("/read-all", response_model=ApiResponse)
async def mark_all_read(current: Annotated[dict, Depends(get_current_user)]):
    key = _store_key(current["sub"])
    notifs = await cache_get(key) or []
    now = datetime.now(timezone.utc).isoformat()
    for n in notifs:
        n["status"] = "read"
        n["read_at"] = n.get("read_at") or now
    await cache_set(key, notifs, ttl=86400)
    return ApiResponse(data=None)
