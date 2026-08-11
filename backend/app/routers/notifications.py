"""Notification endpoints."""
from __future__ import annotations
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import ApiResponse
from app.repositories import list_notifications, mark_all_notifications_read, mark_notification_read

router = APIRouter()


@router.get("", response_model=ApiResponse)
async def get_notifications(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    return ApiResponse(data=await list_notifications(db, current["sub"]))


@router.patch("/{notif_id}/read", response_model=ApiResponse)
async def mark_read(notif_id: str, current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    await mark_notification_read(db, current["sub"], notif_id)
    return ApiResponse(data=None)


@router.patch("/read-all", response_model=ApiResponse)
async def mark_all_read(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    await mark_all_notifications_read(db, current["sub"])
    return ApiResponse(data=None)
