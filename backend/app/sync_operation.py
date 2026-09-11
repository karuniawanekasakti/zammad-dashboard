"""Shared Redis lease and durable sync-operation shape."""
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4

from redis.asyncio import Redis

OPERATION_KEY = "sync:operation:lease"
LEASE_SECONDS = 600
HEARTBEAT_SECONDS = 30
INTERRUPTED_ERROR = "The worker lease expired before completion. Partial writes may have occurred."
RUNNING_PHASES = (
    "fetching_tickets",
    "fetching_users",
    "fetching_groups",
    "syncing_histories",
    "finalizing",
)
PHASES_BY_KIND = {
    "incremental": ("fetching_tickets", "syncing_histories", "finalizing"),
    "full": RUNNING_PHASES,
}

_RENEW = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0
"""
_RELEASE = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""


@dataclass(frozen=True)
class Claim:
    operation: dict
    lease_value: str


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_operation(
    kind: Literal["incremental", "full"],
    source: Literal["manual", "automatic", "scheduled"],
    *,
    now: datetime | None = None,
    operation_id: str | None = None,
) -> tuple[dict, str]:
    now = now or utcnow()
    token = uuid4().hex
    operation = {
        "operation_id": operation_id or str(uuid4()),
        "kind": kind,
        "source": source,
        "triggered_by": source,
        "status": "queued",
        "phase": "queued",
        "processed": {"tickets": 0, "users": 0, "groups": 0, "histories": 0},
        "queued_at": now.isoformat(),
        "started_at": None,
        "finished_at": None,
        "renewed_at": now.isoformat(),
        "lease_expires_at": (now + timedelta(seconds=LEASE_SECONDS)).isoformat(),
        "duration_secs": 0,
        "error": None,
        "partial_writes": False,
    }
    return operation, json.dumps({"token": token, "operation": operation}, separators=(",", ":"), sort_keys=True)


async def acquire(
    redis: Redis,
    kind: Literal["incremental", "full"],
    source: Literal["manual", "automatic", "scheduled"],
    *,
    now: datetime | None = None,
    operation_id: str | None = None,
) -> Claim | None:
    operation, lease_value = new_operation(kind, source, now=now, operation_id=operation_id)
    if not await redis.set(OPERATION_KEY, lease_value, nx=True, ex=LEASE_SECONDS):
        return None
    return Claim(operation, lease_value)


async def current(redis: Redis, operation: dict | None = None, *, now: datetime | None = None) -> dict | None:
    value = await redis.get(OPERATION_KEY)
    if not value:
        return None
    try:
        lease_operation = json.loads(value)["operation"]
        if not operation or operation.get("operation_id") != lease_operation.get("operation_id"):
            operation = lease_operation
        operation = dict(operation)
        ttl = await redis.ttl(OPERATION_KEY)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None
    if ttl <= 0:
        return None
    operation["lease_expires_at"] = ((now or utcnow()) + timedelta(seconds=ttl)).isoformat()
    return operation


async def owns_lease(redis: Redis, lease_value: str) -> bool:
    return await redis.get(OPERATION_KEY) == lease_value


async def owns_token(redis: Redis, lease_value: str) -> bool:
    value = await redis.get(OPERATION_KEY)
    if not value:
        return False
    try:
        return json.loads(value)["token"] == json.loads(lease_value)["token"]
    except (KeyError, TypeError, json.JSONDecodeError):
        return False


async def renew(redis: Redis, lease_value: str, operation: dict) -> str | None:
    try:
        token = json.loads(lease_value)["token"]
    except (KeyError, TypeError, json.JSONDecodeError):
        return None
    renewed_value = json.dumps(
        {"token": token, "operation": operation},
        separators=(",", ":"),
        sort_keys=True,
    )
    if not await redis.eval(_RENEW, 1, OPERATION_KEY, lease_value, renewed_value, LEASE_SECONDS):
        return None
    return renewed_value


async def release(redis: Redis, lease_value: str) -> bool:
    return bool(await redis.eval(_RELEASE, 1, OPERATION_KEY, lease_value))


def project(operation: dict | None, now: datetime | None = None) -> dict | None:
    if not operation:
        return None
    projected = dict(operation)
    if projected.get("status") not in {"queued", "running"}:
        return projected
    expires_at = _parse_datetime(projected.get("lease_expires_at"))
    if expires_at and (now or utcnow()) > expires_at:
        projected.update(
            status="interrupted",
            finished_at=expires_at.isoformat(),
            error=INTERRUPTED_ERROR,
            partial_writes=projected.get("status") == "running",
        )
    return projected


def public(operation: dict | None) -> dict | None:
    return dict(operation) if operation else None


def with_progress(
    operation: dict,
    phase: str,
    processed: dict | None = None,
    *,
    completed: int | None = None,
    known_total: int | None = None,
) -> dict:
    if phase not in PHASES_BY_KIND[operation["kind"]]:
        raise ValueError(f"invalid {operation['kind']} sync phase: {phase}")
    progressed = dict(operation, phase=phase, processed={**operation["processed"], **(processed or {})})
    progressed.pop("known_total", None)
    progressed.pop("percentage", None)
    progressed.pop("completed", None)
    if known_total is not None and known_total > 0 and completed is not None:
        progressed.update(completed=completed, known_total=known_total, percentage=min(100, round(completed * 100 / known_total)))
    return progressed


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)
