"""Regression check: every ticket surface reports one live SLA verdict.

The reported bug was one ticket showing `Breached` on the SLA Monitor and
`On Track` on its detail page at the same moment, because the Monitor
recomputed a verdict while the detail page rendered the verdict stored at
last sync. The verdict is now derived at read time in the one serialization
seam every surface goes through, and the stored verdict is no longer exposed.
"""
from datetime import datetime, timedelta, timezone

from app.db_models import TicketRow
from app.routers.tickets import (
    _build_sla_monitor,
    _effective_sla_status,
    _row_to_ticket,
    _sla_remaining_ms,
    ticket_payload,
)

def row(id_: int, now: datetime, **overrides) -> TicketRow:
    data = {
        "id": str(id_),
        "zammad_id": id_,
        "number": str(id_),
        "title": f"Ticket {id_}",
        "state": "open",
        "priority": "normal",
        "priority_id": "",
        "state_id": "",
        "group_id": "g1",
        "group_name": "Support",
        "owner_id": None,
        "owner_name": None,
        "customer_name": "Customer",
        "tags": [],
        "sla_status": "safe",
        "escalation_at": now - timedelta(minutes=5),
        "first_response_remaining_secs": 999,
        "first_response_breached": False,
        "close_breached": False,
        "reopen_count": 0,
        "zammad_created_at": now - timedelta(hours=1),
        "zammad_updated_at": now,
    }
    data.update(overrides)
    return TicketRow(**data)

def main() -> None:
    now = datetime.now(timezone.utc)

    # One ticket, one verdict: the detail path and the SLA Monitor path must
    # agree on both the verdict and the countdown, sampled at the same instant.
    stale = _row_to_ticket(row(1, now))
    detail = ticket_payload(stale, now)
    monitor = _build_sla_monitor([stale], now)["tickets"][0]
    assert detail["live_sla_status"] == monitor["live_sla_status"] == "breached"
    assert detail["sla_remaining_ms"] == monitor["sla_remaining_ms"]
    assert "live_sla_status" in detail and "sla_remaining_ms" in detail
    assert "sla_status" not in detail and "first_response_remaining_secs" not in detail

    # The stored verdict is not an input: a row flagged breached at last sync
    # with a future deadline and no Zammad breach evidence is not breached.
    stale_breach = _row_to_ticket(row(2, now, sla_status="breached", escalation_at=now + timedelta(hours=4)))
    assert ticket_payload(stale_breach, now)["live_sla_status"] == "on_track"

    # A ticket closed late reports its real breach magnitude, not how long ago
    # the deadline passed.
    closed_at = now - timedelta(minutes=1)
    closed_late = _row_to_ticket(row(
        3,
        now,
        state="closed",
        close_at=closed_at,
        closed_at=closed_at,
        escalation_at=closed_at - timedelta(minutes=6),
        close_diff_in_min=-6,
    ))
    closed_payload = ticket_payload(closed_late, now)
    assert closed_payload["live_sla_status"] == "breached"
    assert closed_payload["close_diff_in_min"] == -6
    assert closed_payload["sla_remaining_ms"] == -6 * 60 * 1000, closed_payload["sla_remaining_ms"]
    assert _build_sla_monitor([closed_late], now)["breach_log"][0]["sla_remaining_ms"] == -6 * 60 * 1000

    # A resolved ticket with no milestone evidence still reports its lateness
    # from the deadline it missed, and never a live countdown.
    no_evidence = _row_to_ticket(row(
        5,
        now,
        state="closed",
        close_at=now,
        closed_at=now,
        escalation_at=now - timedelta(hours=3),
    ))
    assert ticket_payload(no_evidence, now)["sla_remaining_ms"] == -3 * 60 * 60 * 1000

    # A cache hit must not serve a stale countdown: the detail path re-derives
    # the live fields from the cached row facts.
    cached_row = _row_to_ticket(row(1, now))
    refreshed = ticket_payload(cached_row, now)
    assert refreshed["live_sla_status"] == "breached"
    assert refreshed["sla_remaining_ms"] is not None

    # Unmonitored stays distinct from breached.
    unmonitored = _row_to_ticket(row(4, now, escalation_at=None))
    assert ticket_payload(unmonitored, now)["live_sla_status"] == "no_sla"
    assert ticket_payload(unmonitored, now)["sla_remaining_ms"] is None

    # At-Risk lists active tickets with a deadline still ahead, nearest first.
    # A resolved ticket's large negative remaining must not crowd them out.
    at_risk_rows = [
        _row_to_ticket(row(6, now, escalation_at=now + timedelta(hours=5))),
        _row_to_ticket(row(7, now, escalation_at=now + timedelta(minutes=20))),
        _row_to_ticket(row(8, now, escalation_at=now + timedelta(minutes=90))),
        _row_to_ticket(row(9, now, state="closed", close_at=now, closed_at=now,
                          escalation_at=now - timedelta(days=30), close_diff_in_min=-43200)),
    ]
    ranked = sorted(
        (t for t in at_risk_rows if t.state in ("new", "open", "pending")
         and _effective_sla_status(t, now) in ("warning", "critical", "breached")),
        key=lambda t: _sla_remaining_ms(t, now),
    )
    assert [t.id for t in ranked] == ["7", "8"], [t.id for t in ranked]

    print("check_live_sla: OK")

if __name__ == "__main__":
    main()
