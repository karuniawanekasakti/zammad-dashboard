"""Alert rules CRUD."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.cache import cache_get, cache_set
from app.deps import get_current_user
from app.models import AlertRuleIn, AlertRuleOut, ApiResponse

router = APIRouter()

STORE_KEY = "alert_rules"


async def _load_rules() -> list[dict]:
    return await cache_get(STORE_KEY) or []


async def _save_rules(rules: list[dict]):
    await cache_set(STORE_KEY, rules, ttl=86400)


@router.get("", response_model=ApiResponse)
async def list_rules(current: Annotated[dict, Depends(get_current_user)]):
    rules = await _load_rules()
    # Scope: admin sees all, others see own scope
    if current["role"] != "admin":
        rules = [r for r in rules if r.get("scope_id") in (current["sub"], None) or r.get("scope_type") == "global"]
    return ApiResponse(data=rules)


@router.post("", response_model=ApiResponse)
async def create_rule(body: AlertRuleIn, current: Annotated[dict, Depends(get_current_user)]):
    rules = await _load_rules()
    rule = AlertRuleOut(
        **body.model_dump(),
        id=str(uuid.uuid4()),
        scope_label=body.scope_type,
        created_at=datetime.now(timezone.utc),
    )
    rules.append(rule.model_dump(mode="json"))
    await _save_rules(rules)
    return ApiResponse(data=rule.model_dump(mode="json"))


@router.put("/{rule_id}", response_model=ApiResponse)
async def update_rule(rule_id: str, body: AlertRuleIn, current: Annotated[dict, Depends(get_current_user)]):
    rules = await _load_rules()
    for i, r in enumerate(rules):
        if r["id"] == rule_id:
            rules[i] = {**r, **body.model_dump(), "id": rule_id}
            await _save_rules(rules)
            return ApiResponse(data=rules[i])
    raise HTTPException(status_code=404, detail="Rule not found")


@router.delete("/{rule_id}", response_model=ApiResponse)
async def delete_rule(rule_id: str, current: Annotated[dict, Depends(get_current_user)]):
    rules = await _load_rules()
    rules = [r for r in rules if r["id"] != rule_id]
    await _save_rules(rules)
    return ApiResponse(data=None)
