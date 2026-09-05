"""External-behavior check for the Overview endpoint's Open/Reopened semantics.

Fabricates 4 tickets over one known week (Mon..Sun) plus their state-history
rows, monkeypatches the router's scoped fetch and history fetch, calls the
endpoint directly, and asserts on the response only (chart buckets, totals,
filtered row sets, injected timestamps).

Run inside the api container or the backend venv: python check_overview_open.py
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.models import TicketOut
from app.routers import tickets as tickets_router

UTC = timezone.utc
# A fully past ISO week: Jan 8-14 2024, Mon..Sun.
MON = datetime(2024, 1, 8, tzinfo=UTC)
DAYS = [MON + timedelta(days=i) for i in range(7)]
WEEK = "2024-W02"


def make_ticket(id_: int, state: str, created: datetime, updated: datetime, closed: datetime | None = None, reopen_count: int = 0) -> TicketOut:
    return TicketOut(
        id=str(id_),
        zammad_id=id_,
        number=str(id_),
        title=f"Ticket {id_}",
        state=state,
        priority="normal",
        group_id="1",
        group_name="Support",
        owner_id=None,
        owner_name=None,
        customer_name="Customer",
        tags=[],
        sla_status="safe",
        first_response_remaining_secs=None,
        first_response_breached=False,
        close_breached=False,
        reopen_count=reopen_count,
        first_reply_time_secs=None,
        resolution_time_secs=None,
        zammad_created_at=created,
        zammad_updated_at=updated,
        closed_at=closed,
    )


def hist(id_: int, ticket_id: int, value_from: str | None, value_to: str, at: datetime):
    return SimpleNamespace(id=str(id_), ticket_id=str(ticket_id), attribute="state", value_from=value_from, value_to=value_to, created_at=at)


# (a) open Mon 09:00 -> Wed 09:00, then closed (history). Created before the window.
TICKET_A = make_ticket(1, "closed", MON - timedelta(days=3), DAYS[2] + timedelta(hours=9), closed=DAYS[2] + timedelta(hours=9))
# (b) open Mon 10:00 -> Tue 10:00, closed; reopened Sat 09:00, closed again Sat 21:00,
#     reopened once more Sat 22:00 and currently open: two distinct intervals inside
#     the Saturday bucket must still count the ticket once there.
TICKET_B = make_ticket(2, "open", MON - timedelta(days=2), DAYS[5] + timedelta(hours=22), reopen_count=2)
# (c) new with no history: never open.
TICKET_C = make_ticket(3, "new", DAYS[1] + timedelta(hours=8), DAYS[1] + timedelta(hours=8))
# (d) pending with no history: fallback approximation (creation -> last update).
TICKET_D = make_ticket(4, "pending", DAYS[2] + timedelta(hours=8), DAYS[4] + timedelta(hours=8))
# (e) created directly in open (Zammad omits the creation transition): the first
#     history row is open -> pending, so the leading open interval is synthesized
#     from the row's value_from, starting at ticket creation.
TICKET_E = make_ticket(5, "pending", DAYS[0] + timedelta(hours=7), DAYS[3] + timedelta(hours=9))

HISTORY = [
    hist(1, 1, "new", "open", DAYS[0] + timedelta(hours=9)),
    hist(2, 1, "open", "closed", DAYS[2] + timedelta(hours=9)),
    hist(3, 2, "new", "open", DAYS[0] + timedelta(hours=10)),
    hist(4, 2, "open", "closed", DAYS[1] + timedelta(hours=10)),
    hist(5, 2, "closed", "open", DAYS[5] + timedelta(hours=9)),
    hist(6, 2, "open", "closed", DAYS[5] + timedelta(hours=21)),
    hist(7, 2, "closed", "open", DAYS[5] + timedelta(hours=22)),
    hist(8, 5, "open", "pending", DAYS[3] + timedelta(hours=9)),
]

TICKETS = [TICKET_A, TICKET_B, TICKET_C, TICKET_D, TICKET_E]

# (a) spans Mon-Wed; (b) Mon-Tue + Sat-now (Sat counted once despite two intervals);
# (d) fallback Wed-Fri; (e) synthesized interval Mon(creation)-Thu.
EXPECTED_OPEN = [3, 3, 3, 2, 1, 1, 1]
EXPECTED_REOPENED = [0, 0, 0, 0, 0, 2, 0]


async def call(tab=None, page=1):
    return await tickets_router.overview(
        current={"sub": "1", "role": "admin", "group_ids": []},
        db=object(),
        period="week",
        year=2024,
        week=WEEK,
        tab=tab,
        page=page,
        per_page=20,
    )


async def main() -> None:
    async def fake_fetch_scoped(_current, _db, **_kwargs):
        return list(TICKETS)

    async def fake_state_history(_db):
        return list(HISTORY)

    tickets_router._fetch_scoped = fake_fetch_scoped
    tickets_router.get_state_history = fake_state_history

    res = (await call()).data
    open_counts = [point["open"] for point in res["chart"]]
    reopened_counts = [point["reopened"] for point in res["chart"]]
    assert open_counts == EXPECTED_OPEN, f"open buckets {open_counts} != {EXPECTED_OPEN}"
    assert reopened_counts == EXPECTED_REOPENED, f"reopened buckets {reopened_counts} != {EXPECTED_REOPENED}"
    assert res["totals"]["open"] == 4, f"totals.open {res['totals']['open']} != 4"
    assert res["totals"]["reopened"] == 2, f"totals.reopened {res['totals']['reopened']} != 2"
    assert res["total"] == 5

    # tab=open: only the currently-open ticket (b), with last_open_at = Saturday 22:00.
    # Past-open-but-now-closed (a) and now-pending (e) tickets are excluded.
    res = (await call(tab="open")).data
    assert res["total"] == 1, f"open tab total {res['total']} != 1"
    assert res["tickets"][0]["id"] == "2"
    last_open = datetime.fromisoformat(res["tickets"][0]["last_open_at"])
    assert last_open == DAYS[5] + timedelta(hours=22), f"last_open_at {last_open} != Saturday 22:00"

    # tab=reopened: only ticket (b), with last_reopen_at = Saturday 22:00.
    res = (await call(tab="reopened")).data
    assert res["total"] == 1, f"reopened tab total {res['total']} != 1"
    assert res["tickets"][0]["id"] == "2"
    last_reopen = datetime.fromisoformat(res["tickets"][0]["last_reopen_at"])
    assert last_reopen == DAYS[5] + timedelta(hours=22), f"last_reopen_at {last_reopen} != Saturday 22:00"

    # tab=closed: ticket (a) only (closed in-window).
    res = (await call(tab="closed")).data
    assert [t["id"] for t in res["tickets"]] == ["1"], f"closed tab ids {[t['id'] for t in res['tickets']]}"

    print("check_overview_open: OK")


if __name__ == "__main__":
    asyncio.run(main())
