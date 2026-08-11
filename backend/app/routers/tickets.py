"""Ticket endpoints. Reads from PostgreSQL (synced by Celery workers)."""
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import cache_get, cache_set
from app.db_models import TicketRow
from app.deps import get_current_user, get_db
from app.models import ApiResponse, TicketArticleOut, TicketOut
from app.repositories import get_articles_for_ticket, list_tickets as list_ticket_rows, upsert_articles, upsert_ticket
from app.ticket_table import apply_advanced_filters, apply_table_sorts
from app.zammad_client import zammad

router = APIRouter()

OPEN_STATES = {"new", "open", "pending"}

SYNC_WATERMARK_KEY = "sync:last_ticket_updated_at"


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
        number=str(t.get("number") or ""),
        title=t.get("title") or "",
        state=_map_state(t.get("state") or "open"),
        priority=_map_priority(t.get("priority") or "normal"),
        group_id=str(t.get("group_id") or ""),
        group_name=t.get("group") if isinstance(t.get("group"), str) else str(t.get("group_id") or ""),
        owner_id=str(t["owner_id"]) if t.get("owner_id") else None,
        owner_name=t.get("owner") if isinstance(t.get("owner"), str) else None,
        customer_name=t.get("customer") if isinstance(t.get("customer"), str) else str(t.get("customer_id") or ""),
        tags=t.get("tags") if isinstance(t.get("tags"), list) else [],
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


def _map_article(a: dict, ticket_id: int) -> TicketArticleOut:
    """Map Zammad article JSON to our schema."""
    return TicketArticleOut(
        id=str(a["id"]),
        ticket_id=str(ticket_id),
        author_name=a.get("from", a.get("created_by", "")),
        author_role=a.get("sender", "agent") if isinstance(a.get("sender"), str) else "agent",
        type=_zammad_name(a.get("type", "note"), "note") if _zammad_name(a.get("type", "note"), "note") in {"email", "phone", "note", "web"} else "note",
        internal=a.get("internal", False),
        body=a.get("body", ""),
        created_at=a.get("created_at", "2024-01-01T00:00:00Z"),
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


def _row_to_ticket(row: TicketRow) -> TicketOut:
    return TicketOut.model_validate(row, from_attributes=True)


async def _fetch_scoped(current: dict, db: AsyncSession) -> list[TicketOut]:
    """Read tickets visible to the current user from PostgreSQL."""
    tickets = [_row_to_ticket(row) for row in await list_ticket_rows(db)]
    return _scope_filter(tickets, current)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _overview_buckets(period: str, year: int, month: int | None = None, week: str | None = None, day: str | None = None) -> list[dict]:
    now = datetime.now(timezone.utc)
    if period == "year":
        return [
            {
                "label": datetime(year, month, 1).strftime("%b"),
                "start": datetime(year, month, 1, tzinfo=timezone.utc),
                "end": datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=timezone.utc),
                "created": 0,
                "closed": 0,
                "reopened": 0,
                "backlog": 0,
            }
            for month in range(1, 13)
        ]

    month = month or (now.month if year == now.year else 1)
    if period == "month":
        return [
            {
                "label": str(day),
                "start": datetime(year, month, day, tzinfo=timezone.utc),
                "end": datetime(year, month, day, tzinfo=timezone.utc) + timedelta(days=1),
                "created": 0,
                "closed": 0,
                "reopened": 0,
                "backlog": 0,
            }
            for day in range(1, monthrange(year, month)[1] + 1)
        ]

    if period == "week":
        if week:
            try:
                week_year, week_number = week.split("-W", 1)
                base = datetime.fromisocalendar(int(week_year), int(week_number), 1).replace(tzinfo=timezone.utc)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="Invalid ISO week") from exc
        else:
            base = now if year == now.year else datetime(year, 1, 1, tzinfo=timezone.utc)
        start = datetime.combine((base - timedelta(days=base.weekday())).date(), time.min, tzinfo=timezone.utc)
        return [
            {
                "label": (start + timedelta(days=i)).strftime("%a"),
                "start": start + timedelta(days=i),
                "end": start + timedelta(days=i + 1),
                "created": 0,
                "closed": 0,
                "reopened": 0,
                "backlog": 0,
            }
            for i in range(7)
        ]

    try:
        base_date = date.fromisoformat(day) if day else (now.date() if year == now.year else datetime(year, 1, 1, tzinfo=timezone.utc).date())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid day") from exc
    start = datetime.combine(base_date, time.min, tzinfo=timezone.utc)
    return [
        {
            "label": f"{hour:02d}:00",
            "start": start + timedelta(hours=hour),
            "end": start + timedelta(hours=hour + 1),
            "created": 0,
            "closed": 0,
            "reopened": 0,
            "backlog": 0,
        }
        for hour in range(24)
    ]


def _bucket_index(buckets: list[dict], value: datetime | None) -> int | None:
    value = _as_utc(value)
    if value is None:
        return None
    for index, bucket in enumerate(buckets):
        if bucket["start"] <= value < bucket["end"]:
            return index
    return None


def _apply_ticket_filters(tickets: list[TicketOut], group_id: str | None = None, owner_id: str | None = None) -> list[TicketOut]:
    if group_id and group_id != "all":
        tickets = [t for t in tickets if t.group_id == group_id]
    if owner_id and owner_id != "all":
        tickets = [t for t in tickets if t.owner_id == owner_id]
    return tickets


