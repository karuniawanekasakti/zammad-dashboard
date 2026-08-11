"""Notification channel config endpoints."""
from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import ApiResponse
from app.repositories import list_channels, upsert_channel as save_channel

router = APIRouter()

@router.get("", response_model=ApiResponse)
async def get_channels(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    return ApiResponse(data=await list_channels(db, current["sub"]))


@router.post("", response_model=ApiResponse)
async def upsert_channel(body: dict, current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    body.setdefault("id", str(uuid.uuid4()))
    return ApiResponse(data=await save_channel(db, current["sub"], body))


@router.post("/{channel_id}/test", response_model=ApiResponse)
async def test_channel(channel_id: str, current: Annotated[dict, Depends(get_current_user)]):
    return ApiResponse(data={"ok": True})
