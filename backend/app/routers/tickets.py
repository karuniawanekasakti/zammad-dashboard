"""Ticket endpoints."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.cache import cache_get, cache_set
from app.deps import get_current_user
from app.models import ApiResponse, TicketArticleOut, TicketOut
from app.zammad_client import zammad

router = APIRouter()


def _map_ticket(t: dict) -> TicketOut:
    """Map Zammad ticket JSON to our schema."""
    from datetime import datetime, timezone

    # Compute SLA status
    remaining = None
    sla_status = "safe"
    escalation_at = t.get("first_response_escalation_at")
    if escalation_at:
        deadline = datetime.fromisoformat(escalation_at.replace("Z", "+00:00"))
        remaining = int((deadline - datetime.now(timezone.utc)).total_seconds())
        if remaining < 0:
            sla_status = "breached"
        elif remaining < 1800:
            sla_status = "critical"
        elif remaining < 7200:
            sla_status = "warning"

    state_name = t.get("state", "open")
    if isinstance(state_name, dict):
        state_name = state_name.get("name", "open")

    priority_name = t.get("priority", "normal")
    if isinstance(priority_name, dict):
        priority_name = priority_name.get("name", "normal")

    return TicketOut(
        id=str(t["id"]),
        zammad_id=t["id"],
        number=str(t.get("number", "")),
        title=t.get("title", ""),
        state=state_name.lower().replace(" ", "_"),
        priority=priority_name.lower(),
        group_id=str(t.get("group_id", "")),
        group_name=t.get("group", "") if isinstance(t.get("group"), str) else str(t.get("group_id", "")),
        owner_id=str(t["owner_id"]) if t.get("owner_id") else None,
        owner_name=t.get("owner", None) if isinstance(t.get("owner"), str) else None,
        customer_name=t.get("customer", "") if isinstance(t.get("customer"), str) else "",
        tags=t.get("tags", []) if isinstance(t.get("tags"), list) else [],
        sla_status=sla_status,
        first_response_remaining_secs=remaining,
        first_response_breached=t.get("first_response_in_min") is not None and remaining is not None and remaining < 0,
        close_breached=t.get("close_in_min") is not None and (t.get("close_escalation_at") or "") < datetime.now(timezone.utc).isoformat() if t.get("close_escalation_at") else False,
        reopen_count=t.get("reopen_count", 0),
        first_reply_time_secs=t.get("first_reply_time_secs"),
        resolution_time_secs=t.get("resolution_time_secs"),
        zammad_created_at=t.get("created_at", "2024-01-01T00:00:00Z"),
        zammad_updated_at=t.get("updated_at", "2024-01-01T00:00:00Z"),
        closed_at=t.get("close_at"),
    )


def _scope_filter(tickets: list[TicketOut], user: dict) -> list[TicketOut]:
    """Apply role-based scoping."""
    role = user["role"]
    if role == "admin":
        return tickets
    if role == "agent":
        return [t for t in tickets if t.owner_id == user["sub"]]
    # team_lead / project_manager: filter by group
    group_ids = user.get("group_ids", [])
    return [t for t in tickets if t.group_id in group_ids]


@router.get("", response_model=ApiResponse)
async def list_tickets(
    current: Annotated[dict, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    state: str | None = None,
    priority: str | None = None,
    group_id: str | None = None,
    owner_id: str | None = None,
    search: str | None = None,
):
    cache_key = f"tickets:page:{page}:pp:{per_page}"
    cached = await cache_get(cache_key)
    if cached:
        tickets = [TicketOut(**t) for t in cached]
    else:
        raw = await zammad.get_tickets(page=page, per_page=per_page)
        tickets = [_map_ticket(t) for t in raw]
        await cache_set(cache_key, [t.model_dump(mode="json") for t in tickets])

    tickets = _scope_filter(tickets, current)

    # Apply filters
    if state and state != "all":
        tickets = [t for t in tickets if t.state == state]
    if priority and priority != "all":
        tickets = [t for t in tickets if t.priority == priority]
    if group_id and group_id != "all":
        tickets = [t for t in tickets if t.group_id == group_id]
    if owner_id and owner_id != "all":
        tickets = [t for t in tickets if t.owner_id == owner_id]
    if search:
        q = search.lower()
        tickets = [t for t in tickets if q in t.title.lower() or q in t.number]

    total = len(tickets)
    start = (page - 1) * per_page
    page_data = tickets[start : start + per_page]

    return ApiResponse(data=[t.model_dump(mode="json") for t in page_data], meta={"page": page, "per_page": per_page, "total": total})


@router.get("/{ticket_id}", response_model=ApiResponse)
async def get_ticket(ticket_id: int, current: Annotated[dict, Depends(get_current_user)]):
    cached = await cache_get(f"ticket:{ticket_id}")
    if cached:
        return ApiResponse(data=cached)

    raw = await zammad.get_ticket(ticket_id)
    ticket = _map_ticket(raw)
    articles_raw = await zammad.get_ticket_articles(ticket_id)
    articles = [
        TicketArticleOut(
            id=str(a["id"]),
            ticket_id=str(ticket_id),
            author_name=a.get("from", a.get("created_by", "")),
            author_role=a.get("sender", "agent") if isinstance(a.get("sender"), str) else "agent",
            type=a.get("type", "note") if isinstance(a.get("type"), str) else "note",
            internal=a.get("internal", False),
            body=a.get("body", ""),
            created_at=a.get("created_at", "2024-01-01T00:00:00Z"),
        )
        for a in articles_raw
    ]

    result = {"ticket": ticket.model_dump(mode="json"), "articles": [a.model_dump(mode="json") for a in articles]}
    await cache_set(f"ticket:{ticket_id}", result, ttl=60)
    return ApiResponse(data=result)


@router.get("/sla-at-risk", response_model=ApiResponse)
async def sla_at_risk(current: Annotated[dict, Depends(get_current_user)]):
    raw = await zammad.get_tickets(page=1, per_page=100)
    tickets = [_map_ticket(t) for t in raw]
    tickets = _scope_filter(tickets, current)
    at_risk = [t for t in tickets if t.sla_status in ("warning", "critical", "breached")]
    at_risk.sort(key=lambda t: t.first_response_remaining_secs or 999999)
    return ApiResponse(data=[t.model_dump(mode="json") for t in at_risk[:50]])
