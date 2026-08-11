"""KPI endpoints."""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Callable

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import cache_get, cache_set
from app.deps import get_current_user, get_db
from app.models import ApiResponse, KpiSummary, TicketOut, TrendPoint, UserOut
from app.repositories import list_users
from app.routers.tickets import OPEN_STATES, _fetch_scoped

router = APIRouter()


def _avg(values: list[int | None]) -> int:
    nums = [v for v in values if v]
    return int(sum(nums) / len(nums)) if nums else 0


def _is_today(value: datetime | None) -> bool:
    return bool(value and value.date() == datetime.now(timezone.utc).date())


def _day_counts(tickets: list[TicketOut], days: int, pick: Callable[[TicketOut], datetime | None], value: Callable[[list[TicketOut]], float] | None = None) -> list[dict]:
    today = date.today()
    buckets: dict[str, list[TicketOut]] = defaultdict(list)
    for ticket in tickets:
        dt = pick(ticket)
        if dt:
            buckets[dt.date().isoformat()].append(ticket)
    points = []
    for i in range(days):
        day = today - timedelta(days=days - i - 1)
        rows = buckets.get(day.isoformat(), [])
        points.append(TrendPoint(date=day.isoformat(), value=value(rows) if value else len(rows)).model_dump())
    return points


@router.get("/summary", response_model=ApiResponse)
async def kpi_summary(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    cache_key = f"kpi:summary:{current['sub']}:{current.get('role')}:{','.join(current.get('group_ids', []))}"
    cached = await cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    tickets = await _fetch_scoped(current, db)
    users = [UserOut.model_validate(u, from_attributes=True) for u in await list_users(db)]
    open_tickets = [t for t in tickets if t.state in OPEN_STATES]
    breached = [t for t in tickets if t.first_response_breached or t.close_breached or t.sla_status == "breached"]
    closed = [t for t in tickets if t.state == "closed"]

    kpi = KpiSummary(
        total_open_tickets=len(open_tickets),
        total_closed_today=len([t for t in closed if _is_today(t.closed_at)]),
        agents_online=len([u for u in users if u.is_active]),
        total_agents=len(users),
        sla_breach_rate=len(breached) / max(len(tickets), 1),
        avg_resolution_secs=_avg([t.resolution_time_secs for t in closed]),
        avg_first_reply_secs=_avg([t.first_reply_time_secs for t in tickets]),
        reopen_rate=len([t for t in tickets if t.reopen_count > 0]) / max(len(tickets), 1),
        new_today=len([t for t in tickets if _is_today(t.zammad_created_at)]),
        at_risk=len([t for t in tickets if t.sla_status in ("warning", "critical")]),
    )

    result = kpi.model_dump()
    await cache_set(cache_key, result, ttl=60)
    return ApiResponse(data=result)


@router.get("/volume", response_model=ApiResponse)
async def ticket_volume(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)], days: int = Query(30, ge=1, le=90)):
    tickets = await _fetch_scoped(current, db)
    return ApiResponse(data=_day_counts(tickets, days, lambda t: t.zammad_created_at))


@router.get("/sla-breach-rate", response_model=ApiResponse)
async def sla_breach_rate(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)], days: int = Query(30, ge=1, le=90)):
    tickets = [t for t in await _fetch_scoped(current, db) if t.first_response_breached or t.close_breached or t.sla_status == "breached"]
    return ApiResponse(data=_day_counts(tickets, days, lambda t: t.zammad_updated_at))


@router.get("/resolution-time", response_model=ApiResponse)
async def resolution_time(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)], days: int = Query(14, ge=1, le=90)):
    tickets = await _fetch_scoped(current, db)
    return ApiResponse(data=_day_counts(tickets, days, lambda t: t.closed_at or t.zammad_updated_at, lambda rows: _avg([t.resolution_time_secs for t in rows])))


@router.get("/first-reply", response_model=ApiResponse)
async def first_reply(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)], days: int = Query(14, ge=1, le=90)):
    tickets = await _fetch_scoped(current, db)
    return ApiResponse(data=_day_counts(tickets, days, lambda t: t.zammad_created_at, lambda rows: _avg([t.first_reply_time_secs for t in rows])))
