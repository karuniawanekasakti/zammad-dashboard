"""Ticket endpoints."""
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.cache import cache_get, cache_set
from app.deps import get_current_user
from app.models import ApiResponse, TicketArticleOut, TicketOut
from app.zammad_client import zammad

router = APIRouter()


OPEN_STATES = {"new", "open", "pending"}


def _zammad_name(value, default: str) -> str:
    if isinstance(value, dict):
        value = value.get("name", default)
    name = str(value or default).lower().strip()
    return name.split(" ", 1)[1] if name[:1].isdigit() and " " in name else name


def _map_priority(value) -> str:
    name = _zammad_name(value, "normal")
    return {"medium": "normal", "urgent": "very high"}.get(name, name if name in {"low", "normal", "high", "very high"} else "normal")


def _map_state(value) -> str:
    name = _zammad_name(value, "open").replace(" ", "_")
    if name.startswith("pending"):
        return "pending"
    return name if name in {"new", "open", "pending", "closed", "merged"} else "open"


def _map_ticket(t: dict) -> TicketOut:
    """Map Zammad ticket JSON to our schema."""
    from datetime import datetime, timezone

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

    return TicketOut(
        id=str(t["id"]),
        zammad_id=t["id"],
        number=str(t.get("number", "")),
        title=t.get("title", ""),
        state=_map_state(t.get("state", "open")),
        priority=_map_priority(t.get("priority", "normal")),
        group_id=str(t.get("group_id", "")),
        group_name=t.get("group", "") if isinstance(t.get("group"), str) else str(t.get("group_id", "")),
        owner_id=str(t["owner_id"]) if t.get("owner_id") else None,
        owner_name=t.get("owner", None) if isinstance(t.get("owner"), str) else None,
        customer_name=t.get("customer", "") if isinstance(t.get("customer"), str) else str(t.get("customer_id", "")),
        tags=t.get("tags", []) if isinstance(t.get("tags"), list) else [],
        sla_status=sla_status,
        first_response_remaining_secs=remaining,
        first_response_breached=t.get("first_response_in_min") is not None and remaining is not None and remaining < 0,
        close_breached=bool(t.get("close_escalation_at") and t.get("close_in_min") is not None and (t.get("close_escalation_at") or "") < datetime.now(timezone.utc).isoformat()),
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
    group_ids = user.get("group_ids", [])
    return [t for t in tickets if t.group_id in group_ids]


async def _fetch_scoped(current: dict) -> list[TicketOut]:
    """Fetch mapped Zammad tickets visible to the current user."""
    groups = ",".join(current.get("group_ids", []))
    cache_key = f"tickets:scoped:{current['sub']}:{current['role']}:{groups}:all:v1"
    cached = await cache_get(cache_key)
    if cached:
        return [TicketOut(**t) for t in cached]

    raw = await zammad.get_all_tickets(per_page=100)
    tickets = _scope_filter([_map_ticket(t) for t in raw], current)
    await cache_set(cache_key, [t.model_dump(mode="json") for t in tickets], ttl=300)
    return tickets


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
    sort_by: str = "updated",
    sort_dir: str = "desc",
):
    tickets = await _fetch_scoped(current)

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
        tickets = [t for t in tickets if q in t.title.lower() or q in t.number or q in t.customer_name.lower()]

    if sort_by in {"updated", "zammad_updated_at"}:
        tickets.sort(key=lambda t: t.zammad_updated_at, reverse=sort_dir != "asc")
    total = len(tickets)
    start = (page - 1) * per_page
    page_data = tickets[start : start + per_page]

    return ApiResponse(data=[t.model_dump(mode="json") for t in page_data], meta={"page": page, "per_page": per_page, "total": total})


@router.get("/sla-at-risk", response_model=ApiResponse)
async def sla_at_risk(current: Annotated[dict, Depends(get_current_user)]):
    tickets = await _fetch_scoped(current)
    at_risk = [t for t in tickets if t.sla_status in ("warning", "critical", "breached")]
    at_risk.sort(key=lambda t: t.first_response_remaining_secs or 999999)
    return ApiResponse(data=[t.model_dump(mode="json") for t in at_risk[:50]])


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
            type=_zammad_name(a.get("type", "note"), "note") if _zammad_name(a.get("type", "note"), "note") in {"email", "phone", "note", "web"} else "note",
            internal=a.get("internal", False),
            body=a.get("body", ""),
            created_at=a.get("created_at", "2024-01-01T00:00:00Z"),
        )
        for a in articles_raw
    ]

    result = {"ticket": ticket.model_dump(mode="json"), "articles": [a.model_dump(mode="json") for a in articles]}
    await cache_set(f"ticket:{ticket_id}", result, ttl=60)
    return ApiResponse(data=result)
