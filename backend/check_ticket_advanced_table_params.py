from __future__ import annotations

from datetime import datetime, timezone

from app.models import TicketOut
from app.ticket_table import apply_advanced_filters, apply_table_sorts


def ticket(id_: int, title: str, owner_id: str | None, priority: str, updated: str) -> TicketOut:
    return TicketOut(
        id=str(id_),
        zammad_id=id_,
        number=str(id_),
        title=title,
        state="open",
        priority=priority,
        group_id="support",
        group_name="Support",
        owner_id=owner_id,
        owner_name="Agent" if owner_id else None,
        customer_name="Customer",
        tags=[],
        sla_status="safe",
        first_response_remaining_secs=None,
        first_response_breached=False,
        close_breached=False,
        reopen_count=0,
        first_reply_time_secs=None,
        resolution_time_secs=None,
        zammad_created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        zammad_updated_at=datetime.fromisoformat(updated),
        closed_at=None,
    )


rows = [
    ticket(1, "Printer broken", None, "high", "2026-01-01T10:00:00+00:00"),
    ticket(2, "VPN broken", "42", "normal", "2026-01-01T09:00:00+00:00"),
    ticket(3, "VPN slow", "42", "high", "2026-01-01T11:00:00+00:00"),
]

assert [t.id for t in apply_advanced_filters(rows, '[{"field":"title","operator":"contains","value":"vpn"}]')] == ["2", "3"]
assert [t.id for t in apply_advanced_filters(rows, '[{"field":"priority","operator":"equals","value":"high"}]')] == ["1", "3"]
assert [t.id for t in apply_advanced_filters(rows, '[{"field":"owner_id","operator":"equals","value":"__empty__"}]')] == ["1"]
assert [t.id for t in apply_table_sorts(rows, '[{"field":"priority","desc":false},{"field":"zammad_updated_at","desc":true}]', "updated", "desc")] == ["3", "1", "2"]

print("ok")
