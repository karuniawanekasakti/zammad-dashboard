"""Alert rules CRUD."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import AlertRuleIn, AlertRuleOut, ApiResponse
from app.repositories import delete_alert_rule, list_alert_rules, save_alert_rule, update_alert_rule

router = APIRouter()

@router.get("", response_model=ApiResponse)
async def list_rules(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    rules = await list_alert_rules(db)
    # Scope: admin sees all, others see own scope
    if current["role"] != "admin":
        rules = [r for r in rules if r.get("scope_id") in (current["sub"], None) or r.get("scope_type") == "global"]
    return ApiResponse(data=rules)


@router.post("", response_model=ApiResponse)
async def create_rule(body: AlertRuleIn, current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    rule = AlertRuleOut(
        **body.model_dump(),
        id=str(uuid.uuid4()),
        scope_label=body.scope_type,
        created_at=datetime.now(timezone.utc),
    )
    return ApiResponse(data=await save_alert_rule(db, rule))


@router.put("/{rule_id}", response_model=ApiResponse)
async def update_rule(rule_id: str, body: AlertRuleIn, current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    rule = await update_alert_rule(db, rule_id, body.model_dump())
    if rule:
        return ApiResponse(data=rule)
    raise HTTPException(status_code=404, detail="Rule not found")


@router.delete("/{rule_id}", response_model=ApiResponse)
async def delete_rule(rule_id: str, current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    await delete_alert_rule(db, rule_id)
    return ApiResponse(data=None)
