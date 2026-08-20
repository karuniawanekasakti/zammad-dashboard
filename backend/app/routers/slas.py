"""Zammad SLA policies."""
from typing import Annotated

from fastapi import APIRouter, Depends

from app.deps import get_current_user
from app.models import ApiResponse
from app.zammad_client import zammad

router = APIRouter()


@router.get("", response_model=ApiResponse)
async def list_slas(current: Annotated[dict, Depends(get_current_user)]):
    return ApiResponse(data=await zammad.get_sla_policies())
