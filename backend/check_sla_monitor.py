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

    all_group_data = _build_sla_monitor(rows, now, groups=[("g1", "Support"), ("g2", "Support"), ("g3", "Empty")])
    assert [(row["id"], row["name"]) for row in all_group_data["sla_rows"]] == [("g1", "Support"), ("g2", "Support"), ("g3", "Empty")]
    assert all_group_data["by_group"]["g2"]["total"] == 1
    assert all_group_data["by_group"]["g3"]["total"] == 0
    assert all_group_data["summary"]["total_active"] == sum(all_group_data["summary"][key] for key in ("on_track", "warning", "critical", "breached", "no_sla"))
    assert all_group_data["summary"]["total_with_sla"] == all_group_data["summary"]["total_active"] - all_group_data["summary"]["no_sla"]
    assert all_group_data["summary"]["at_risk"] == all_group_data["summary"]["warning"] + all_group_data["summary"]["critical"]
    expected_compliance = (all_group_data["summary"]["total_with_sla"] - all_group_data["summary"]["breached"]) / all_group_data["summary"]["total_with_sla"] * 100
    assert all_group_data["summary"]["compliance_rate"] == expected_compliance

    unknown_data = _build_sla_monitor([
        ticket(206, group_id="", group_name="", priority="unknown", escalation_at=None),
    ], now)
    assert unknown_data["summary"]["compliance_rate"] is None
    assert unknown_data["by_group"]["unknown"]["name"] == "Unknown"
    assert unknown_data["by_priority"]["unknown"]["total"] == 1

    group_data = _build_sla_monitor(_apply_ticket_filters(rows, "g2"), now)
    assert group_data["summary"]["total_active"] == 1
    assert group_data["summary"]["on_track"] == 1
    assert len(group_data["tickets"]) == 1

    current_escalation = now + timedelta(hours=4)
    satisfied_response = _build_sla_monitor([
        ticket(
            300,
            escalation_at=current_escalation,
            first_response_at=now - timedelta(hours=5),
            first_response_escalation_at=now - timedelta(hours=6),
            first_response_diff_in_min=60,
        )
    ], now)["tickets"][0]
    assert satisfied_response["live_sla_status"] == "on_track"
    assert satisfied_response["actionable_deadline"] == current_escalation.isoformat()
    assert satisfied_response["sla_remaining_ms"] == 4 * 60 * 60 * 1000

    first_response_deadline = now + timedelta(hours=1)
    unsatisfied_response = _build_sla_monitor([
        ticket(
            301,
            escalation_at=None,
            first_response_escalation_at=first_response_deadline,
            update_escalation_at=now + timedelta(minutes=15),
            close_escalation_at=now + timedelta(hours=3),
        )
    ], now)["tickets"][0]
    assert unsatisfied_response["actionable_deadline"] == first_response_deadline.isoformat()
    assert unsatisfied_response["live_sla_status"] == "warning"

    update_deadline = now + timedelta(hours=3)
    completed_response = _build_sla_monitor([
        ticket(
            302,
            escalation_at=None,
            first_response_at=now - timedelta(hours=1),
            first_response_escalation_at=now - timedelta(hours=2),
            update_escalation_at=update_deadline,
            close_escalation_at=now + timedelta(hours=5),
            zammad_created_at=now - timedelta(hours=3),
        )
    ], now)["tickets"][0]
    assert completed_response["actionable_deadline"] == update_deadline.isoformat()
    assert completed_response["sla_progress"] == 50

    positive_diff_response = _build_sla_monitor([
        ticket(
            303,
            escalation_at=None,
            first_response_at=None,
            first_response_escalation_at=now - timedelta(hours=2),
            first_response_diff_in_min=30,
            update_escalation_at=update_deadline,
        )
    ], now)["tickets"][0]
    assert positive_diff_response["actionable_deadline"] == update_deadline.isoformat()

    for id_, evidence in enumerate((
        {"first_response_breached": True},
        {"close_breached": True},
        {"sla_status": "breached"},
    ), start=304):
        preserved_breach = _build_sla_monitor([
            ticket(id_, escalation_at=now + timedelta(hours=4), **evidence)
        ], now)["tickets"][0]
        assert preserved_breach["live_sla_status"] == "breached"

    boundary_rows = _build_sla_monitor([
        ticket(307, escalation_at=now + timedelta(minutes=30)),
        ticket(308, escalation_at=now + timedelta(minutes=30, seconds=1)),
        ticket(309, escalation_at=now + timedelta(hours=2)),
        ticket(310, escalation_at=now + timedelta(hours=2, seconds=1)),
        ticket(311, escalation_at=now - timedelta(seconds=1)),
        ticket(312, escalation_at=None),
    ], now)["tickets"]
    assert {row["id"]: row["live_sla_status"] for row in boundary_rows} == {
        "307": "critical",
        "308": "warning",
        "309": "warning",
        "310": "on_track",
        "311": "breached",
        "312": "no_sla",
    }
    assert next(row for row in boundary_rows if row["id"] == "312")["actionable_deadline"] is None

    heatmap_deadline = now + timedelta(days=1, hours=4)
    heatmap = _build_sla_monitor([
        ticket(313, escalation_at=heatmap_deadline, first_response_breached=True)
    ], now)["heatmap"]
    assert heatmap["grid"][heatmap_deadline.weekday()][heatmap_deadline.hour] == 1

    sorted_rows = _build_sla_monitor([
        ticket(314, escalation_at=None, first_response_at=now, first_response_escalation_at=now - timedelta(days=1), update_escalation_at=now + timedelta(minutes=90)),
        ticket(315, escalation_at=None, first_response_at=now, first_response_escalation_at=now - timedelta(days=1), update_escalation_at=now + timedelta(minutes=60)),
    ], now)["tickets"]
    assert [row["id"] for row in sorted_rows] == ["315", "314"]


if __name__ == "__main__":
    main()
