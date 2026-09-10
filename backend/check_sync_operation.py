"""Check shared sync ownership and Settings API behavior.

Run inside the api container or backend venv: python check_sync_operation.py
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

from app import sync_operation, tasks
from app.routers import settings


class FakeRedis:
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


async def main() -> None:
    now = datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc)
    redis = FakeRedis()

    claim = await sync_operation.acquire(redis, "incremental", "manual", now=now)
    assert claim is not None
    assert (await sync_operation.acquire(redis, "full", "automatic", now=now)) is None
    assert await sync_operation.owns_token(redis, claim.lease_value)
    assert not await sync_operation.renew(redis, "obsolete-token", claim.operation)
    renewed_operation = dict(claim.operation, phase="fetching_tickets")
    renewed_value = await sync_operation.renew(redis, claim.lease_value, renewed_operation)
    assert renewed_value
    assert await sync_operation.owns_token(redis, claim.lease_value)
    assert await sync_operation.owns_lease(redis, renewed_value)
    assert (await sync_operation.current(redis))["phase"] == "fetching_tickets"
    assert not await sync_operation.release(redis, "obsolete-token")
    assert await sync_operation.release(redis, renewed_value)

    expired = dict(claim.operation, lease_expires_at=(now - timedelta(seconds=1)).isoformat())
    interrupted = sync_operation.project(expired, now)
    assert interrupted["status"] == "interrupted"
    assert interrupted["error"] == sync_operation.INTERRUPTED_ERROR
    assert await sync_operation.acquire(redis, "full", "manual", now=now)

    values: dict[str, dict] = {}
    redis = FakeRedis()

    async def fake_get_setting(_db, key):
        return values.get(key)

    async def fake_set_setting(_db, key, value):
        values[key] = value

    async def fake_write_operation(operation, expected_operation_id=None):
        current = values.get(settings.LAST_RUN_KEY)
        if expected_operation_id and (not current or current.get("operation_id") != expected_operation_id):
            return False
        values[settings.LAST_RUN_KEY] = operation
        return True

    async def fake_operation_was_recorded(operation_id):
        return values.get(settings.LAST_RUN_KEY, {}).get("operation_id") == operation_id

    class QueuedTask:
        calls: list[tuple] = []

        @classmethod
        def delay(cls, *args):
            cls.calls.append(args)

    settings.get_setting = fake_get_setting
    settings.set_setting = fake_set_setting
    tasks._write_operation = fake_write_operation
    tasks._operation_was_recorded = fake_operation_was_recorded
    settings._utcnow = lambda: now
    settings._sync_tasks = lambda _kind: QueuedTask

    class BrokenRedis(FakeRedis):
        async def set(self, *_args, **_kwargs):
            raise ConnectionError("redis unavailable")

    unavailable = (await settings.trigger_sync(
        settings.SyncTriggerIn(kind="incremental", source="manual"),
        current={"role": "admin"},
        db=object(),
        redis=BrokenRedis(),
    )).data
    assert unavailable["triggered"] is False and unavailable["attached"] is False
    assert unavailable["operation"]["status"] == "failed"

    values.clear()
    first = (await settings.trigger_sync(
        settings.SyncTriggerIn(kind="incremental", source="manual"),
        current={"role": "admin"},
        db=object(),
        redis=redis,
    )).data
    assert first["triggered"] is True and first["attached"] is False
    assert first["operation"]["status"] == "queued"
    assert first["operation"]["kind"] == "incremental"
    assert first["operation"]["source"] == "manual"
    assert QueuedTask.calls

    second = (await settings.trigger_sync(
        settings.SyncTriggerIn(kind="full", source="automatic"),
        current={"role": "admin"},
        db=object(),
        redis=redis,
    )).data
    assert second["triggered"] is False and second["attached"] is True, second
    assert second["operation"]["operation_id"] == first["operation"]["operation_id"]
    assert len(QueuedTask.calls) == 1

    redis.value = None
    redis.ttl_value = -2

    class BrokenTask:
        @staticmethod
        def delay(*_args):
            raise RuntimeError("broker password leaked-secret")

    settings._sync_tasks = lambda _kind: BrokenTask
    failed = (await settings.trigger_sync(
        settings.SyncTriggerIn(kind="full", source="manual"),
        current={"role": "admin"},
        db=object(),
        redis=redis,
    )).data
    assert failed["triggered"] is False and failed["attached"] is False
    assert failed["operation"]["status"] == "failed"
    assert "partial writes" not in failed["operation"]["error"].lower()
    assert redis.value is None

    active = dict(first["operation"], status="running")
    values[settings.LAST_RUN_KEY] = active
    redis.value = json.dumps({"different": "owner"})
    called = False

    async def must_not_run(**_kwargs):
        nonlocal called
        called = True

    tasks._execute_managed_sync = must_not_run
    result = await tasks._run_managed_sync(
        "full",
        operation_id="scheduled-operation",
        source="scheduled",
        redis=redis,
    )
    assert result["skipped"] is True
    assert called is False
    assert values[settings.LAST_RUN_KEY] == active, "a conflicting scheduled tick must not replace visible work"

    checkpoint = {"value": (now - timedelta(hours=1)).isoformat()}
    failure_operation = dict(active, operation_id="failure-operation", phase="syncing_histories", processed={"tickets": 4})
    values[tasks.LAST_SUCCESS_KEY] = checkpoint
    values[settings.LAST_RUN_KEY] = failure_operation
    await tasks._record_managed_failure(failure_operation, RuntimeError("upstream failed"))
    assert values[tasks.LAST_SUCCESS_KEY] == checkpoint
    assert values[tasks.LAST_RUN_KEY]["status"] == "failed"
    assert values[tasks.LAST_RUN_KEY]["processed"]["tickets"] == 4
    assert values[tasks.LAST_RUN_KEY]["partial_writes"] is True

    redis = FakeRedis()
    scheduled_claim = await sync_operation.acquire(redis, "incremental", "scheduled", now=now)
    assert scheduled_claim
    stale_claim = await sync_operation.acquire(FakeRedis(), "full", "scheduled", now=now)
    assert stale_claim
    tasks._execute_managed_sync = must_not_run
    result = await tasks._run_managed_sync(
        "full",
        operation_id=stale_claim.operation["operation_id"],
        source="scheduled",
        lease_value=stale_claim.lease_value,
        redis=redis,
    )
    assert result == {"skipped": True, "reason": "obsolete operation"}

    values[settings.LAST_RUN_KEY] = expired
    redis.value = None
    status = await settings._sync_status(object(), now, redis)
    assert status["execution"] is None
    assert status["latest_attempt"]["status"] == "interrupted"

    print("check_sync_operation: OK")


if __name__ == "__main__":
    asyncio.run(main())
