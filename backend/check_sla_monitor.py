from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models import TicketOut
from app.routers.tickets import _apply_ticket_filters, _build_sla_monitor


def ticket(id_: int, group_id: str = "g1", **overrides) -> TicketOut:
    now = datetime.now(timezone.utc)
    data = {
        "id": str(id_),
        "zammad_id": id_,
        "number": str(id_),
        "title": f"Ticket {id_}",
        "state": "open",
        "priority": "normal",
        "priority_id": "2",
        "state_id": "2",
        "group_id": group_id,
        "group_name": group_id,
        "owner_id": None,
        "owner_name": None,
        "customer_name": "Customer",
        "tags": [],
        "sla_status": "safe",
        "escalation_at": now + timedelta(hours=4),
        "first_response_at": None,
        "first_response_escalation_at": None,
        "first_response_in_min": None,
        "first_response_diff_in_min": None,
        "close_at": None,
        "close_escalation_at": None,
        "close_in_min": None,
        "close_diff_in_min": None,
        "update_escalation_at": None,
        "update_diff_in_min": None,
        "first_response_remaining_secs": None,
        "first_response_breached": False,
        "close_breached": False,
        "reopen_count": 0,
        "first_reply_time_secs": None,
        "resolution_time_secs": None,
        "zammad_created_at": now - timedelta(hours=1),
        "zammad_updated_at": now,
        "closed_at": None,
    }
    data.update(overrides)
    return TicketOut(**data)


def main() -> None:
    now = datetime.now(timezone.utc)
    rows = [ticket(i) for i in range(1, 122)]
    rows += [
        ticket(200, group_id="g2"),
        ticket(201, close_breached=True, escalation_at=None),
        ticket(202, escalation_at=now + timedelta(minutes=10)),
        ticket(203, escalation_at=now + timedelta(hours=1)),
        ticket(204, escalation_at=None),
        ticket(205, escalation_at=now - timedelta(minutes=1)),
    ]

    data = _build_sla_monitor(rows, now)
    assert data["summary"]["total_active"] == 127
    assert data["summary"]["on_track"] == 122
    assert data["summary"]["breached"] == 1
    assert data["summary"]["at_risk"] == 2
    assert data["summary"]["no_sla"] == 2
    assert data["summary"]["sla_total"] == 125
    assert [row["id"] for row in data["risk_rows"][:3]] == ["205", "202", "203"]

    all_group_data = _build_sla_monitor(rows, now, group_names=["g1", "g2", "g3"])
    assert [row["name"] for row in all_group_data["sla_rows"]] == ["g1", "g2", "g3"]
    assert all_group_data["by_group"]["g2"]["total"] == 1
    assert all_group_data["by_group"]["g3"]["total"] == 0

    group_data = _build_sla_monitor(_apply_ticket_filters(rows, "g2"), now)
    assert group_data["summary"]["total_active"] == 1
    assert group_data["summary"]["on_track"] == 1
    assert len(group_data["tickets"]) == 1


if __name__ == "__main__":
    main()
