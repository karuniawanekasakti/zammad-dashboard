"""Group endpoints."""
from typing import Annotated

from fastapi import APIRouter, Depends

from app.cache import cache_get, cache_set
from app.deps import get_current_user
from app.models import ApiResponse, GroupOut
from app.zammad_client import zammad

router = APIRouter()


def _map_group(g: dict) -> GroupOut:
    return GroupOut(
        id=str(g["id"]),
        name=g.get("name", ""),
        note=g.get("note"),
        active=g.get("active", True),
        agent_count=0,
    )


@router.get("", response_model=ApiResponse)
async def list_groups(current: Annotated[dict, Depends(get_current_user)]):
    cached = await cache_get("groups:all")
    if cached:
        return ApiResponse(data=cached)

    raw = await zammad.get_groups()
    groups = [_map_group(g).model_dump(mode="json") for g in raw]
    await cache_set("groups:all", groups)

    # Scope filter
    role = current["role"]
    if role != "admin":
        user_groups = current.get("group_ids", [])
        groups = [g for g in groups if g["id"] in user_groups]

    return ApiResponse(data=groups)


@router.get("/{group_id}/stats", response_model=ApiResponse)
async def group_stats(group_id: str, current: Annotated[dict, Depends(get_current_user)]):
    cached = await cache_get("groups:all")
    if cached:
        group = next((g for g in cached if g["id"] == group_id), None)
        if group:
            return ApiResponse(data=group)
    return ApiResponse(data={"id": group_id})
