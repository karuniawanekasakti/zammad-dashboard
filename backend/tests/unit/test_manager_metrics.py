"""Runnable regression check for manager-period metric rollups."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.routers.tickets import _manager_metrics

NOW = datetime(2026, 9, 22, tzinfo=timezone.utc)


def ticket(*, state: str, closed_days_ago: int | None = None, breached: bool = False):
    closed_at = NOW - timedelta(days=closed_days_ago) if closed_days_ago is not None else None
    deadline = NOW - timedelta(days=1) if breached else NOW + timedelta(days=1)
    return SimpleNamespace(
        state=state,
        close_at=closed_at,
        closed_at=closed_at,
        zammad_created_at=deadline - timedelta(hours=3),
        escalation_at=deadline,
        first_response_escalation_at=None,
        update_escalation_at=None,
        close_escalation_at=None,
        first_response_diff_in_min=-1 if breached else 1,
        update_diff_in_min=None,
        close_diff_in_min=None,
        first_response_breached=False,
        update_breached=False,
        close_breached=breached,
    )


rows = [
    ticket(state="open", breached=True),
    ticket(state="closed", closed_days_ago=2, breached=True),
    ticket(state="closed", closed_days_ago=3),
    ticket(state="closed", closed_days_ago=10),
]
week = _manager_metrics(rows, NOW, "week")
assert week["active_breaches"] == 1
assert week["compliance_rate"] == 50
assert week["trend_percentage"] == -50
assert week["average_breach_time_minutes"] == 180
print("Manager period metrics OK")
