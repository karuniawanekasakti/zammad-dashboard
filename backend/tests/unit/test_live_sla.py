"""Regression check: every ticket surface reports one live SLA verdict.

The reported bug was one ticket showing `Breached` on the SLA Monitor and
`On Track` on its detail page at the same moment, because the Monitor
recomputed a verdict while the detail page rendered the verdict stored at
last sync. The verdict is now derived at read time in the one serialization
seam every surface goes through, and the stored verdict is gone from the
synchronized store entirely — so no stale verdict is available to read by
accident.
"""
from datetime import datetime, timedelta, timezone

from app.db_models import TicketRow
from app.models import TicketOut
from app.routers.tickets import (
    _build_sla_monitor,
    _effective_sla_status,
    _map_ticket,
    _row_to_ticket,
    _sla_remaining_ms,
    ticket_payload,
)

STORED_DERIVED_FIELDS = ("sla_status", "first_response_remaining_secs")

# Zammad's own SLA facts, which are evidence rather than verdicts and must
# survive on a synced row: the live computation reads every one of them.
RETAINED_SLA_FACTS = (
    "escalation_at",
    "first_response_at",
    "first_response_escalation_at",
    "first_response_in_min",
    "first_response_diff_in_min",
    "close_at",
    "close_escalation_at",
    "close_in_min",
    "close_diff_in_min",
    "update_escalation_at",
    "update_diff_in_min",
    "first_response_breached",
    "close_breached",
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
        "escalation_at": now - timedelta(minutes=5),
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

    # The stored verdict columns are gone from both the row model and the API
    # schema, so no reader anywhere can depend on them.
    for field in STORED_DERIVED_FIELDS:
        assert field not in TicketRow.__table__.columns, field
        assert field not in TicketOut.model_fields, field
        assert field not in detail, field
        assert field not in ticket_payload(stale, now), field

    # A verdict-shaped value on the incoming Zammad payload is ignored: the
    # write path no longer supplies either derived field, so even a payload
    # carrying them cannot reintroduce a stored verdict.
    mapped = _map_ticket({
        "id": 999,
        "escalation_at": (now + timedelta(hours=4)).isoformat(),
        "sla_status": "breached",
        "first_response_remaining_secs": -12345,
    })
    for field in STORED_DERIVED_FIELDS:
        assert field not in mapped.model_dump(), field
    assert ticket_payload(mapped, now)["live_sla_status"] == "on_track"

    # A synced ticket still carries every Zammad SLA fact the live
    # computation reads; only the derived verdict and countdown were dropped.
    mapped_facts = _map_ticket({
        "id": 998,
        "escalation_at": (now + timedelta(hours=4)).isoformat(),
        "first_response_at": (now - timedelta(hours=3)).isoformat(),
        "first_response_escalation_at": (now - timedelta(hours=4)).isoformat(),
        "first_response_in_min": 60,
        "first_response_diff_in_min": 60,
        "close_at": (now - timedelta(hours=1)).isoformat(),
        "close_escalation_at": (now + timedelta(hours=2)).isoformat(),
        "close_in_min": 180,
        "close_diff_in_min": 120,
        "update_escalation_at": (now + timedelta(hours=1)).isoformat(),
        "update_diff_in_min": 30,
    })
    dumped = mapped_facts.model_dump()
    for field in RETAINED_SLA_FACTS:
        assert field in dumped and dumped[field] is not None, field
    assert dumped["first_response_breached"] is False
    assert dumped["close_breached"] is False

    # The retained facts are enough to compute the live verdict on read.
    assert ticket_payload(mapped_facts, now)["live_sla_status"] == "on_track"

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
