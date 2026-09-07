"""Assert Zammad SLA fields survive ticket mapping."""
from datetime import datetime, timedelta, timezone

from app.routers.tickets import _build_sla_monitor, _map_ticket

raw = {
    "id": 123,
    "number": "8800123",
    "title": "SLA sample",
    "state": "open",
    "state_id": 2,
    "priority": {"name": "high"},
    "priority_id": 3,
    "group_id": 9,
    "group": {"name": "Support"},
    "owner_id": 7,
    "owner": {"name": "Agent One"},
    "customer_id": 5,
    "customer": {"name": "Customer One"},
    "created_at": "2026-08-12T00:00:00Z",
    "updated_at": "2026-08-12T01:00:00Z",
    "escalation_at": "2026-08-13T00:00:00Z",
    "first_response_at": "2026-08-12T00:30:00Z",
    "first_response_escalation_at": "2026-08-12T01:00:00Z",
    "first_response_in_min": 30,
    "first_response_diff_in_min": 30,
    "close_at": "2026-08-12T03:00:00Z",
    "close_escalation_at": "2026-08-12T02:00:00Z",
    "close_in_min": 180,
    "close_diff_in_min": -60,
    "update_escalation_at": "2026-08-12T01:30:00Z",
    "update_diff_in_min": 20,
}

ticket = _map_ticket(raw)
assert ticket.escalation_at is not None
assert ticket.first_response_at is not None
assert ticket.first_response_in_min == 30
assert ticket.close_diff_in_min == -60
assert ticket.priority_id == "3"
assert ticket.state_id == "2"
assert ticket.group_name == "Support"
assert ticket.owner_name == "Agent One"
assert ticket.first_response_breached is False
assert ticket.close_breached is True

breached_response = _map_ticket({
    **raw,
    "id": 124,
    "first_response_diff_in_min": -5,
})
assert breached_response.first_response_breached is True

timely_resolution = _map_ticket({
    **raw,
    "id": 125,
    "close_at": "2026-08-12T01:30:00Z",
    "close_diff_in_min": 30,
})
assert timely_resolution.close_breached is False

late_response = _map_ticket({
    **raw,
    "id": 126,
    "first_response_at": "2026-08-12T01:30:00Z",
    "first_response_diff_in_min": None,
})
assert late_response.first_response_breached is True

late_resolution = _map_ticket({
    **raw,
    "id": 127,
    "close_at": "2026-08-12T02:30:00Z",
    "close_diff_in_min": None,
})
assert late_resolution.close_breached is True

now = datetime.now(timezone.utc)
future_escalation = now + timedelta(hours=4)
mapped = _map_ticket({
    **raw,
    "id": 128,
    "created_at": (now - timedelta(hours=8)).isoformat(),
    "updated_at": now.isoformat(),
    "escalation_at": future_escalation.isoformat(),
    "first_response_at": (now - timedelta(hours=5)).isoformat(),
    "first_response_escalation_at": (now - timedelta(hours=6)).isoformat(),
    "first_response_diff_in_min": 60,
    "close_at": None,
    "close_escalation_at": (now + timedelta(hours=6)).isoformat(),
    "close_diff_in_min": None,
})
monitor_row = _build_sla_monitor([mapped], now)["tickets"][0]
assert mapped.first_response_breached is False
assert monitor_row["live_sla_status"] == "on_track"
assert monitor_row["actionable_deadline"] == future_escalation.isoformat()
print("SLA mapper OK")
