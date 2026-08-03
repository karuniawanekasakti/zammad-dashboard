"""KPI endpoints."""
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.cache import cache_get, cache_set
from app.deps import get_current_user
from app.models import ApiResponse, KpiSummary, TrendPoint
from app.zammad_client import zammad
from app.routers.tickets import _map_ticket, _scope_filter

router = APIRouter()


@router.get("/summary", response_model=ApiResponse)
async def kpi_summary(current: Annotated[dict, Depends(get_current_user)]):
    cache_key = f"kpi:summary:{current['sub']}"
    cached = await cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    raw = await zammad.get_tickets(page=1, per_page=200)
    tickets = [_map_ticket(t) for t in raw]
    tickets = _scope_filter(tickets, current)

    open_tickets = [t for t in tickets if t.state in ("new", "open", "pending")]
    breached = [t for t in tickets if t.first_response_breached or t.close_breached]
    sla_applicable = [t for t in tickets if t.first_response_remaining_secs is not None]

    kpi = KpiSummary(
        total_open_tickets=len(open_tickets),
        sla_breach_rate=len(breached) / max(len(sla_applicable), 1),
        at_risk=len([t for t in tickets if t.sla_status in ("warning", "critical")]),
        new_today=len([t for t in tickets if t.state == "new"]),
    )

    result = kpi.model_dump()
    await cache_set(cache_key, result, ttl=60)
    return ApiResponse(data=result)


@router.get("/volume", response_model=ApiResponse)
async def ticket_volume(current: Annotated[dict, Depends(get_current_user)], days: int = Query(30, ge=1, le=90)):
    # Placeholder trend data — in production this would query snapshots
    from datetime import date, timedelta
    today = date.today()
    points = [TrendPoint(date=(today - timedelta(days=days - i)).isoformat(), value=0).model_dump() for i in range(days)]
    return ApiResponse(data=points)


@router.get("/sla-breach-rate", response_model=ApiResponse)
async def sla_breach_rate(current: Annotated[dict, Depends(get_current_user)], days: int = Query(30, ge=1, le=90)):
    from datetime import date, timedelta
    today = date.today()
    points = [TrendPoint(date=(today - timedelta(days=days - i)).isoformat(), value=0).model_dump() for i in range(days)]
    return ApiResponse(data=points)
