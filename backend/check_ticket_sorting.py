from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from app.routers import tickets


def raw_ticket(id_: int, state: str, updated_at: datetime) -> dict:
    return {
        "id": id_,
        "number": str(id_),
        "title": f"Ticket {id_}",
        "state": state,
        "priority": "normal",
        "group_id": 1,
        "owner_id": None,
        "customer_id": 1,
        "created_at": (updated_at - timedelta(days=1)).isoformat(),
        "updated_at": updated_at.isoformat(),
    }


async def main() -> None:
    now = datetime.now(timezone.utc)
    rows = [
        raw_ticket(1, "closed", now - timedelta(days=120)),
        raw_ticket(2, "pending", now - timedelta(minutes=21)),
        raw_ticket(3, "open", now - timedelta(hours=2)),
    ]

    async def miss(_key: str):
        return None

    async def noop(*_args, **_kwargs):
        return None

    class FakeZammad:
        async def get_all_tickets(self, per_page: int = 100):
            return rows

    tickets.cache_get = miss
    tickets.cache_set = noop
    tickets.upsert_tickets = noop
    tickets.zammad = FakeZammad()

    res = await tickets.list_tickets(current={"sub": "1", "role": "admin", "group_ids": []}, db=object(), page=1, per_page=1)
    assert res.meta["total"] == 3
    assert res.data[0]["id"] == "2"


if __name__ == "__main__":
    asyncio.run(main())
