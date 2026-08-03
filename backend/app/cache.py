"""Redis caching and pub/sub utilities."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from typing import Any

from redis.asyncio import Redis

from app.deps import get_redis

CACHE_TTL = 120  # 2 minutes default


async def cache_get(key: str) -> Any | None:
    r = await get_redis()
    val = await r.get(key)
    return json.loads(val) if val else None


async def cache_set(key: str, value: Any, ttl: int = CACHE_TTL) -> None:
    r = await get_redis()
    await r.set(key, json.dumps(value, default=str), ex=ttl)


async def cache_delete(pattern: str) -> None:
    r = await get_redis()
    async for key in r.scan_iter(match=pattern):
        await r.delete(key)


async def publish(channel: str, message: dict) -> None:
    """Publish a message to a Redis pub/sub channel for WebSocket fan-out."""
    r = await get_redis()
    message.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
    await r.publish(channel, json.dumps(message, default=str))
