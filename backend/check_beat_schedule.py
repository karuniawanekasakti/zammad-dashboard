"""Check beat schedule refreshes preserve accumulated entry state.

Run inside the backend venv: python check_beat_schedule.py
"""
from datetime import datetime, timedelta, timezone
import json
from unittest.mock import patch

from app import celery_app


class FakeRedis:
    def __init__(self, schedules: dict):
        self.raw = json.dumps(schedules)

    def get(self, key):
        assert key == celery_app.SCHEDULES_REDIS_KEY
        return self.raw

    def close(self):
        return None


def _scheduler() -> celery_app.RedisScheduler:
    scheduler = celery_app.RedisScheduler.__new__(celery_app.RedisScheduler)
    scheduler.app = celery_app.celery
    scheduler._store = {
        "entries": {
            name: scheduler.Entry(**dict(entry, name=name, app=scheduler.app))
            for name, entry in celery_app._beat_entries_for({}).items()
        }
    }
    scheduler._last_refresh = 0.0
    return scheduler


def main() -> None:
    scheduler = _scheduler()
    entry_name = "sync-full-reconcile-every-6-hours"
    entry = scheduler.schedule[entry_name]
    last_run_at = datetime(2026, 9, 1, tzinfo=timezone.utc)
    entry.last_run_at = last_run_at
    entry.total_run_count = 7

    with patch.object(
        celery_app.redis_lib.Redis,
        "from_url",
        return_value=FakeRedis({"full_reconcile_seconds": 12345}),
    ):
        scheduler._refresh(force=True)

    refreshed = scheduler.schedule[entry_name]
    assert refreshed.schedule.run_every.total_seconds() == 12345
    assert refreshed.last_run_at == last_run_at
    assert refreshed.total_run_count == 7

    reset_scheduler = _scheduler()
    reset_entry = reset_scheduler.schedule[entry_name]
    reset_entry.last_run_at = last_run_at
    reset_entry.total_run_count = 7
    reset_scheduler.update_from_dict(
        celery_app._beat_entries_for({"full_reconcile_seconds": 12345})
    )
    reset = reset_scheduler.schedule[entry_name]
    assert reset.last_run_at != last_run_at
    assert reset.total_run_count == 0

    # The outcome the interval exists for: an elapsed interval must make the
    # entry due, and a refresh must not push it back out of reach.
    due_scheduler = _scheduler()
    due_entry = due_scheduler.schedule[entry_name]
    due_entry.last_run_at = datetime.now(timezone.utc) - timedelta(hours=6, minutes=1)
    due_entry.total_run_count = 3
    assert due_entry.is_due()[0] is True, "an elapsed 6-hour interval must be due"
    with patch.object(
        celery_app.redis_lib.Redis,
        "from_url",
        return_value=FakeRedis({"full_reconcile_seconds": 21600}),
    ):
        due_scheduler._refresh(force=True)
    assert due_scheduler.schedule[entry_name].is_due()[0] is True, (
        "a refresh must not reset the clock and push a due Full Reconcile out of reach"
    )

    reset_due = _scheduler()
    reset_due_entry = reset_due.schedule[entry_name]
    reset_due_entry.last_run_at = datetime.now(timezone.utc) - timedelta(hours=6, minutes=1)
    reset_due_entry.total_run_count = 3
    reset_due.update_from_dict(celery_app._beat_entries_for({"full_reconcile_seconds": 21600}))
    assert reset_due.schedule[entry_name].is_due()[0] is False, (
        "the old primitive must lose the due state, which is the bug this check pins"
    )

    print("check_beat_schedule: OK")


if __name__ == "__main__":
    main()
