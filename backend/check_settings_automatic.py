"""Check automatic sync eligibility through the Settings API boundary.

Run inside the api container or backend venv: python check_settings_automatic.py
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

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

    async def eval(self, _script, _keys, _key, expected, *_args):
        if self.value != expected:
            return 0
        self.value = None
        self.ttl_value = -2
        return 1


async def main() -> None:
    now = datetime(2026, 9, 11, 12, 0, tzinfo=timezone.utc)
    values: dict[str, dict] = {}
    writes: list[tuple[str, dict]] = []
    redis = FakeRedis()

    async def fake_get_setting(_db, key):
        return values.get(key)

    async def fake_set_setting(_db, key, value):
        writes.append((key, value))
        values[key] = value

    probes = {
        "worker": {"reachable": True, "workers": ["sync@worker"], "snapshot_at": now.isoformat()},
        "health": {"redis": "ok", "database": "ok", "zammad": "ok", "snapshot_at": now.isoformat()},
    }

    async def fake_get_probes(_db, _now, _operation_key):
        return probes

    class QueuedTask:
        calls: list[tuple] = []

        @classmethod
        def delay(cls, *args):
            cls.calls.append(args)

    settings.get_setting = fake_get_setting
    settings.set_setting = fake_set_setting
    settings._get_probes = fake_get_probes
    settings._sync_tasks = lambda _kind: QueuedTask
    settings._utcnow = lambda: now

    async def read_status():
        before = list(writes)
        result = (await settings.status(current={"role": "admin"}, db=object(), redis=redis)).data
        assert writes == before, "GET status must remain side-effect free"
        return result

    status = await read_status()
    assert status["automatic"] == {
        "eligible": True,
        "required_kind": "full",
        "blockers": [],
        "next_eligible_at": None,
    }

    values[settings.LAST_SUCCESS_KEY] = {
        "value": (now - timedelta(seconds=settings.DEFAULT_SCHEDULES["incremental_seconds"] + settings.FRESHNESS_GRACE_SECONDS + 1)).isoformat()
    }
    status = await read_status()
    assert status["automatic"]["eligible"] is True
    assert status["automatic"]["required_kind"] == "incremental"

    values[settings.LAST_SUCCESS_KEY] = {"value": now.isoformat()}
    status = await read_status()
    assert status["automatic"]["eligible"] is False
    assert status["automatic"]["required_kind"] is None

    values[settings.LAST_SUCCESS_KEY] = {
        "value": (now - timedelta(hours=1)).isoformat()
    }
    probes["health"]["zammad"] = "down"
    probes["worker"]["reachable"] = False
    status = await read_status()
    assert status["automatic"]["eligible"] is False
    assert status["automatic"]["blockers"] == ["zammad_unavailable", "sync_worker_unavailable"]

    probes["health"]["zammad"] = "ok"
    probes["worker"]["reachable"] = True
    recovered = await read_status()
    assert recovered["automatic"]["eligible"] is True, "one request becomes eligible when dependencies recover"

    values[settings.SCHEDULES_KEY] = {"incremental_seconds": 60, "full_reconcile_seconds": 21600}
    failed_at = now - timedelta(seconds=30)
    values[settings.LAST_RUN_KEY] = {
        "operation_id": "failed-auto",
        "kind": "incremental",
        "source": "automatic",
        "triggered_by": "automatic",
        "status": "failed",
        "finished_at": failed_at.isoformat(),
    }
    status = await read_status()
    assert status["automatic"]["eligible"] is False
    assert status["automatic"]["blockers"] == ["automatic_failure_cooldown"]
    assert status["automatic"]["next_eligible_at"] == (failed_at + timedelta(seconds=60)).isoformat()
    assert status["schedules"]["incremental_seconds"] == 60

    blocked = (await settings.trigger_sync(
        settings.SyncTriggerIn(kind="incremental", source="automatic"),
        current={"role": "admin"},
        db=object(),
        redis=redis,
    )).data
    assert blocked["triggered"] is False and blocked["attached"] is False
    assert blocked["automatic"]["blockers"] == ["automatic_failure_cooldown"]
    assert QueuedTask.calls == []

    values[settings.LAST_RUN_KEY] = {
        "operation_id": "failed-manual",
        "kind": "incremental",
        "source": "manual",
        "triggered_by": "manual",
        "status": "failed",
        "finished_at": failed_at.isoformat(),
    }
    status = await read_status()
    assert status["automatic"]["eligible"] is True, "manual failures must not start automatic cooldown"
    values[settings.LAST_RUN_KEY] = {
        "operation_id": "failed-auto",
        "kind": "incremental",
        "source": "automatic",
        "triggered_by": "automatic",
        "status": "failed",
        "finished_at": failed_at.isoformat(),
    }

    manual = (await settings.trigger_sync(
        settings.SyncTriggerIn(kind="incremental", source="manual"),
        current={"role": "admin"},
        db=object(),
        redis=redis,
    )).data
    assert manual["triggered"] is True, "manual retry must bypass automatic cooldown"
    assert len(QueuedTask.calls) == 1

    racing = (await settings.trigger_sync(
        settings.SyncTriggerIn(kind="full", source="automatic"),
        current={"role": "admin"},
        db=object(),
        redis=redis,
    )).data
    assert racing["triggered"] is False and racing["attached"] is True
    assert racing["operation"]["operation_id"] == manual["operation"]["operation_id"]
    assert len(QueuedTask.calls) == 1

    payload = json.loads(redis.value)
    redis.value = None
    redis.ttl_value = -2
    values[settings.LAST_RUN_KEY] = {
        **payload["operation"],
        "source": "automatic",
        "triggered_by": "automatic",
        "status": "failed",
        "finished_at": (now - timedelta(seconds=61)).isoformat(),
    }
    status = await read_status()
    assert status["automatic"]["eligible"] is True, "automatic retry resumes after the current interval"

    print("check_settings_automatic: OK")


if __name__ == "__main__":
    asyncio.run(main())
