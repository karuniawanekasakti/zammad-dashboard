"""Check truthful sync freshness through the Settings API boundary.

Run from backend/: .venv/bin/python tests/run.py unit/test_settings_freshness.py
"""
import asyncio
from datetime import datetime, timedelta, timezone
from time import perf_counter

from app import tasks
from app.freshness import DEFAULT_SCHEDULES, FRESHNESS_GRACE_SECONDS, LAST_SUCCESS_KEY, SCHEDULES_KEY, SYNC_WATERMARK_KEY
from app.routers import settings


async def main() -> None:
    now = datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)
    values: dict[str, dict] = {}

    async def fake_get_setting(_db, key):
        return values.get(key)

    async def fake_health(_db):
        return {"redis": "ok", "database": "ok", "zammad": "ok"}

    settings.get_setting = fake_get_setting
    settings._get_health = fake_health
    settings._get_worker_status = lambda: {"reachable": True, "workers": []}
    settings._utcnow = lambda: now

    async def read_status():
        return (await settings.status(current={"role": "admin"}, db=object(), redis=None)).data

    result = await read_status()
    assert result["freshness"]["status"] == "never_synced"
    assert result["latest_attempt"] is None

    checkpoint = now - timedelta(seconds=DEFAULT_SCHEDULES["incremental_seconds"] + FRESHNESS_GRACE_SECONDS)
    values[LAST_SUCCESS_KEY] = {"value": checkpoint.isoformat()}
    result = await read_status()
    assert result["freshness"]["status"] == "up_to_date", "the exact cadence-plus-grace boundary is still fresh"

    values[LAST_SUCCESS_KEY] = {"value": (checkpoint - timedelta(microseconds=1)).isoformat()}
    result = await read_status()
    assert result["freshness"]["status"] == "out_of_date"

    values[settings.LAST_RUN_KEY] = {"kind": "incremental", "status": "error", "finished_at": now.isoformat()}
    result = await read_status()
    assert result["freshness"]["status"] == "out_of_date", "a failed attempt must not refresh data"
    assert result["latest_attempt"]["status"] == "failed"

    values[settings.LAST_RUN_KEY] = {"kind": "full", "status": "ok", "finished_at": now.isoformat()}
    result = await read_status()
    assert result["latest_attempt"]["status"] == "succeeded"

    values.pop(LAST_SUCCESS_KEY)
    values[SYNC_WATERMARK_KEY] = {"value": now.isoformat()}
    result = await read_status()
    assert result["freshness"]["status"] == "up_to_date"
    assert result["freshness"]["checkpoint_source"] == "watermark"

    values[SCHEDULES_KEY] = {"incremental_seconds": 30, "full_reconcile_seconds": 21600}
    values[SYNC_WATERMARK_KEY] = {"value": (now - timedelta(seconds=151)).isoformat()}
    result = await read_status()
    assert result["freshness"]["status"] == "out_of_date", "status must use the saved cadence"

    writes: list[tuple[str, dict]] = []

    async def fake_with_engine(coro):
        class Session:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

        def factory():
            return Session()

        return await coro(factory)

    async def fake_set_setting(_session, key, value):
        writes.append((key, value))

    tasks._with_engine = fake_with_engine
    tasks.set_setting = fake_set_setting
    await tasks._record_last_run("incremental", {}, now, perf_counter(), "error")
    assert tasks.LAST_SUCCESS_KEY not in [key for key, _value in writes]
    assert writes[-1][1]["status"] == "error"

    print("check_settings_freshness: OK")


if __name__ == "__main__":
    asyncio.run(main())
