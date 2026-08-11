"""Group endpoints. Reads from PostgreSQL (synced by Celery workers)."""
from collections import defaultdict
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import cache_get, cache_set
from app.db_models import GroupRow
from app.deps import get_current_user, get_db
from app.models import ApiResponse, GroupOut, GroupStat, TicketOut, TrendPoint, UserOut
from app.repositories import list_groups as list_group_rows, list_tickets, list_users
from app.routers.tickets import OPEN_STATES

router = APIRouter()


def _avg(values: list[int | None]) -> int:
    nums = [v for v in values if v]
    return int(sum(nums) / len(nums)) if nums else 0


def _is_today(value: datetime | None) -> bool:
    return bool(value and value.date() == date.today())


def _map_group(g: dict, agent_count: int = 0) -> GroupOut:
    return GroupOut(
        id=str(g["id"]),
        name=g.get("name", ""),
        note=g.get("note"),
        active=g.get("active", True),
        agent_count=agent_count,
    )


def _trend(tickets: list[TicketOut], days: int = 14) -> list[dict]:
    counts: dict[str, int] = defaultdict(int)
    for ticket in tickets:
        counts[ticket.zammad_created_at.date().isoformat()] += 1
    today = date.today()
    points = []
    for i in range(days):
        day = date.fromordinal(today.toordinal() - days + i + 1)
        points.append(TrendPoint(date=day.isoformat(), value=counts.get(day.isoformat(), 0)).model_dump())
    return points


def _group_stat(group: GroupOut, tickets: list[TicketOut]) -> GroupStat:
    rows = [t for t in tickets if t.group_id == group.id]
    breached = [t for t in rows if t.first_response_breached or t.close_breached or t.sla_status == "breached"]
    return GroupStat(
        group=group,
        open_tickets=len([t for t in rows if t.state in OPEN_STATES]),
        new_today=len([t for t in rows if _is_today(t.zammad_created_at)]),
        closed_today=len([t for t in rows if t.state == "closed" and _is_today(t.closed_at)]),
        sla_breach_rate=len(breached) / max(len(rows), 1),
        avg_first_reply_secs=_avg([t.first_reply_time_secs for t in rows]),
        avg_resolution_secs=_avg([t.resolution_time_secs for t in rows]),
        trend=_trend(rows),
    )


def _visible_group(group_id: str, current: dict) -> bool:
    return current["role"] == "admin" or group_id in current.get("group_ids", [])


async def _fetch_scoped_tickets(current: dict, db: AsyncSession) -> list[TicketOut]:
    from app.routers.tickets import _row_to_ticket, _scope_filter

    tickets = [_row_to_ticket(row) for row in await list_tickets(db)]
    return _scope_filter(tickets, current)


async def _group_stats(current: dict, db: AsyncSession) -> list[GroupStat]:
    cache_key = f"groups:stats:{current['sub']}:{current['role']}:{','.join(current.get('group_ids', []))}"
    cached = await cache_get(cache_key)
    if cached:
        return [GroupStat(**g) for g in cached]

    rows = [g for g in await list_group_rows(db) if _visible_group(g.id, current)]
    users = [UserOut.model_validate(u, from_attributes=True) for u in await list_users(db)]
    agent_counts = defaultdict(int)
    for u in users:
        for gid in u.group_ids:
            agent_counts[gid] += 1
    groups = [_map_group({"id": g.id, "name": g.name, "note": g.note, "active": g.active}, agent_counts.get(g.id, g.agent_count)) for g in rows]
    tickets = await _fetch_scoped_tickets(current, db)
    stats = [_group_stat(group, tickets) for group in groups]
    await cache_set(cache_key, [s.model_dump(mode="json") for s in stats], ttl=60)
    return stats


@router.get("", response_model=ApiResponse)
async def list_groups(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)], summary: bool = Query(False)):
    stats = await _group_stats(current, db)
    if summary:
        return ApiResponse(data=[s.group.model_dump(mode="json") for s in stats])
    return ApiResponse(data=[s.model_dump(mode="json") for s in stats])


@router.get("/{group_id}/stats", response_model=ApiResponse)
async def group_stats(group_id: str, current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    stat = next((s for s in await _group_stats(current, db) if s.group.id == group_id), None)
    return ApiResponse(data=stat.model_dump(mode="json") if stat else None)
