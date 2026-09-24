"""Check that Data freshness reaches the SLA surfaces for every role.

The reported bug hid behind a monitoring page that could not tell "no breaches"
from "no data": the dataset was frozen, and the SLA Monitor reported a verdict
computed from stale rows as though it were current. Freshness now rides on the
SLA Monitor response the page already fetches, so the page can degrade its
verdicts — and it does so for every role that may view them, without widening
the administrator-only settings endpoint.

Run from backend/: .venv/bin/python tests/run.py unit/test_sla_freshness.py
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import HTTPException

from app import freshness
from app.models import Role, TicketOut
from app.routers import tickets, settings

def ticket(id_: int, owner_id: str) -> TicketOut:
    now = datetime.now(timezone.utc)
    return TicketOut(
        id=str(id_),
        zammad_id=id_,
        number=str(id_),
        title=f"Ticket {id_}",
        state="open",
        priority="normal",
        group_id="g1",
        group_name="Group g1",
        owner_id=owner_id,
        owner_name=owner_id,
        customer_name="Customer",
        tags=[],
        escalation_at=now + timedelta(hours=4),
        first_response_breached=False,
        close_breached=False,
        reopen_count=0,
        first_reply_time_secs=None,
        resolution_time_secs=None,
        zammad_created_at=now - timedelta(hours=1),
        zammad_updated_at=now,
    )

async def main() -> None:
    values: dict[str, dict] = {}

    async def fake_get_setting(_db, key):
        return values.get(key)

    rows = [ticket(1, "a1"), ticket(2, "a2"), ticket(3, "a3")]

    async def fake_list_ticket_rows(_db):
        return rows

    async def fake_list_group_rows(_db):
        return [SimpleNamespace(id="g1", name="Group g1")]

    tickets.get_setting = fake_get_setting
    tickets.list_ticket_rows = fake_list_ticket_rows
    tickets.list_group_rows = fake_list_group_rows
    tickets._row_to_ticket = lambda row: row

    roles = {
        "admin": {"sub": "admin", "role": "admin", "group_ids": []},
        "team_lead": {"sub": "lead", "role": "team_lead", "group_ids": ["g1"]},
        "project_manager": {"sub": "pm", "role": "project_manager", "group_ids": ["g1"]},
        "agent": {"sub": "a1", "role": "agent", "group_ids": ["g1"]},
    }

    async def read_monitor(role: str):
        return await tickets.sla_monitor(current=roles[role], db=object(), group_id=None, priority=None)

    # The endpoint reads the real clock, so the check does too, with margins
    # far wider than any scheduling jitter. The exact boundary is pinned in
    # check_settings_freshness, where the clock is injected.
    real_now = datetime.now(timezone.utc)

    # Every role that can view the SLA surfaces receives Data freshness on the
    # same response, without a second call to an administrator-only endpoint.
    for role in roles:
        response = await read_monitor(role)
        assert "freshness" in response.data, f"{role} must receive Data freshness"
        assert response.data["freshness"]["status"] == "never_synced"

    # The classification is the same one the Settings surfaces use, so the two
    # can never disagree about whether the dataset is stale.
    values[freshness.LAST_SUCCESS_KEY] = {"value": real_now.isoformat()}
    for role in roles:
        response = await read_monitor(role)
        assert response.data["freshness"]["status"] == "up_to_date", role
        assert response.data["freshness"]["last_success_at"] == real_now.isoformat()

    values[freshness.LAST_SUCCESS_KEY] = {
        "value": (real_now - timedelta(seconds=freshness.DEFAULT_SCHEDULES["incremental_seconds"] + freshness.FRESHNESS_GRACE_SECONDS + 3600)).isoformat()
    }
    for role in roles:
        response = await read_monitor(role)
        assert response.data["freshness"]["status"] == "out_of_date", role

    # The verdicts themselves stay in the payload — the page degrades their
    # presentation; the API never fabricates a stale verdict as current by
    # silently emptying the figures.
    stale = await read_monitor("admin")
    assert stale.data["tickets"], "a stale dataset must still report its rows"
    assert stale.data["summary"]["total_active"] == 3
    assert stale.data["freshness"]["status"] == "out_of_date"

    # A watermark-only dataset (synced before the success checkpoint existed)
    # still reports freshness rather than Never Synced.
    values.pop(freshness.LAST_SUCCESS_KEY)
    values[freshness.SYNC_WATERMARK_KEY] = {"value": real_now.isoformat()}
    response = await read_monitor("admin")
    assert response.data["freshness"]["status"] == "up_to_date"
    assert response.data["freshness"]["checkpoint_source"] == "watermark"

    # The settings endpoint keeps its administrator-only gate: freshness
    # reached the SLA surfaces without widening it.
    status_route = next(route for route in settings.router.routes if route.path == "/status")
    gate = status_route.dependant.dependencies[0].call
    assert await gate({"sub": "admin", "role": Role.admin.value, "group_ids": []})
    try:
        await gate({"sub": "a1", "role": Role.agent.value, "group_ids": ["g1"]})
    except HTTPException as exc:
        assert exc.status_code == 403, exc.status_code
    else:
        raise AssertionError("the settings status endpoint must stay administrator-only")

    print("check_sla_freshness: OK")

if __name__ == "__main__":
    asyncio.run(main())
