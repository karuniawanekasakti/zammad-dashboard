"""Ticket endpoints. Reads from PostgreSQL (synced by Celery workers)."""
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import cache_get, cache_set
from app.db_models import TicketRow
from app.deps import get_current_user, get_db
from app.models import ApiResponse, TicketArticleOut, TicketHistoryOut, TicketOut
from app.repositories import get_articles_for_ticket, get_state_history, list_groups as list_group_rows, list_tickets as list_ticket_rows, upsert_articles, upsert_ticket
from app.ticket_table import apply_advanced_filters, apply_table_sorts
from app.zammad_client import zammad

router = APIRouter()
history_router = APIRouter()

OPEN_STATES = {"new", "open", "pending"}

SYNC_WATERMARK_KEY = "sync:last_ticket_updated_at"

SEVERITY_LABELS = {
    "p01": "P1 - Critical",
    "p02": "P2 - High",
    "p03": "P3 - Medium",
    "p04": "P4 - Low",
    "BRI01": "BRI Critical 1 (0-30 KM)",
    "BRI02": "BRI Critical 2 (30-60 KM)",
    "BRI03": "BRI Critical 3 (60-120 KM)",
    "BRI04": "BRI Critical 4 (120-200 KM)",
}

TICKET_CATEGORY_LABELS = {
    "HSU": "Hardware Software Update",
    "SRSM": "Service Request Support and Management",
    "SPMS": "SparePart Management System",
    "Reporting": "Reporting",
}


def _zammad_name(value, default: str) -> str:
    if isinstance(value, dict):
        value = value.get("name", default)
    name = str(value or default).lower().strip()
    return name.split(" ", 1)[1] if name[:1].isdigit() and " " in name else name


def _custom_field_value(value) -> str | None:
    if isinstance(value, dict):
        value = value.get("name") or value.get("value") or value.get("label")
    return str(value) if value not in (None, "", [], {}) else None


def _field_label(value: str | None, labels: dict[str, str]) -> str | None:
    return labels.get(value) if value else None


def _int_or_none(value) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


def _map_priority(value) -> str:
    name = _zammad_name(value, "unknown")
    return {"medium": "normal", "urgent": "very high"}.get(name, name if name in {"low", "normal", "high", "very high"} else "unknown")


def _map_state(value) -> str:
    name = _zammad_name(value, "open").replace(" ", "_")
    if name.startswith("pending"):
        return "pending"
    return name if name in {"new", "open", "pending", "closed", "merged"} else "open"


def _parse_zammad_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _sla_bucket(remaining: int | None) -> str:
    if remaining is None:
        return "safe"
    if remaining < 0:
        return "breached"
    if remaining < 1800:
        return "critical"
    if remaining < 7200:
        return "warning"
    return "safe"


def _expanded_name(value, fallback: str | None = None) -> str | None:
    if isinstance(value, dict):
        full_name = " ".join(part for part in (value.get("firstname"), value.get("lastname")) if part)
        return value.get("name") or full_name or value.get("login") or fallback
    if isinstance(value, str):
        return value
    return fallback