@router.get("", response_model=ApiResponse)
async def list_tickets(
    current: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    state: str | None = None,
    priority: str | None = None,
    group_id: str | None = None,
    owner_id: str | None = None,
    search: str | None = None,
    sort_by: str = "updated",
    sort_dir: str = "desc",
    filters: str | None = None,
    sorts: str | None = None,
):
    tickets = await _fetch_scoped(current, db)

    if state and state != "all":
        tickets = [t for t in tickets if t.state == state]
    if priority and priority != "all":
        tickets = [t for t in tickets if t.priority == priority]
    tickets = _apply_ticket_filters(tickets, group_id, owner_id)
    if search:
        q = search.lower()
        tickets = [t for t in tickets if q in t.title.lower() or q in t.number or q in t.customer_name.lower()]

    tickets = apply_advanced_filters(tickets, filters)
    tickets = apply_table_sorts(tickets, sorts, sort_by, sort_dir)
    total = len(tickets)
    start = (page - 1) * per_page
    page_data = tickets[start : start + per_page]

    return ApiResponse(data=[t.model_dump(mode="json") for t in page_data], meta={"page": page, "per_page": per_page, "total": total})


@router.get("/sla-at-risk", response_model=ApiResponse)
async def sla_at_risk(current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    tickets = await _fetch_scoped(current, db)
    at_risk = [t for t in tickets if t.sla_status in ("warning", "critical", "breached")]
    at_risk.sort(key=lambda t: t.first_response_remaining_secs or 999999)
    return ApiResponse(data=[t.model_dump(mode="json") for t in at_risk[:50]])


@router.get("/overview", response_model=ApiResponse)
async def overview(
    current: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    period: Literal["year", "month", "week", "day"] = "year",
    year: int | None = Query(None, ge=2000, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    week: str | None = Query(None, pattern=r"^\d{4}-W\d{2}$"),
    day: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    group_id: str | None = None,
    owner_id: str | None = None,
):
    year = year or datetime.now(timezone.utc).year
    buckets = _overview_buckets(period, year, month, week, day)
    window_start, window_end = buckets[0]["start"], buckets[-1]["end"]
    tickets = _apply_ticket_filters(await _fetch_scoped(current, db), group_id, owner_id)
    rows = []

    for ticket in tickets:
        created_idx = _bucket_index(buckets, ticket.zammad_created_at)
        closed_idx = _bucket_index(buckets, ticket.closed_at)
        # ponytail: tickets only store reopen_count, not reopen event history; use updated_at until reopen events are synced.
        reopened_idx = _bucket_index(buckets, ticket.zammad_updated_at) if ticket.reopen_count > 0 else None

        if created_idx is not None:
            buckets[created_idx]["created"] += 1
        if closed_idx is not None:
            buckets[closed_idx]["closed"] += 1
        if reopened_idx is not None:
            buckets[reopened_idx]["reopened"] += 1

        timestamps = [
            _as_utc(ticket.zammad_created_at),
            _as_utc(ticket.closed_at),
            _as_utc(ticket.zammad_updated_at) if ticket.reopen_count > 0 else None,
        ]
        if any(ts and window_start <= ts < window_end for ts in timestamps):
            rows.append(ticket)

    backlog = 0
    for bucket in buckets:
        backlog += bucket["created"] - bucket["closed"]
        bucket["backlog"] = backlog

    rows.sort(key=lambda t: t.zammad_updated_at, reverse=True)
    total = len(rows)
    page_rows = rows[(page - 1) * per_page : page * per_page]
    chart = [{k: bucket[k] for k in ("label", "created", "closed", "reopened", "backlog")} for bucket in buckets]

    return ApiResponse(data={
        "chart": chart,
        "totals": {
            "created": sum(point["created"] for point in chart),
            "closed": sum(point["closed"] for point in chart),
            "reopened": sum(point["reopened"] for point in chart),
            "backlog": backlog,
        },
        "tickets": [t.model_dump(mode="json") for t in page_rows],
        "total": total,
        "groups": sorted({t.group_name for t in rows if t.group_name}),
        "agents": sorted({t.owner_name for t in rows if t.owner_name}),
    })


@router.get("/{ticket_id}", response_model=ApiResponse)
async def get_ticket(ticket_id: int, current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    cached = await cache_get(f"ticket:{ticket_id}")
    if cached:
        return ApiResponse(data=cached)

    # Read from DB (synced by workers). Backfill from Zammad only on a miss so
    # steady-state reads never hit Zammad, but the UI never 404s on new tickets.
    row = await db.get(TicketRow, str(ticket_id))
    articles = await get_articles_for_ticket(db, str(ticket_id))
    if row is None or not articles:
        try:
            raw = await zammad.get_ticket(ticket_id)
            ticket = _map_ticket(raw)
            await upsert_ticket(db, ticket)

            from app.repositories import upsert_articles as _upsert_articles
            articles_raw = await zammad.get_ticket_articles(ticket_id)
            articles = [_map_article(a, ticket_id) for a in articles_raw]
            await _upsert_articles(db, articles)
            await db.commit()
            row = TicketRow(**ticket.model_dump())
        except Exception:
            if row is None:
                return ApiResponse(data=None)

    if row is None:
        return ApiResponse(data=None)

    ticket = _row_to_ticket(row)
    result = {"ticket": ticket.model_dump(mode="json"), "articles": [TicketArticleOut.model_validate(a, from_attributes=True).model_dump() for a in articles]}
    await cache_set(f"ticket:{ticket_id}", result, ttl=60)
    return ApiResponse(data=result)
