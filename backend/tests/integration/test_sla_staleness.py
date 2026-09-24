#!/usr/bin/env python
"""Runnable regression check: the synchronized dataset has no silent staleness.

The reported bug hid behind a monitoring page that could not tell "no breaches"
from "no data": an Incremental Sync returned zero tickets on every run while
reporting success, so the rows were never refreshed with Zammad's newer facts
and every SLA verdict was computed from a frozen dataset. Nothing asserted
whether the *data* was current, so the stall was only found by a user clicking
through two pages.

Three bounds, each catching a different way the dataset goes stale:

1. **Freshness** — the dataset's checkpoint must be within its promised cadence
   plus grace, so a stalled sync is Out of Date rather than silently "fine".
2. **No row left behind Zammad** — sampled synced rows must carry Zammad's own
   `updated_at`. A row whose facts differ from Zammad's, by more than one sync
   window, is the "left behind" ticket: stale data presented as current, which
   is exactly what the reported ticket was.
3. **A productive sync window** — a run that reports success while fetching
   nothing is the reported stall, but only once rows are corroborated behind
   (a quiet Zammad legitimately has nothing changed in five minutes).

It also re-verifies the reported ticket's one-verdict-per-ticket property
against real rows: the detail path and the SLA Monitor agree on verdict and
countdown, a closed ticket is not active, and its breach evidence states the
real magnitude.

Run inside the api container (needs live DB + Zammad), after any Full Reconcile:
python tests/run.py integration/test_sla_staleness.py

Exit status is non-zero when a bound is violated, so a future silent stall fails
this check rather than being discovered by a user.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import freshness
from app.config import settings
from app.db_models import TicketRow
from app.repositories import get_setting
from app.routers.tickets import _build_sla_monitor, _row_to_ticket, ticket_payload
from app.zammad_client import zammad

# The ticket whose two-page contradiction was reported. Its verdict and
# countdown must agree across surfaces, a closed ticket must not read as
# active, and it must match Zammad.
REPORTED_TICKET_NUMBER = "20260914410002"

# How many synced rows to compare against Zammad. Every Zammad read costs one
# HTTP call, so this is a sample rather than the whole dataset.
SAMPLE_SIZE = 25

# Successful runs are recorded as "succeeded" by the managed path and "ok" by
# the standalone runner; both mean the same thing here.
SUCCESS_STATUSES = ("ok", "succeeded")

def parse_iso(value) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)

def same_instant(left: datetime | None, right: datetime | None) -> bool:
    if left is None or right is None:
        return left is None and right is None
    return abs((left - right).total_seconds()) < 1

def row_is_behind(row: TicketRow, zammad_updated: datetime | None, opportunity_at: datetime | None, window_seconds: int, now: datetime) -> bool:
    """Whether a synced row truly lags Zammad, not merely a change in flight.

    A ticket that changed within the last sync window may legitimately not be
    picked up yet — the next run's overlap window covers it. A row is only *left
    behind* when two things hold: the change is older than the sync window, and a
    run has actually completed since the change. The second condition is what
    keeps the check honest while the beat has skipped a run or a reconcile is
    still in flight — the watermark is deliberately held back at those moments,
    so nothing is lost, only not yet fetched.
    """
    if same_instant(parse_iso(row.zammad_updated_at), zammad_updated):
        return False
    if zammad_updated is None:
        return False
    if (now - zammad_updated).total_seconds() <= window_seconds:
        return False
    return opportunity_at is not None and opportunity_at > zammad_updated

async def sample_rows(session) -> list[TicketRow]:
    """A deterministic spread across the whole dataset, not just its newest rows.

    Sampling by `zammad_updated_at` descending would select exactly the rows the
    database already believes are current, systematically excluding the stale
    ones this check exists to find. Rows are picked at evenly spaced positions
    across the full ordered range — both ends included — so a stale cluster at
    either end is reachable and the last remainder is not silently dropped.
    """
    total = (await session.execute(select(func.count()).select_from(TicketRow))).scalar() or 0
    if total == 0:
        return []
    if total <= SAMPLE_SIZE:
        offsets = range(total)
    else:
        offsets = sorted({round(i * (total - 1) / (SAMPLE_SIZE - 1)) for i in range(SAMPLE_SIZE)})
    rows = []
    for offset in offsets:
        row = (await session.execute(
            select(TicketRow).order_by(TicketRow.zammad_id).offset(offset).limit(1)
        )).scalar_one_or_none()
        if row is not None:
            rows.append(row)
    return rows

async def check_freshness(session) -> bool:
    data = await freshness.dataset_freshness(session, datetime.now(timezone.utc), get_setting)
    print(f"[check_sla_staleness] dataset freshness: {data['status']} (last_success_at={data['last_success_at']})")
    if data["status"] != "up_to_date":
        print("[check_sla_staleness] FAIL: the dataset is not Up to Date; one Full Reconcile must bring it current")
        return False
    return True

async def check_sync_window(session, rows_behind: bool) -> bool:
    """A run that reports success while fetching nothing is the reported stall.

    A zero-ticket incremental run is not a failure on its own — a quiet Zammad
    legitimately has nothing changed in five minutes. It is only the signature
    of the bug when the dataset also shows rows left behind Zammad, so the
    zero-fetch signal is corroborated by the row comparison rather than asserted
    blindly. A run still in flight is not evidence of a stall either; the
    freshness bound above is what covers a dataset that is not current.
    """
    last_run = await get_setting(session, "sync:last_run") or {}
    status = last_run.get("status")
    tickets = last_run.get("tickets")
    print(f"[check_sla_staleness] last sync run: kind={last_run.get('kind')} status={status} tickets={tickets}")
    if status in ("queued", "running"):
        print("[check_sla_staleness] a sync run is in flight; the freshness bound covers the dataset")
        return True
    if status not in SUCCESS_STATUSES:
        print("[check_sla_staleness] FAIL: the latest sync run did not succeed")
        return False
    if rows_behind and last_run.get("kind") == "incremental" and not tickets:
        print("[check_sla_staleness] FAIL: rows are behind Zammad and the last incremental run fetched zero tickets")
        return False
    return True

async def check_rows_match_zammad(session, now: datetime, window_seconds: int, opportunity_at: datetime | None) -> tuple[bool, bool]:
    """Return (ok, any_row_behind), so the sync-window bound can corroborate."""
    rows = await sample_rows(session)
    if not rows:
        print("[check_sla_staleness] FAIL: the dataset is empty")
        return False, True

    behind: list[str] = []
    for row in rows:
        raw = await zammad.get_ticket(row.zammad_id)
        zammad_updated = parse_iso(raw.get("updated_at"))
        if row_is_behind(row, zammad_updated, opportunity_at, window_seconds, now):
            behind.append(f"{row.number} (synced {row.zammad_updated_at}, Zammad {zammad_updated})")

    print(f"[check_sla_staleness] sampled {len(rows)} rows across the dataset; {len(behind)} left behind")
    if behind:
        print("[check_sla_staleness] FAIL: synced rows carry facts older than Zammad's:")
        for item in behind[:5]:
            print(f"  - {item}")
        return False, True
    return True, False

async def check_one_verdict_per_ticket(session, now: datetime) -> bool:
    reported = (
        await session.execute(select(TicketRow).where(TicketRow.number == REPORTED_TICKET_NUMBER))
    ).scalar_one_or_none()
    if reported is None:
        print(f"[check_sla_staleness] FAIL: the reported ticket {REPORTED_TICKET_NUMBER} is not in the dataset")
        return False

    # The verdict comparison needs the tickets whose verdict is actually live —
    # active rows. A closed ticket has no countdown and is skipped, so sampling
    # the dataset by id would compare nothing on a resolved-dominated dataset
    # (2355 of 2366 here). Active rows are few, so take them all; the reported
    # closed row rides along so the monitor's breach-log branch is exercised.
    active = (await session.execute(
        select(TicketRow).where(TicketRow.state.in_(("new", "open", "pending"))).order_by(TicketRow.zammad_id)
    )).scalars().all()
    rows = [*active, reported]
    sample = [_row_to_ticket(row) for row in {row.id: row for row in rows}.values()]

    monitor = _build_sla_monitor(sample, now, groups=[("all", "All")])
    monitor_by_id = {t["id"]: t for t in monitor["tickets"]}

    # One verdict per ticket, against live rows rather than a fixture: the
    # detail serialization and the SLA Monitor must agree on both the verdict
    # and the countdown for the same instant.
    compared = 0
    for ticket in sample:
        if ticket.state in ("closed", "merged"):
            continue
        detail = ticket_payload(ticket, now)
        on_monitor = monitor_by_id.get(ticket.id)
        assert on_monitor is not None, f"{ticket.number} is active but missing from the SLA Monitor"
        assert detail["live_sla_status"] == on_monitor["live_sla_status"], ticket.id
        assert detail["sla_remaining_ms"] == on_monitor["sla_remaining_ms"], ticket.id
        compared += 1
    assert compared > 0, "no active ticket was compared; the check cannot pass vacuously"

    ticket = _row_to_ticket(reported)
    detail = ticket_payload(ticket, now)
    print(
        f"[check_sla_staleness] reported {REPORTED_TICKET_NUMBER}: state={ticket.state} "
        f"verdict={detail['live_sla_status']} remaining_ms={detail['sla_remaining_ms']}"
    )
    if ticket.state not in ("closed", "merged"):
        print(f"[check_sla_staleness] FAIL: the reported ticket is {ticket.state}, not resolved")
        return False

    monitor_ids = {t["id"] for t in monitor["tickets"]}
    assert ticket.id not in monitor_ids, f"{REPORTED_TICKET_NUMBER} is {ticket.state} but still reads as active"
    assert detail["sla_remaining_ms"] is not None, f"{REPORTED_TICKET_NUMBER} must state its real breach magnitude"
    assert detail["sla_remaining_ms"] < 0, f"{REPORTED_TICKET_NUMBER} resolved late but reports a countdown, not a breach"
    breach_log = {t["id"]: t for t in monitor["breach_log"]}
    assert ticket.id in breach_log, f"{REPORTED_TICKET_NUMBER} must appear in the breach log"
    assert breach_log[ticket.id]["sla_remaining_ms"] == detail["sla_remaining_ms"], "breach evidence must match the detail page"
    return True

async def main() -> None:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    now = datetime.now(timezone.utc)

    ok = True
    async with session_factory() as session:
        schedules = await get_setting(session, freshness.SCHEDULES_KEY) or freshness.DEFAULT_SCHEDULES
        window_seconds = int(schedules.get("incremental_seconds", freshness.DEFAULT_SCHEDULES["incremental_seconds"])) + freshness.FRESHNESS_GRACE_SECONDS
        last_run = await get_setting(session, "sync:last_run") or {}
        opportunity_at = parse_iso(last_run.get("finished_at")) if last_run.get("status") in SUCCESS_STATUSES else None
        ok &= await check_freshness(session)
        rows_ok, rows_behind = await check_rows_match_zammad(session, now, window_seconds, opportunity_at)
        ok &= rows_ok
        ok &= await check_sync_window(session, rows_behind)
        if ok:
            ok &= await check_one_verdict_per_ticket(session, now)

    await engine.dispose()
    if not ok:
        sys.exit(1)
    print("[check_sla_staleness] OK")

if __name__ == "__main__":
    asyncio.run(main())
