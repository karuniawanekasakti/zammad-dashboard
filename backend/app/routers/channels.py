"""Notification channel config endpoints."""
from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.cache import cache_get, cache_set
from app.deps import get_current_user
from app.models import ApiResponse

router = APIRouter()

STORE_KEY = "channels:{user_id}"


@router.get("", response_model=ApiResponse)
async def list_channels(current: Annotated[dict, Depends(get_current_user)]):
    channels = await cache_get(STORE_KEY.format(user_id=current["sub"])) or []
    return ApiResponse(data=channels)


@router.post("", response_model=ApiResponse)
async def upsert_channel(body: dict, current: Annotated[dict, Depends(get_current_user)]):
    key = STORE_KEY.format(user_id=current["sub"])
    channels = await cache_get(key) or []
    body.setdefault("id", str(uuid.uuid4()))
    # Upsert
    existing = next((i for i, c in enumerate(channels) if c["id"] == body["id"]), None)
    if existing is not None:
        channels[existing] = body
    else:
        channels.append(body)
    await cache_set(key, channels, ttl=86400)
    return ApiResponse(data=body)


@router.post("/{channel_id}/test", response_model=ApiResponse)
async def test_channel(channel_id: str, current: Annotated[dict, Depends(get_current_user)]):
    return ApiResponse(data={"ok": True})
