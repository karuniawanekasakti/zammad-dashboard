"""Check the ticket list's default sort (updated desc) via the router seam.

Fabricates three TicketOut rows, monkeypatches the router's scoped fetch,
calls list_tickets directly, and asserts the default sort order (most
recently updated first).

Run inside the api container or the backend venv: python check_ticket_sorting.py
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from app.models import TicketOut
from app.routers import tickets


def make_ticket(id_: int, state: str, updated_at: datetime) -> TicketOut:
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
        reopen_count=0,
        first_reply_time_secs=None,
        resolution_time_secs=None,
        zammad_created_at=updated_at - timedelta(days=1),
        zammad_updated_at=updated_at,
    )


async def main() -> None:
    now = datetime.now(timezone.utc)
    rows = [
        make_ticket(1, "closed", now - timedelta(days=120)),
        make_ticket(2, "pending", now - timedelta(minutes=21)),
        make_ticket(3, "open", now - timedelta(hours=2)),
    ]

    async def fake_fetch_scoped(_current, _db, **_kwargs):
        return list(rows)

    tickets._fetch_scoped = fake_fetch_scoped

    res = await tickets.list_tickets(current={"sub": "1", "role": "admin", "group_ids": []}, db=object(), page=1, per_page=1)
    assert res.meta["total"] == 3
    assert res.data[0]["id"] == "2", f"expected ticket 2 first (newest update), got {res.data[0]['id']}"

    print("check_ticket_sorting: OK")


if __name__ == "__main__":
    asyncio.run(main())
