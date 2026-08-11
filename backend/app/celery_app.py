"""Celery app with beat schedule and task routing.

Beat schedule is data-driven: the *worker* task `app.tasks.reload_schedules`
reads the DB-backed `sync:schedules` setting and publishes it to Redis under
`sync:schedules:effective`; the custom `RedisScheduler` (used by `celery beat`)
refreshes from that Redis key every few seconds. So admin edits to sync
intervals apply to a running beat without a container restart.
"""
import json
import time

import redis as redis_lib
from celery import Celery
from celery.beat import PersistentScheduler

from app.config import settings

SCHEDULES_REDIS_KEY = "sync:schedules:effective"

BEAT_ENTRIES = {
    "sync-incremental-every-5-min": {
        "task": "app.tasks.sync_incremental",
        "schedule": 300.0,  # 5 minutes
    },
    "sync-full-reconcile-every-6-hours": {
        "task": "app.tasks.sync_full_reconcile",
        "schedule": 21600.0,  # 6 hours
    },
    "reload-schedules": {
        "task": "app.tasks.reload_schedules",
        "schedule": 60.0,  # read DB schedules every minute
    },
}


def publish_schedules_to_redis(schedules: dict) -> None:
    """Push effective intervals to Redis; the beat scheduler reads them."""
    try:
        r = redis_lib.Redis.from_url(settings.redis_url, decode_responses=True)
        r.set(SCHEDULES_REDIS_KEY, json.dumps(schedules))
        r.close()
    except Exception:
        pass


def _beat_entries_for(schedules: dict) -> dict:
    return {
        "sync-incremental-every-5-min": {
            "task": "app.tasks.sync_incremental",
            "schedule": float(schedules.get("incremental_seconds", 300)),
        },
        "sync-full-reconcile-every-6-hours": {
            "task": "app.tasks.sync_full_reconcile",
            "schedule": float(schedules.get("full_reconcile_seconds", 21600)),
        },
        "reload-schedules": {
            "task": "app.tasks.reload_schedules",
            "schedule": 60.0,
        },
    }


class RedisScheduler(PersistentScheduler):
    """Beat scheduler that picks up schedule changes from Redis every few seconds."""

    _last_refresh = 0.0

    def setup_schedule(self):
        super().setup_schedule()  # opens the persistent store, applies conf defaults
        self._refresh(force=True)  # then override with any Redis-published schedules

    def tick(self, *args, **kwargs):
        self._refresh()
        return super().tick(*args, **kwargs)

    def _refresh(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_refresh < 5:
            return
        self._last_refresh = now
        try:
            r = redis_lib.Redis.from_url(settings.redis_url, decode_responses=True)
            raw = r.get(SCHEDULES_REDIS_KEY)
            r.close()
            if not raw:
                return
            self.update_from_dict(_beat_entries_for(json.loads(raw)))
        except Exception:
            pass


celery = Celery(
    "zammad_monitor",
    broker=settings.redis_url,
    include=["app.tasks"],
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    beat_scheduler="app.celery_app:RedisScheduler",
    task_routes={
        "app.tasks.sync_incremental": {"queue": "sync"},
        "app.tasks.sync_full_reconcile": {"queue": "sync"},
        "app.tasks.sync_ticket": {"queue": "sync"},
        "app.tasks.reload_schedules": {"queue": "sync"},
    },
    beat_schedule=BEAT_ENTRIES,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
)