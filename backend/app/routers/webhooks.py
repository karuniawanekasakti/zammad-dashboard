"""Webhook receiver for Zammad events."""
from __future__ import annotations
import hashlib
import hmac
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status

from app.cache import cache_delete, publish
from app.config import settings

router = APIRouter()


@router.post("/zammad")
async def receive_zammad_webhook(request: Request):
    body = await request.body()

    # Validate HMAC signature
    signature = request.headers.get("X-Hub-Signature-256", "")
    expected = "sha256=" + hmac.HMAC(
        settings.zammad_webhook_secret.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")

    payload = await request.json()
    event_type = payload.get("event", "ticket.updated")
    ticket = payload.get("ticket", {})
    ticket_id = ticket.get("id")
    group_id = ticket.get("group_id")

    # Invalidate caches
    await cache_delete("tickets:*")
    await cache_delete(f"ticket:{ticket_id}")
    await cache_delete("kpi:*")

    # Queue a worker to upsert the fresh ticket + articles into Postgres.
    # Guarded: a down broker must not break the webhook receiver.
    if ticket_id:
        try:
            from app.tasks import sync_ticket

            sync_ticket.delay(int(ticket_id))
        except Exception:
            pass

    # Publish to WebSocket rooms
    msg = {
        "type": event_type,
        "payload": {"ticket_id": str(ticket_id), "state": ticket.get("state", ""), "group_id": str(group_id)},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if group_id:
        await publish(f"ws:group/{group_id}", msg)
    await publish("ws:global", msg)

    owner_id = ticket.get("owner_id")
    if owner_id:
        await publish(f"ws:agent/{owner_id}", msg)

    return {"status": "ok"}
