"""Check SLA monitor authorization and group filtering at the router seam.

Run inside the api container or backend venv: python check_sla_scope.py
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.models import TicketOut
from app.routers import tickets


def ticket(id_: int, group_id: str, owner_id: str) -> TicketOut:
    now = datetime.now(timezone.utc)
    return TicketOut(
        id=str(id_),
        zammad_id=id_,
        number=str(id_),
        title=f"Ticket {id_}",
        state="open",
        priority="normal",
        group_id=group_id,
        group_name=f"Group {group_id}",
        owner_id=owner_id,
        owner_name=owner_id,
        customer_name="Customer",
        tags=[],
        sla_status="safe",
        escalation_at=now + timedelta(hours=4),
        first_response_remaining_secs=None,
        first_response_breached=False,
        close_breached=False,
        reopen_count=0,
        first_reply_time_secs=None,
        resolution_time_secs=None,
        zammad_created_at=now - timedelta(hours=1),
        zammad_updated_at=now,
    )


async def main() -> None:
    rows = [ticket(1, "g1", "a1"), ticket(2, "g1", "a2"), ticket(3, "g2", "a3")]

    async def fake_list_ticket_rows(_db):
        return rows

    async def fake_list_group_rows(_db):
        return [SimpleNamespace(id="g1", name="Group g1"), SimpleNamespace(id="g2", name="Group g2")]

    tickets.list_ticket_rows = fake_list_ticket_rows
    tickets.list_group_rows = fake_list_group_rows
    tickets._row_to_ticket = lambda row: row

    roles = {
        "admin": {"sub": "admin", "role": "admin", "group_ids": []},
        "team_lead": {"sub": "lead", "role": "team_lead", "group_ids": ["g1"]},
        "project_manager": {"sub": "pm", "role": "project_manager", "group_ids": ["g1"]},
        "agent": {"sub": "a1", "role": "agent", "group_ids": ["g1", "g2"]},
    }

    expected_all = {
        "admin": {"1", "2", "3"},
        "team_lead": {"1", "2"},
        "project_manager": {"1", "2"},
        "agent": {"1"},
    }
    for role, current in roles.items():
        for group_id in (None, "all"):
            response = await tickets.sla_monitor(current=current, db=object(), group_id=group_id, priority=None)
            assert {row["id"] for row in response.data["tickets"]} == expected_all[role]

    for role in ("team_lead", "project_manager"):
        allowed = await tickets.sla_monitor(current=roles[role], db=object(), group_id="g1", priority=None)
        denied = await tickets.sla_monitor(current=roles[role], db=object(), group_id="g2", priority=None)
        assert {row["id"] for row in allowed.data["tickets"]} == {"1", "2"}
        assert denied.data["tickets"] == []

    agent_allowed = await tickets.sla_monitor(current=roles["agent"], db=object(), group_id="g1", priority=None)
    agent_denied = await tickets.sla_monitor(current=roles["agent"], db=object(), group_id="g2", priority=None)
    assert {row["id"] for row in agent_allowed.data["tickets"]} == {"1"}
    assert agent_denied.data["tickets"] == []
    assert [(row["id"], row["name"]) for row in agent_allowed.data["sla_rows"]] == [("g1", "Group g1")]

    composed = await tickets.sla_monitor(current=roles["admin"], db=object(), group_id="g1", priority="normal")
    assert {row["id"] for row in composed.data["tickets"]} == {"1", "2"}
    empty_priority = await tickets.sla_monitor(current=roles["admin"], db=object(), group_id="g1", priority="high")
    assert empty_priority.data["tickets"] == []

    print("check_sla_scope: OK")


if __name__ == "__main__":
    asyncio.run(main())
