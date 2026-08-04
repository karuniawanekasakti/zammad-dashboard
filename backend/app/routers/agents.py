"""Agent endpoints."""
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.cache import cache_get, cache_set
from app.deps import get_current_user, require_roles
from app.models import AgentStat, ApiResponse, Role, TicketOut, UserOut
from app.routers.tickets import OPEN_STATES, _fetch_scoped
from app.zammad_client import zammad

router = APIRouter()


def _group_ids(z: dict) -> list[str]:
    raw = z.get("group_ids") or z.get("groups", {})
    return [str(g) for g in (raw.keys() if isinstance(raw, dict) else raw or [])]


def _map_agent(z: dict) -> UserOut:
    roles = [r.lower() if isinstance(r, str) else str(r.get("name", "")).lower() for r in z.get("roles") or []]
    role = Role.admin if "admin" in roles else Role.agent
    return UserOut(
        id=str(z["id"]),
        zammad_id=z["id"],
        email=z.get("email", ""),
        firstname=z.get("firstname", ""),
        lastname=z.get("lastname", ""),
        login=z.get("login", ""),
        role=role,
        group_ids=_group_ids(z),
        is_active=z.get("active", True),
    )


def _avg(values: list[int | None]) -> int:
    nums = [v for v in values if v]
    return int(sum(nums) / len(nums)) if nums else 0


def _agent_stat(agent: UserOut, tickets: list[TicketOut]) -> AgentStat:
    rows = [t for t in tickets if t.owner_id == agent.id]
    open_rows = [t for t in rows if t.state in OPEN_STATES]
    breached = [t for t in rows if t.first_response_breached or t.close_breached or t.sla_status == "breached"]
    closed_cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    closed_this_week = [t for t in rows if t.closed_at and t.closed_at >= closed_cutoff]
    return AgentStat(
        agent=agent,
        open_tickets=len(open_rows),
        at_risk=len([t for t in rows if t.sla_status in ("warning", "critical")]),
        breached=len(breached),
        avg_first_reply_secs=_avg([t.first_reply_time_secs for t in rows]),
        avg_resolution_secs=_avg([t.resolution_time_secs for t in rows]),
        sla_breach_rate=len(breached) / max(len(rows), 1),
        reopen_rate=len([t for t in rows if t.reopen_count > 0]) / max(len(rows), 1),
        closed_this_week=len(closed_this_week),
    )


def _visible_agent(raw: dict, current: dict) -> bool:
    if current["role"] == "admin":
        return True
    groups = set(current.get("group_ids", []))
    return bool(groups.intersection(_group_ids(raw)))


@router.get("", response_model=ApiResponse)
async def list_agents(current: Annotated[dict, Depends(require_roles(Role.admin, Role.team_lead))], summary: bool = Query(False)):
    cache_key = f"agents:stats:{current['sub']}:{','.join(current.get('group_ids', []))}"
    cached = await cache_get(cache_key)
    if cached:
        stats = cached
    else:
        raw_users = [u for u in await zammad.get_users(per_page=200) if u.get("active", True) and _visible_agent(u, current)]
        tickets = await _fetch_scoped(current)
        stats = [_agent_stat(_map_agent(u), tickets).model_dump(mode="json") for u in raw_users]
        await cache_set(cache_key, stats, ttl=300)
    return ApiResponse(data=[s["agent"] for s in stats] if summary else stats)


@router.get("/{agent_id}", response_model=ApiResponse)
async def get_agent(agent_id: int, current: Annotated[dict, Depends(get_current_user)]):
    raw = await zammad.get_user(agent_id)
    agent = _map_agent(raw)
    tickets = await _fetch_scoped(current)
    return ApiResponse(data=_agent_stat(agent, tickets).model_dump(mode="json"))
