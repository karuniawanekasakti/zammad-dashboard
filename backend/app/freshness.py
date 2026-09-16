"""Data freshness: whether the synchronized dataset has a successful checkpoint
within its promised cadence.

One definition of *Never Synced* / *Up to Date* / *Out of Date*, shared by the
administrator Settings surfaces and the role-agnostic SLA surfaces, so the two
can never disagree about whether the dataset is stale.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

SCHEDULES_KEY = "sync:schedules"
LAST_SUCCESS_KEY = "sync:last_successful_checkpoint"
SYNC_WATERMARK_KEY = "sync:last_ticket_updated_at"
FRESHNESS_GRACE_SECONDS = 120

DEFAULT_SCHEDULES = {"incremental_seconds": 300, "full_reconcile_seconds": 21600}

# `get_setting(db, key)` is passed in rather than imported so each caller's
# module-level reader stays the one under test — the existing self-checks
# patch `settings.get_setting`, and a second import would bypass that seam.
SettingsReader = Callable[[AsyncSession, str], Awaitable[dict | None]]


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)


def freshness(checkpoint: datetime | None, schedules: dict, now: datetime, checkpoint_source: str | None) -> dict:
    """Classify the dataset against its promised cadence plus a grace period."""
    if checkpoint is None:
        return {"status": "never_synced", "last_success_at": None, "checkpoint_source": None}
    stale_after = checkpoint + timedelta(seconds=int(schedules.get("incremental_seconds", DEFAULT_SCHEDULES["incremental_seconds"])) + FRESHNESS_GRACE_SECONDS)
    return {
        "status": "up_to_date" if now <= stale_after else "out_of_date",
        "last_success_at": checkpoint.isoformat(),
        "stale_after": stale_after.isoformat(),
        "checkpoint_source": checkpoint_source,
    }


async def read_checkpoint(db: AsyncSession, get_setting: SettingsReader) -> tuple[datetime | None, str | None]:
    """The dataset's last successful checkpoint and where it came from.

    The dedicated success checkpoint is authoritative; the sync watermark is
    the fallback for datasets synchronized before that key existed.
    """
    checkpoint_setting = await get_setting(db, LAST_SUCCESS_KEY)
    source = "dedicated"
    if not checkpoint_setting:
        checkpoint_setting = await get_setting(db, SYNC_WATERMARK_KEY)
        source = "watermark" if checkpoint_setting else None
    return parse_datetime(checkpoint_setting.get("value") if checkpoint_setting else None), source


async def dataset_freshness(db: AsyncSession, now: datetime, get_setting: SettingsReader) -> dict:
    """Read the dataset's checkpoint and classify it against its cadence."""
    schedules = (await get_setting(db, SCHEDULES_KEY)) or DEFAULT_SCHEDULES
    checkpoint, source = await read_checkpoint(db, get_setting)
    return freshness(checkpoint, schedules, now, source)
