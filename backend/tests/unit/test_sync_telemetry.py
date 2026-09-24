"""Check incremental sync telemetry is truthful through stable boundaries.

Covers three defects observed on the Settings page after a manual incremental sync:
  1. Tickets/Users/Groups showed 0/0/0 even though Zammad had changes, because the
     search query truncated the watermark or used a bare `>` comparison.
  2. Duration under-reported the run, because the timer started after the queue
     wait instead of spanning the queued_at..finished_at window the UI shows.
  3. Triggered By showed "Scheduled" after a manual trigger, because
     `_record_last_run` hardcoded `triggered_by: "beat"`.

It also pins the watermark's anchor per kind: a Full Reconcile must anchor to the
start of its ticket fetch (minus the overlap), so a ticket changed during its
long history phase is not skipped by the next run. See
docs/adr/0004-full-reconcile-watermark-anchor.md.

Run from backend/: .venv/bin/python tests/run.py unit/test_sync_telemetry.py
"""
import asyncio
from datetime import datetime, timedelta, timezone

from app import tasks
from app.zammad_client import ZammadClient


class FakeRedis:
    """Minimal Redis stand-in matching the lease script used by sync_operation."""

    def __init__(self):
        self.value: str | None = None
        self.ttl_value = -2

    async def set(self, _key, value, *, nx=False, ex=None):
        if nx and self.value is not None:
            return None
        self.value = value
        self.ttl_value = ex
        return True

    async def get(self, _key):
        return self.value

    async def ttl(self, _key):
        return self.ttl_value

    async def eval(self, script, _keys, _key, expected, *args):
        if self.value != expected:
            return 0
        if "redis.call('set'" in script:
            self.value = args[0]
            self.ttl_value = int(args[1])
        else:
            self.value = None
            self.ttl_value = -2
        return 1

    async def aclose(self):
        return None


def check_search_query_uses_full_bracketed_watermark() -> None:
    """Both ticket fetch paths preserve the full watermark in a bracket range."""
    import httpx

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[])

    client = ZammadClient()
    client._client = lambda: httpx.AsyncClient(  # type: ignore[method-assign]
        transport=httpx.MockTransport(handler), base_url="https://zammad.test"
    )

    watermark = "2026-09-15T04:00:00.123456+00:00"

    async def run() -> None:
        await client.get_all_tickets(per_page=25, updated_since=watermark)
        await client.get_tickets(per_page=25, updated_since=watermark)

    asyncio.run(run())

    assert len(seen) == 2, "both ticket fetch paths must issue a search request"
    expected = f"updated_at:[{watermark} TO *]"
    for request in seen:
        query = request.url.params["query"]
        assert request.url.path == "/api/v1/tickets/search", query
        assert query == expected, f"full watermark must reach Zammad in a bracket range, got {query!r}"
        assert not query.startswith("updated_at:>2026-09-15"), f"bare-date comparison must not be emitted, got {query!r}"
        assert query != f"updated_at:>{watermark}", f"unescaped full timestamp must not be emitted, got {query!r}"


