"""Agent endpoints."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.cache import cache_get, cache_set
from app.deps import get_current_user, require_roles
from app.models import AgentStat, ApiResponse, Role, UserOut
from app.zammad_client import zammad

router = APIRouter()


def _map_agent(z: dict) -> UserOut:
    group_ids = [str(g) for g in (z.get("group_ids") or z.get("groups", {}).keys() or [])]
    roles = [r.lower() for r in z.get("roles", [])]
    role = Role.admin if "admin" in roles else Role.agent
    return UserOut(
        id=str(z["id"]),
        zammad_id=z["id"],
        email=z.get("email", ""),
        firstname=z.get("firstname", ""),
        lastname=z.get("lastname", ""),
        login=z.get("login", ""),
        role=role,
        group_ids=group_ids,
        is_active=z.get("active", True),
    )


@router.get("", response_model=ApiResponse)
async def list_agents(current: Annotated[dict, Depends(require_roles(Role.admin, Role.team_lead))]):
    cached = await cache_get("agents:all")
    if cached:
        return ApiResponse(data=cached)

    raw = await zammad.get_users(per_page=200)
    # Filter to agents only (have role Agent or Admin)
    agents = []
    for u in raw:
        roles = [r.lower() if isinstance(r, str) else r.get("name", "").lower() for r in u.get("roles", [])]
        if "agent" in roles or "admin" in roles:
            agent = _map_agent(u)
            stat = AgentStat(agent=agent)
            agents.append(stat.model_dump(mode="json"))

    await cache_set("agents:all", agents)
    return ApiResponse(data=agents)


@router.get("/{agent_id}", response_model=ApiResponse)
async def get_agent(agent_id: int, current: Annotated[dict, Depends(get_current_user)]):
    raw = await zammad.get_user(agent_id)
    agent = _map_agent(raw)
    stat = AgentStat(agent=agent)
    return ApiResponse(data=stat.model_dump(mode="json"))
