"""WebSocket endpoint with Redis pub/sub fan-out."""
from __future__ import annotations
import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query
from redis.asyncio import Redis

from app.deps import decode_token, get_redis

router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, ws: WebSocket, room: str):
        await ws.accept()
        self._connections.setdefault(room, []).append(ws)

    def disconnect(self, ws: WebSocket, room: str):
        conns = self._connections.get(room, [])
        if ws in conns:
            conns.remove(ws)

    async def broadcast(self, room: str, message: dict):
        for ws in self._connections.get(room, []):
            try:
                await ws.send_json(message)
            except Exception:
                pass


manager = ConnectionManager()


@router.websocket("/ws/{room}")
async def websocket_endpoint(ws: WebSocket, room: str, token: str = Query(...)):
    # Validate JWT
    try:
        user = decode_token(token)
    except Exception:
        await ws.close(code=4001)
        return

    await manager.connect(ws, room)

    # Subscribe to Redis pub/sub for this room
    redis: Redis = await get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"ws:{room}")

    async def redis_listener():
        try:
            async for msg in pubsub.listen():
                if msg["type"] == "message":
                    data = json.loads(msg["data"])
                    await ws.send_json(data)
        except Exception:
            pass

    listener_task = asyncio.create_task(redis_listener())

    try:
        while True:
            # Keep connection alive, handle client pings
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        listener_task.cancel()
        await pubsub.unsubscribe(f"ws:{room}")
        manager.disconnect(ws, room)
