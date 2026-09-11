"""Check truthful progress and probe snapshots through stable boundaries.

Run inside the api container or backend venv: python check_sync_progress.py
"""
import asyncio
import threading
from datetime import datetime, timezone

from app import sync_operation, tasks
from app.routers import settings


async def main() -> None:
    now = datetime(2026, 9, 11, 12, 0, tzinfo=timezone.utc)
    assert sync_operation.RUNNING_PHASES == (
        "fetching_tickets",
        "fetching_users",
        "fetching_groups",
        "syncing_histories",
        "finalizing",
    )
    assert sync_operation.PHASES_BY_KIND["incremental"] == (
        "fetching_tickets",
        "syncing_histories",
        "finalizing",
    )

    operation, full_lease = sync_operation.new_operation("full", "manual", now=now)
    fetching_users = sync_operation.with_progress(operation, "fetching_users", {"tickets": 4})
    assert "known_total" not in fetching_users and "percentage" not in fetching_users

    syncing = sync_operation.with_progress(
        operation,
        "syncing_histories",
        {"tickets": 4, "users": 2, "groups": 1, "histories": 2},
        completed=3,
        known_total=4,
    )
    assert syncing["processed"] == {"tickets": 4, "users": 2, "groups": 1, "histories": 2}
    assert syncing["known_total"] == 4
    assert syncing["completed"] == 3
    assert syncing["percentage"] == 75
    assert sync_operation.with_progress(syncing, "syncing_histories", completed=4, known_total=4)["percentage"] == 100

    finalizing = sync_operation.with_progress(syncing, "finalizing", {"tickets": 4})
    assert finalizing["processed"]["histories"] == 2, "later phases must retain history progress"
    assert "known_total" not in finalizing and "completed" not in finalizing
    assert "percentage" not in finalizing, "indeterminate phases must not invent a percentage"

    incremental, _incremental_lease = sync_operation.new_operation("incremental", "manual", now=now)
    try:
        sync_operation.with_progress(incremental, "fetching_users")
    except ValueError:
        pass
    else:
        raise AssertionError("incremental sync exposed an inapplicable phase")

    values = {
        settings.LAST_SUCCESS_KEY: {"value": now.isoformat()},
        settings.LAST_RUN_KEY: operation,
    }

    async def fake_get_setting(_db, key):
        return values.get(key)

    class ActiveRedis:
        async def get(self, _key):
            return full_lease

        async def ttl(self, _key):
            return 600

        async def eval(self, *_args):
            return 1

    original_get_setting = settings.get_setting
    settings.get_setting = fake_get_setting
    try:
        status = await settings._sync_status(object(), now, ActiveRedis())
    finally:
        settings.get_setting = original_get_setting
    assert status["freshness"]["status"] == "up_to_date"
    assert status["execution"]["status"] == "queued", "freshness and execution are independent facts"

    updates: list[dict] = []
    original_renew = tasks.renew
    original_write = tasks._write_operation
    original_run_full = tasks.run_full_sync

    async def fake_renew(_redis, _lease_value, updated):
        updates.append(dict(updated))
        return "renewed"

    async def fake_write(_operation, _operation_id):
        return True

    async def stop_after_progress(progress, **_kwargs):
        await progress("syncing_histories", {"histories": 2}, 2, 4)
        await progress("finalizing", {"histories": 2})
        raise RuntimeError("stop after observing progress")

    tasks.renew = fake_renew
    tasks._write_operation = fake_write
    tasks.run_full_sync = stop_after_progress
    try:
        operation.update(status="running")
        try:
            await tasks._execute_managed_sync(
                kind="full",
                operation=operation,
                lease_value="lease",
                redis=ActiveRedis(),
            )
        except RuntimeError as exc:
            assert str(exc) == "stop after observing progress"
    finally:
        tasks.renew = original_renew
        tasks._write_operation = original_write
        tasks.run_full_sync = original_run_full
    finalizing_update = next(update for update in reversed(updates) if update.get("phase") == "finalizing")
    assert "percentage" not in finalizing_update and "known_total" not in finalizing_update

    calls = 0
    worker_thread = None
    original_worker = settings._get_worker_status
    original_health = settings._get_health
    settings._probe_snapshot = None

    def fake_worker():
        nonlocal calls, worker_thread
        calls += 1
        worker_thread = threading.get_ident()
        return {"reachable": True, "workers": []}

    async def fake_health(_db):
        return {"redis": "ok", "database": "ok", "zammad": "ok"}

    settings._get_worker_status = fake_worker
    settings._get_health = fake_health
    try:
        first = await settings._get_probes(object(), now, ("operation", "running"))
        second = await settings._get_probes(object(), now, ("operation", "running"))
    finally:
        settings._get_worker_status = original_worker
        settings._get_health = original_health
        settings._probe_snapshot = None
    assert calls == 1, "rapid polls must reuse expensive probes"
    assert worker_thread != threading.get_ident(), "Celery probing must not block the API event-loop thread"
    assert first == second
    assert first["worker"]["snapshot_at"] == now.isoformat()
    assert first["health"]["snapshot_at"] == now.isoformat()

    print("check_sync_progress: OK")


if __name__ == "__main__":
    asyncio.run(main())
