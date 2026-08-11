from __future__ import annotations

import json
from functools import cmp_to_key

from fastapi import HTTPException

from app.models import TicketOut

EMPTY_FILTER_VALUE = "__empty__"
TICKET_TABLE_FIELDS = {
    "number",
    "title",
    "state",
    "priority",
    "group_id",
    "owner_id",
    "customer_name",
    "sla_status",
    "zammad_updated_at",
}


def _parse_json_list(value: str | None) -> list[dict]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="Invalid table params JSON") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=422, detail="Table params must be a list")
    return [item for item in parsed if isinstance(item, dict)]


def _ticket_table_value(ticket: TicketOut, field: str) -> str:
    if field not in TICKET_TABLE_FIELDS:
        return ""
    value = getattr(ticket, field, "")
    if value is None:
        return ""
    return str(getattr(value, "value", value))


def apply_advanced_filters(tickets: list[TicketOut], filters: str | None) -> list[TicketOut]:
    for item in _parse_json_list(filters):
        field = item.get("field")
        operator = item.get("operator")
        if field not in TICKET_TABLE_FIELDS or operator not in {"contains", "equals"}:
            continue
        expected = "" if item.get("value") == EMPTY_FILTER_VALUE else str(item.get("value") or "").lower()
        tickets = [
            ticket
            for ticket in tickets
            if (_ticket_table_value(ticket, field).lower() == expected if operator == "equals" else expected in _ticket_table_value(ticket, field).lower())
        ]
    return tickets


def apply_table_sorts(tickets: list[TicketOut], sorts: str | None, sort_by: str, sort_dir: str) -> list[TicketOut]:
    parsed = [item for item in _parse_json_list(sorts) if item.get("field") in TICKET_TABLE_FIELDS]
    active_sorts = parsed or [{"field": "zammad_updated_at" if sort_by == "updated" else sort_by, "desc": sort_dir != "asc"}]

    def compare(left: TicketOut, right: TicketOut) -> int:
        for item in active_sorts:
            field = item["field"]
            left_value = _ticket_table_value(left, field)
            right_value = _ticket_table_value(right, field)
            result = (left_value > right_value) - (left_value < right_value)
            if result:
                return -result if item.get("desc") else result
        return 0

    return sorted(tickets, key=cmp_to_key(compare))
