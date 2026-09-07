"""Repro/regression harness for the two reported Overview bugs.

Expected semantics (per product decision):
- Chart "Open" bucket = tickets CREATED in that bucket (zammad_created_at), same
  bucketing as created/closed. NOT cumulative overlap of open intervals.
- Open tab = tickets whose CURRENT state is exactly "open" (within the selected
  period window scope). A ticket created in the window but now closed/pending
  does NOT appear. Chart and tab intentionally differ: chart shows per-period
  creations, tab shows currently-open tickets.

Bug 1 (chart): open counted via historical interval overlap -> inflated vs closed.
Bug 2 (tab):   open tab empty because currently-open tickets' created/closed/updated
               timestamps fell outside the narrow window; fixed by scoping the tab
               to current state within the window rather than interval overlap.

Run: python check_overview_bugs.py  (inside api container or backend venv)
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.models import TicketOut
from app.routers import tickets as tickets_router

UTC = timezone.utc
MON = datetime(2024, 1, 8, tzinfo=UTC)  # 2024-W02 Mon..Sun
DAYS = [MON + timedelta(days=i) for i in range(7)]
WEEK = "2024-W02"


def make_ticket(id_: int, state: str, created: datetime, updated: datetime, closed: datetime | None = None) -> TicketOut:
    return TicketOut(
        id=str(id_), zammad_id=id_, number=str(id_), title=f"Ticket {id_}", state=state,
        priority="normal", group_id="1", group_name="Support", owner_id=None, owner_name=None,
        customer_name="Customer", tags=[], sla_status="safe",
        first_response_remaining_secs=None, first_response_breached=False, close_breached=False,
        reopen_count=0, first_reply_time_secs=None, resolution_time_secs=None,
        zammad_created_at=created, zammad_updated_at=updated, closed_at=closed,
    )


# In-window created Monday, still open -> chart open on Mon, in open tab.
T_IN_OPEN = make_ticket(1, "open", DAYS[0] + timedelta(hours=9), DAYS[0] + timedelta(hours=9))
# In-window created Tuesday, now closed -> chart open on Tue (created then), NOT in open tab.
T_IN_CLOSED = make_ticket(2, "closed", DAYS[1] + timedelta(hours=9), DAYS[2] + timedelta(hours=9), closed=DAYS[2] + timedelta(hours=9))
# Created BEFORE window, still open -> NOT in chart (created outside), NOT in open tab (created outside window).
T_PRE_OPEN = make_ticket(3, "open", MON - timedelta(days=10), MON - timedelta(days=1))
# In-window created Wednesday, now pending -> chart open Wed, not in open tab.
T_IN_PENDING = make_ticket(4, "pending", DAYS[2] + timedelta(hours=9), DAYS[3] + timedelta(hours=9))

TICKETS = [T_IN_OPEN, T_IN_CLOSED, T_PRE_OPEN, T_IN_PENDING]


async def call(tab=None):
    return await tickets_router.overview(
        current={"sub": "1", "role": "admin", "group_ids": []},
        db=object(), period="week", year=2024, week=WEEK, tab=tab, page=1, per_page=20,
    )


async def main() -> None:
    async def fake_fetch_scoped(_c, _d, **_k):
        return list(TICKETS)

    async def fake_state_history(_d):
        return []

    tickets_router._fetch_scoped = fake_fetch_scoped
    tickets_router.get_state_history = fake_state_history

    res = (await call()).data
    open_buckets = [p["open"] for p in res["chart"]]
    created_buckets = [p["created"] for p in res["chart"]]
    # Open chart == created chart: tickets created Mon/Tue/Wed -> [1,1,1,0,0,0,0].
    assert open_buckets == created_buckets == [1, 1, 1, 0, 0, 0, 0], (
        f"BUG1: open buckets {open_buckets} != created buckets {created_buckets} (expected [1,1,1,0,0,0,0])"
    )

    res = (await call(tab="open")).data
    ids = sorted(t["id"] for t in res["tickets"])
    # Open tab: CURRENT state open, within window scope -> only ticket 1.
    # (2=closed, 4=pending excluded by state; 3 created before window excluded by scope.)
    assert ids == ["1"], f"BUG2: open tab ids {ids} != ['1'] (total={res['total']})"

    print("check_overview_bugs: OK")


if __name__ == "__main__":
    asyncio.run(main())
