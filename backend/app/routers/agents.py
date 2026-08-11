"""Agent endpoints. Reads from PostgreSQL (synced by Celery workers)."""
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import cache_get, cache_set
from app.db_models import UserRow
from app.deps import get_current_user, get_db
from app.models import AgentStat, ApiResponse, TicketOut, UserOut
from app.repositories import list_tickets, list_users
from app.routers.auth import _map_role
from app.routers.tickets import OPEN_STATES

router = APIRouter()


def _group_ids(z: dict) -> list[str]:
    raw = z.get("group_ids") or z.get("groups", {})
    return [str(g) for g in (raw.keys() if isinstance(raw, dict) else raw or [])]


def _map_agent(z: dict) -> UserOut:
    return UserOut(
        id=str(z["id"]),
        zammad_id=z["id"],
        email=z.get("email") or "",
        firstname=z.get("firstname") or "",
        lastname=z.get("lastname") or "",
        login=z.get("login") or "",
        role=_map_role(z),
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


def _visible_agent(agent: UserOut, current: dict) -> bool:
    if current["role"] == "admin":
        return True
    groups = set(current.get("group_ids", []))
    return bool(groups.intersection(agent.group_ids))


@router.get("", response_model=ApiResponse)
async def list_agents(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)], summary: bool = Query(False)):
    if not summary and current["role"] not in {"admin", "team_lead"}:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    cache_key = f"agents:stats:{current['sub']}:{','.join(current.get('group_ids', []))}"
    cached = await cache_get(cache_key)
    if cached:
        stats = cached
    else:
        agents = [UserOut.model_validate(u, from_attributes=True) for u in await list_users(db)]
        agents = [a for a in agents if a.is_active and _visible_agent(a, current)]
        tickets = await _fetch_scoped(current, db)
        stats = [_agent_stat(agent, tickets).model_dump(mode="json") for agent in agents]
        await cache_set(cache_key, stats, ttl=300)
    return ApiResponse(data=[s["agent"] for s in stats] if summary else stats)


@router.get("/{agent_id}", response_model=ApiResponse)
async def get_agent(agent_id: int, current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    row = await db.get(UserRow, str(agent_id))
    if row is None:
        return ApiResponse(data=None)
    agent = UserOut.model_validate(row, from_attributes=True)
    tickets = await _fetch_scoped(current, db)
    return ApiResponse(data=_agent_stat(agent, tickets).model_dump(mode="json"))


async def _fetch_scoped(current: dict, db: AsyncSession) -> list[TicketOut]:
    """Read tickets visible to the current user from PostgreSQL."""
    from app.routers.tickets import _row_to_ticket, _scope_filter

    tickets = [_row_to_ticket(row) for row in await list_tickets(db)]
    return _scope_filter(tickets, current)