def _map_ticket(t: dict) -> TicketOut:
    """Map Zammad ticket JSON to our schema."""
    now = datetime.now(timezone.utc)
    escalation_at = _parse_zammad_dt(t.get("escalation_at"))
    first_response_at = _parse_zammad_dt(t.get("first_response_at"))
    first_response_deadline = _parse_zammad_dt(t.get("first_response_escalation_at") or t.get("sla_response_at"))
    update_deadline = _parse_zammad_dt(t.get("update_escalation_at") or t.get("sla_update_at"))
    close_at = _parse_zammad_dt(t.get("close_at"))
    close_deadline = _parse_zammad_dt(t.get("close_escalation_at") or t.get("solution_escalation_at") or t.get("sla_solution_at"))
    first_response_diff = _int_or_none(t.get("first_response_diff_in_min"))
    close_diff = _int_or_none(t.get("close_diff_in_min"))
    first_response_satisfied = bool(first_response_at or (first_response_diff is not None and first_response_diff >= 0))
    deadline = escalation_at or (first_response_deadline if not first_response_satisfied else None) or update_deadline or close_deadline
    remaining = int((deadline - now).total_seconds()) if deadline else None
    first_response_breached = first_response_diff < 0 if first_response_diff is not None else bool(
        first_response_at and first_response_deadline and first_response_at > first_response_deadline
        or not first_response_at and first_response_deadline and first_response_deadline < now
    )
    close_breached = close_diff < 0 if close_diff is not None else bool(
        close_at and close_deadline and close_at > close_deadline
        or not close_at and close_deadline and close_deadline < now
    )
    update_diff = _int_or_none(t.get("update_diff_in_min"))
    sla_status = "breached" if (remaining is not None and remaining < 0) or first_response_breached or close_breached or (update_diff is not None and update_diff < 0) else _sla_bucket(remaining)

    severity = _custom_field_value(t.get("priority_case"))
    ticket_category = _custom_field_value(t.get("ticket_category"))

    return TicketOut(
        id=str(t["id"]),
        zammad_id=t["id"],
        number=str(t.get("number") or ""),
        title=t.get("title") or "",
        state=_map_state(t.get("state") or "open"),
        priority=_map_priority(t.get("priority")),
        priority_id=str(t.get("priority_id") or ""),
        state_id=str(t.get("state_id") or ""),
        severity=severity,
        severity_label=_field_label(severity, SEVERITY_LABELS),
        ticket_category=ticket_category,
        ticket_category_label=_field_label(ticket_category, TICKET_CATEGORY_LABELS),
        group_id=str(t.get("group_id") or ""),
        group_name=_expanded_name(t.get("group"), str(t.get("group_id") or "")) or "",
        owner_id=str(t["owner_id"]) if t.get("owner_id") else None,
        owner_name=_expanded_name(t.get("owner")),
        customer_name=_expanded_name(t.get("customer"), str(t.get("customer_id") or "")) or "",
        tags=t.get("tags") if isinstance(t.get("tags"), list) else [],
        sla_status=sla_status,
        escalation_at=escalation_at,
        first_response_at=first_response_at,
        first_response_escalation_at=first_response_deadline,
        first_response_in_min=_int_or_none(t.get("first_response_in_min")),
        first_response_diff_in_min=first_response_diff,
        close_at=close_at,
        close_escalation_at=close_deadline,
        close_in_min=_int_or_none(t.get("close_in_min")),
        close_diff_in_min=close_diff,
        update_escalation_at=update_deadline,
        update_diff_in_min=update_diff,
        first_response_remaining_secs=remaining,
        first_response_breached=first_response_breached,
        close_breached=close_breached,
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


def _map_history(payload, ticket_id: int) -> list[TicketHistoryOut]:
    """Map a Zammad ticket-history payload ({history:[...], assets:{...}}) to rows."""
    entries = payload.get("history", []) if isinstance(payload, dict) else payload
    rows = []
    for e in entries or []:
        if not isinstance(e, dict) or e.get("id") is None:
            continue
        created_at = _parse_zammad_dt(e.get("created_at"))
        if created_at is None:
            continue
        rows.append(TicketHistoryOut(
            id=str(e["id"]),
            ticket_id=str(e.get("o_id") or ticket_id),
            attribute=e.get("attribute"),
            value_from=None if e.get("value_from") is None else str(e.get("value_from")),
            value_to=None if e.get("value_to") is None else str(e.get("value_to")),
            created_at=created_at,
        ))
    return rows


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
                "open": 0,
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
                "open": 0,
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
                "open": 0,
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
            "open": 0,
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


def _reopen_events(history: list) -> list[datetime]:
    """Reopen events: state transitions from closed to any non-closed state
    (Zammad's ticket_reopen definition)."""
    return [
        ts
        for h in history
        if h.value_from == "closed" and h.value_to not in (None, "closed") and (ts := _as_utc(h.created_at)) is not None
    ]


def _apply_ticket_filters(tickets: list[TicketOut], group_id: str | None = None, owner_id: str | None = None) -> list[TicketOut]:
    if group_id and group_id != "all":
        tickets = [t for t in tickets if t.group_id == group_id]
    if owner_id and owner_id != "all":
        tickets = [t for t in tickets if t.owner_id == owner_id]
    return tickets


def _sla_deadline(ticket: TicketOut) -> datetime | None:
    if ticket.escalation_at:
        return _as_utc(ticket.escalation_at)
    first_response_satisfied = bool(ticket.first_response_at or (ticket.first_response_diff_in_min is not None and ticket.first_response_diff_in_min >= 0))
    if not first_response_satisfied and ticket.first_response_escalation_at:
        return _as_utc(ticket.first_response_escalation_at)
    fallbacks = [_as_utc(value) for value in (ticket.update_escalation_at, ticket.close_escalation_at) if value]
    return min(fallbacks) if fallbacks else None


def _sla_outcome_diffs(ticket: TicketOut) -> tuple[int, ...]:
    return tuple(value for value in (ticket.first_response_diff_in_min, ticket.update_diff_in_min, ticket.close_diff_in_min) if value is not None)


def _effective_sla_status(ticket: TicketOut, now: datetime) -> str:
    deadline = _sla_deadline(ticket)
    outcome_diffs = _sla_outcome_diffs(ticket)
    if ticket.first_response_breached or ticket.close_breached or ticket.sla_status == "breached" or any(value < 0 for value in outcome_diffs):
        return "breached"
    if ticket.state in ("closed", "merged") and outcome_diffs:
        return "closed_on_time"
    if not deadline:
        return "no_sla"
    closed_at = _as_utc(ticket.close_at or ticket.closed_at)
    if ticket.state in ("closed", "merged"):
        return "closed_on_time" if closed_at and closed_at <= deadline else "breached"
    if now > deadline:
        return "breached"
    remaining = (deadline - now).total_seconds()
    if remaining <= 30 * 60:
        return "critical"
    if remaining <= 2 * 60 * 60:
        return "warning"
    return "on_track"


def _sla_remaining_ms(ticket: TicketOut, now: datetime) -> int | None:
    deadline = _sla_deadline(ticket)
    return int((deadline - now).total_seconds() * 1000) if deadline else None


def _sla_progress(ticket: TicketOut, now: datetime) -> int:
    deadline = _sla_deadline(ticket)
    created = _as_utc(ticket.zammad_created_at)
    if not deadline or not created or deadline <= created:
        return 0
    return max(0, min(100, round(((now - created).total_seconds() / (deadline - created).total_seconds()) * 100)))


def _sla_counts(rows: list[dict]) -> dict:
    with_sla = [t for t in rows if t["live_sla_status"] != "no_sla"]
    breached = len([t for t in with_sla if t["live_sla_status"] == "breached"])
    return {
        "total": len(rows),
        "total_with_sla": len(with_sla),
        "on_track": len([t for t in rows if t["live_sla_status"] == "on_track"]),
        "warning": len([t for t in rows if t["live_sla_status"] == "warning"]),
        "critical": len([t for t in rows if t["live_sla_status"] == "critical"]),
        "at_risk": len([t for t in rows if t["live_sla_status"] in ("warning", "critical")]),
        "breached": breached,
        "no_sla": len([t for t in rows if t["live_sla_status"] == "no_sla"]),
        "compliance_rate": ((len(with_sla) - breached) / len(with_sla) * 100) if with_sla else None,
    }


def _sla_row(id_: str, name: str, rows: list[dict]) -> dict:
    return {"id": id_, "name": name, **_sla_counts(rows)}


def _avg_minutes(values: list[int | None]) -> int | None:
    nums = [v for v in values if v is not None]
    return round(sum(nums) / len(nums)) if nums else None


def _status_rank(status: str) -> int:
    return {"breached": 0, "critical": 1, "warning": 2, "on_track": 3, "no_sla": 4}.get(status, 5)


def _build_sla_monitor(tickets: list[TicketOut], now: datetime | None = None, groups: list[tuple[str, str]] | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    active = [t for t in tickets if t.state in OPEN_STATES]
    closed = [t for t in tickets if t.state in ("closed", "merged")]

    rows = []
    for ticket in active:
        deadline = _sla_deadline(ticket)
        status = _effective_sla_status(ticket, now)
        data = ticket.model_dump(mode="json")
        data.update({"actionable_deadline": deadline.isoformat() if deadline else None, "live_sla_status": status, "sla_remaining_ms": _sla_remaining_ms(ticket, now), "sla_progress": _sla_progress(ticket, now)})
        rows.append(data)

    closed_rows = []
    for ticket in closed:
        deadline = _sla_deadline(ticket)
        status = _effective_sla_status(ticket, now)
        data = ticket.model_dump(mode="json")
        data.update({"actionable_deadline": deadline.isoformat() if deadline else None, "live_sla_status": status, "sla_remaining_ms": _sla_remaining_ms(ticket, now), "sla_progress": _sla_progress(ticket, now)})
        closed_rows.append(data)

    summary = _sla_counts(rows)
    summary.update({
        "total_active": len(active),
        "sla_total": summary["total_with_sla"],
        "total_closed_on_time": len([t for t in closed_rows if t["live_sla_status"] == "closed_on_time"]),
        "avg_resolution_minutes": _avg_minutes([t.close_in_min for t in closed if t.close_at or t.closed_at]),
        "avg_resolution_mins": _avg_minutes([t.close_in_min for t in closed if t.close_at or t.closed_at]),
    })

    priority_labels = {"very high": "Urgent", "high": "High", "normal": "Medium", "low": "Low", "unknown": "Unknown"}
    priority_rows = [_sla_row(priority, label, [t for t in rows if t["priority"] == priority]) for priority, label in priority_labels.items()]
    by_priority = {row["id"]: row for row in priority_rows}

    if groups is None:
        groups = sorted({(t["group_id"] or "unknown", t["group_name"] or "Unknown") for t in rows})
    sla_rows = [_sla_row(group_id, name, [t for t in rows if (t["group_id"] or "unknown") == group_id]) for group_id, name in groups]
    by_group = {row["id"]: row for row in sla_rows}

    today = datetime.combine(now.date(), time.min, tzinfo=timezone.utc)
    day_labels = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]
    trend = []
    for i in range(7):
        start = today - timedelta(days=6 - i)
        end = start + timedelta(days=1)
        day_closed = [t for t in closed if (_sla_outcome_diffs(t) or _sla_deadline(t) or _effective_sla_status(t, now) == "breached") and (closed_at := _as_utc(t.close_at or t.closed_at)) and start <= closed_at < end]
        breach_count = len([t for t in day_closed if _effective_sla_status(t, now) == "breached"])
        trend.append({"date": start.date().isoformat(), "day": day_labels[start.weekday() + 1 if start.weekday() < 6 else 0], "rate": ((len(day_closed) - breach_count) / len(day_closed) * 100) if day_closed else 0, "total": len(day_closed), "breach": breach_count})

    grid = [[0 for _ in range(24)] for _ in range(7)]
    for ticket in active:
        if _effective_sla_status(ticket, now) != "breached":
            continue
        dt = _sla_deadline(ticket) or _as_utc(ticket.zammad_updated_at)
        if dt:
            grid[dt.weekday()][dt.hour] += 1

    rows.sort(key=lambda t: (_status_rank(t["live_sla_status"]), t["sla_remaining_ms"] if t["sla_remaining_ms"] is not None else 10**15))
    breach_log = [t for t in closed if _effective_sla_status(t, now) == "breached"]
    breach_log.sort(key=lambda t: _as_utc(t.close_at or t.closed_at) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

    return {
        **summary,
        "summary": summary,
        "by_priority": by_priority,
        "by_group": by_group,
        "priority_rows": priority_rows,
        "sla_rows": sla_rows,
        "trend": trend,
        "heatmap": {"grid": grid, "max": max(1, *(value for row in grid for value in row))},
        "tickets": rows,
        "risk_rows": [t for t in rows if t["live_sla_status"] in ("breached", "critical", "warning")],
        "breach_log": [t.model_dump(mode="json") for t in breach_log],
    }


def _state_ids(query: str) -> set[str] | None:
    marker = "state_id:("
    start = query.find(marker)
    if start < 0:
        return None
    end = query.find(")", start)
    if end < 0:
        return None
    return {value.strip() for value in query[start + len(marker):end].split(",") if value.strip()}


def _ticket_matches_limited_search(ticket: TicketOut, query: str, now: datetime) -> bool:
    states = _state_ids(query)
    if states and (ticket.state_id or {"new": "1", "open": "2", "pending": "3", "closed": "4"}.get(str(ticket.state), "")) not in states:
        return False
    if "close_at:[now-7d TO now]" in query:
        close_at = _as_utc(ticket.close_at or ticket.closed_at)
        return bool(close_at and now - timedelta(days=7) <= close_at <= now)
    return True


@router.get("/search", response_model=ApiResponse)
async def search_tickets(
    current: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    query: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    # ponytail: this covers SLA monitor's Zammad query subset; proxy/parse wider search syntax when another page needs it.
    now = datetime.now(timezone.utc)
    rows = [t for t in await _fetch_scoped(current, db) if _ticket_matches_limited_search(t, query, now)]
    rows.sort(key=lambda t: t.zammad_updated_at, reverse=True)
    total = len(rows)
    page_rows = rows[(page - 1) * per_page : page * per_page]
    return ApiResponse(data=[t.model_dump(mode="json") for t in page_rows], meta={"page": page, "per_page": per_page, "total": total})


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


@router.get("/sla-monitor", response_model=ApiResponse)
async def sla_monitor(
    current: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    group_id: str | None = None,
    priority: str | None = None,
):
    tickets = _apply_ticket_filters(await _fetch_scoped(current, db), group_id)
    if priority and priority != "all":
        tickets = [ticket for ticket in tickets if ticket.priority == priority]
    visible_ids = {t.group_id for t in tickets}
    group_names = {g.id: g.name or "Unknown" for g in await list_group_rows(db)}
    groups = sorted((group_id or "unknown", group_names.get(group_id, "Unknown")) for group_id in visible_ids)
    return ApiResponse(data=_build_sla_monitor(tickets, groups=groups))


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
    tab: Literal["created", "closed", "open", "reopened"] | None = None,
):
    now = datetime.now(timezone.utc)
    year = year or now.year
    buckets = _overview_buckets(period, year, month, week, day)
    window_start, window_end = buckets[0]["start"], buckets[-1]["end"]
    tickets = _apply_ticket_filters(await _fetch_scoped(current, db), group_id, owner_id)

    history_by_ticket: dict[str, list] = {}
    for h in await get_state_history(db):
        history_by_ticket.setdefault(h.ticket_id, []).append(h)

    rows: list[tuple[TicketOut, datetime | None, datetime | None]] = []
    open_ticket_ids: set[str] = set()
    for ticket in tickets:
        history = history_by_ticket.get(ticket.id, [])
        reopens = _reopen_events(history)

        # Chart Open uses the same bucketing as Created/Closed: tickets *created*
        # in the bucket. It is deliberately NOT a cumulative overlap of open
        # intervals, so the three series stay comparable per period.
        created_idx = _bucket_index(buckets, ticket.zammad_created_at)
        closed_idx = _bucket_index(buckets, ticket.closed_at)
        if created_idx is not None:
            buckets[created_idx]["created"] += 1
            buckets[created_idx]["open"] += 1
            open_ticket_ids.add(ticket.id)
        if closed_idx is not None:
            buckets[closed_idx]["closed"] += 1
        for ts in reopens:
            idx = _bucket_index(buckets, ts)
            if idx is not None:
                buckets[idx]["reopened"] += 1

        created_in_window = created_idx is not None
        closed_in_window = closed_idx is not None
        reopen_in_window = any(window_start <= ts < window_end for ts in reopens)
        if created_in_window or closed_in_window or reopen_in_window:
            last_reopen_at = max(reopens, default=None)
            rows.append((ticket, _as_utc(ticket.zammad_created_at), last_reopen_at))

    # Server-side tab filtering before pagination. Open tab = tickets whose
    # CURRENT state is exactly "open" (within the selected window scope).
    if tab == "open":
        rows = [row for row in rows if row[0].state == "open"]
    elif tab == "closed":
        rows = [row for row in rows if row[0].state in ("closed", "merged")]
    elif tab == "reopened":
        rows = [row for row in rows if row[0].reopen_count > 0]

    backlog = 0
    for bucket in buckets:
        backlog += bucket["created"] - bucket["closed"]
        bucket["backlog"] = backlog

    rows.sort(key=lambda row: row[0].zammad_updated_at, reverse=True)
    total = len(rows)
    page_rows = rows[(page - 1) * per_page : page * per_page]
    chart = [{k: bucket[k] for k in ("label", "created", "closed", "open", "reopened", "backlog")} for bucket in buckets]

    ticket_dicts = []
    for ticket, last_open_at, last_reopen_at in page_rows:
        data = ticket.model_dump(mode="json")
        # Overview-only injected timestamps; the shared ticket schema is untouched.
        if tab == "open":
            data["last_open_at"] = (last_open_at or _as_utc(ticket.zammad_updated_at) or _as_utc(ticket.zammad_created_at)).isoformat()
        elif tab == "reopened":
            fallback = last_reopen_at or _as_utc(ticket.zammad_updated_at)
            data["last_reopen_at"] = fallback.isoformat() if fallback else None
        ticket_dicts.append(data)

    return ApiResponse(data={
        "chart": chart,
        "totals": {
            "created": sum(point["created"] for point in chart),
            "closed": sum(point["closed"] for point in chart),
            "open": len(open_ticket_ids),
            "reopened": sum(point["reopened"] for point in chart),
            "backlog": backlog,
        },
        "tickets": ticket_dicts,
        "total": total,
        "groups": sorted({row[0].group_name for row in rows if row[0].group_name}),
        "agents": sorted({row[0].owner_name for row in rows if row[0].owner_name}),
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

            from app.repositories import upsert_articles as _upsert_articles, upsert_history as _upsert_history
            articles_raw = await zammad.get_ticket_articles(ticket_id)
            articles = [_map_article(a, ticket_id) for a in articles_raw]
            await _upsert_articles(db, articles)
            await _upsert_history(db, _map_history(await zammad.get_ticket_history(ticket_id), ticket_id))
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


@history_router.get("/ticket_history/{ticket_id}", response_model=ApiResponse)
async def get_ticket_history(ticket_id: int, current: Annotated[dict, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    row = await db.get(TicketRow, str(ticket_id))
    if row is None or not _scope_filter([_row_to_ticket(row)], current):
        return ApiResponse(data=[])

    try:
        history = await zammad.get_ticket_history(ticket_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch ticket history") from exc
    return ApiResponse(data=history)