def check_managed_run_owns_the_record() -> None:
    """A managed run records its real source and a queue-spanning duration once."""
    from app import sync_operation

    written: list[tuple[str, dict]] = []
    rows: dict[str, tasks.SettingRow] = {}

    async def fake_set_setting(_session, key, value):
        written.append((key, value))

    original_set_setting = tasks.set_setting
    original_with_engine = tasks._with_engine
    original_incremental = tasks.run_incremental_sync
    original_write = tasks._write_operation

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _model, key):
            return rows.get(key)

        def add(self, row):
            rows[row.key] = row

        async def commit(self):
            return None

    async def fake_with_engine(coro):
        return await coro(lambda: Session())

    async def fake_run_incremental(progress=None, record_run=True, advance_watermark=True):
        assert record_run is False, "the managed path must not let the runner write telemetry"
        assert advance_watermark is False, "the managed path advances the watermark itself"
        return {"synced": 3, "updated_since": "2026-09-14"}

    async def fake_write(operation, _operation_id=None):
        rows[tasks.LAST_RUN_KEY] = tasks.SettingRow(key=tasks.LAST_RUN_KEY, value=operation)
        return True

    tasks.set_setting = fake_set_setting
    tasks._with_engine = fake_with_engine
    tasks.run_incremental_sync = fake_run_incremental
    tasks._write_operation = fake_write

    queued_at = datetime.now(timezone.utc) - timedelta(seconds=10)
    redis = FakeRedis()
    try:
        claim = asyncio.run(sync_operation.acquire(redis, "incremental", "manual", operation_id="telemetry-op"))
        assert claim is not None, "a manual incremental run must claim the operation slot"
        operation = dict(claim.operation, queued_at=queued_at.isoformat())
        rows[tasks.LAST_RUN_KEY] = tasks.SettingRow(key=tasks.LAST_RUN_KEY, value=operation)

        asyncio.run(
            tasks._execute_managed_sync(
                kind="incremental",
                operation=operation,
                lease_value=claim.lease_value,
                redis=redis,
            )
        )
    finally:
        tasks.set_setting = original_set_setting
        tasks._with_engine = original_with_engine
        tasks.run_incremental_sync = original_incremental
        tasks._write_operation = original_write

    record = rows[tasks.LAST_RUN_KEY].value
    assert record["status"] == "succeeded", "the managed run must record one authoritative result"
    assert record["source"] == "manual", f"a manual run must stay manual, got {record['source']!r}"
    assert record["triggered_by"] == "manual", f"triggered_by must not be hardcoded, got {record['triggered_by']!r}"
    assert record["tickets"] == 3, f"the synced ticket count must be recorded, got {record['tickets']!r}"
    assert record["duration_secs"] >= 10, (
        f"duration must include the queue wait so it matches the shown timestamps, got {record['duration_secs']}"
    )
    assert record["finished_at"], "a completed run must carry finished_at"
    finished_at = datetime.fromisoformat(record["finished_at"])
    checkpoint = datetime.fromisoformat(rows[tasks.LAST_SUCCESS_KEY].value["value"])
    watermark = datetime.fromisoformat(rows[tasks.SYNC_WATERMARK_KEY].value["value"])
    assert checkpoint == finished_at, "freshness checkpoint must equal the true finish time"
    assert watermark == finished_at - timedelta(seconds=tasks.WATERMARK_OVERLAP_SECONDS), (
        "managed incremental watermark must overlap the next search window by 60 seconds"
    )

    assert not [value for name, value in written if name == tasks.LAST_RUN_KEY], (
        "the runner must not race the authoritative telemetry write"
    )


def check_watermark_anchor_covers_a_long_run() -> None:
    """Both sync kinds anchor the next window to their fetch, not their finish.

    Both fetch tickets in their first phase and may then spend arbitrary time
    syncing per-ticket histories. Anchoring the next incremental window to
    finished_at would skip every ticket changed during that span — the reported
    tickets were lost that way. The anchor is the recorded fetch moment, and both
    kinds carry the overlap.
    """
    finished = "2026-09-16T08:13:27.167653+00:00"
    fetched = "2026-09-16T07:48:45.196846+00:00"
    expected = datetime.fromisoformat(fetched) - timedelta(seconds=tasks.WATERMARK_OVERLAP_SECONDS)

    for kind in ("full", "incremental"):
        operation = {"kind": kind, "watermark_at": fetched, "started_at": fetched, "finished_at": finished}
        anchored = tasks._watermark_value(tasks._watermark_anchor(operation))
        assert datetime.fromisoformat(anchored) == expected, (
            f"a {kind} watermark must anchor to its fetch start minus the overlap, got {anchored}"
        )

    # An operation recorded before the fetch stamp existed falls back to its
    # finished_at rather than raising into the sync path.
    legacy = {"kind": "incremental", "finished_at": finished}
    assert tasks._watermark_value(tasks._watermark_anchor(legacy)) == (
        datetime.fromisoformat(finished) - timedelta(seconds=tasks.WATERMARK_OVERLAP_SECONDS)
    ).isoformat(), "a legacy operation must fall back to finished_at"

def check_duration_spans_queue_to_finish() -> None:
    """Duration must be wall-clock over queued_at..finished_at, not a partial timer."""
    # A run that waited 10s for a worker slot and then took 84s must report ~94s,
    # matching the started_at/finished_at the UI renders.
    duration = tasks._run_duration_secs("2026-09-14T06:00:00+00:00", "2026-09-14T06:01:34.500000+00:00")
    assert duration == 94.5, f"duration must span the queued window, got {duration}"

    # A "Z" suffix and a naive timestamp must both parse.
    assert tasks._run_duration_secs("2026-09-14T06:00:00Z", "2026-09-14T06:00:05Z") == 5.0
    assert tasks._run_duration_secs("2026-09-14T06:00:00", "2026-09-14T06:00:07") == 7.0

    # Unparseable input degrades to 0 rather than raising into the sync path.
    assert tasks._run_duration_secs("not-a-date", "also-not-a-date") == 0.0


if __name__ == "__main__":
    check_search_query_uses_full_bracketed_watermark()
    check_managed_run_owns_the_record()
    check_watermark_anchor_covers_a_long_run()
    check_duration_spans_queue_to_finish()
    print("check_sync_telemetry: OK")
