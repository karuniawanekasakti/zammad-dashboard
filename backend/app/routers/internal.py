"""Hidden internal endpoints for the Session & Activity Log.

Not advertised: mounted with ``include_in_schema=False`` and an unobvious path
namespace, so it never shows up in ``/docs``. Access is still JWT-gated (every
endpoint depends on ``get_current_user``) — "hidden" is the access control, not
a role check, matching the client-side-hidden UI.

Route/event normalization lives in pure helpers so the de-dup rule is testable
without a database or an HTTP server.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, get_redis, revoked_session_key
from app.models import ActivityEventIn, ApiResponse, SessionActivityOut
from app.repositories import (
    add_session_activity,
    close_access_session,
    get_access_session,
    last_activity,
    list_access_sessions,
    list_session_activity,
    revoke_access_session,
    touch_access_session,
)

router = APIRouter()

#: Route/event kinds the server accepts from the client beacon. Lifecycle kinds
#: (`login`, `logout`) are written server-side and must not be spoofed here.
CLIENT_EVENT_KINDS = frozenset({"view"})

#: Paths that must never appear in the timeline: the login page (before there is
#: a session) and the activity page itself (would be self-referential noise).
EXCLUDED_ROUTES = ("/login", "/session-log")


def generate_session_id() -> str:
    return str(uuid.uuid4())


def normalize_route(route: str | None) -> str | None:
    """Reduce a client route to a bare pathname, or None if it must be ignored.

    Accepts a pathname beginning with ``/``. A full URL is reduced to its path
    and its query/hash are dropped. Query strings and fragments are rejected
    outright, and the login/activity routes are never recorded.
    """
    if not isinstance(route, str):
        return None
    candidate = route.strip()
    if not candidate:
        return None
    if "://" in candidate:
        split = urlsplit(candidate)
        candidate = split.path
        query, fragment = split.query, split.fragment
    else:
        query, fragment = "", ""
        for marker in ("#", "?"):
            if marker in candidate:
                head, _, tail = candidate.partition(marker)
                if marker == "#":
                    fragment = tail
                else:
                    query = tail
                candidate = head
    if query or fragment:
        return None
    if not candidate.startswith("/"):
        return None
    candidate = candidate.rstrip("/") or "/"
    for excluded in EXCLUDED_ROUTES:
        if candidate == excluded or candidate.startswith(f"{excluded}/"):
            return None
    return candidate


def normalize_activity(kind: str | None, route: str | None) -> tuple[str, str | None] | None:
    """Validate a client event into a storable ``(kind, route)`` pair.

    `kind` must be exactly a client event kind (currently only ``view``); `view`
    requires a route that survives `normalize_route`. Returns None when the
    event must be dropped rather than stored.
    """
    if kind not in CLIENT_EVENT_KINDS:
        return None
    normalized = normalize_route(route)
    if normalized is None:
        return None
    return kind, normalized


def is_duplicate_event(kind: str | None, route: str | None, previous: dict | None) -> bool:
    """True when the event repeats the session's most recent one.

    Collapses rapid back-to-back duplicates (the same route twice in a row),
    which is what the client throttle cannot guarantee on its own.
    """
    if previous is None:
        return False
    return kind == previous.get("kind") and route == previous.get("route")




@router.post("/activity", response_model=ApiResponse)
async def log_activity(
    body: ActivityEventIn,
    current: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    sid = current.get("sid")
    if not sid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session required")
    event = normalize_activity(body.kind, body.route)
    if event is None:
        return ApiResponse(data={"recorded": False})
    kind, route = event
    previous = await last_activity(db, sid)
    if is_duplicate_event(kind, route, previous):
        previous_at = previous.get("created_at")
        if previous_at and datetime.now(timezone.utc) - datetime.fromisoformat(previous_at) < timedelta(seconds=5):
            await touch_access_session(db, sid)
            return ApiResponse(data={"recorded": False, "deduplicated": True})
    await add_session_activity(db, _activity_out(session_id=sid, kind=kind, route=route))
    await touch_access_session(db, sid)
    return ApiResponse(data={"recorded": True})


@router.post("/logout", response_model=ApiResponse)
async def logout(
    current: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    sid = current.get("sid")
    if not sid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session required")
    await add_session_activity(db, _activity_out(session_id=sid, kind="logout", route=None))
    await close_access_session(db, sid)
    return ApiResponse(data={"logged_out": True})


@router.get("/sessions", response_model=ApiResponse)
async def sessions(
    current: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    rows = await list_access_sessions(db)
    return ApiResponse(data=rows)


@router.get("/sessions/{session_id}/activity", response_model=ApiResponse)
async def session_activity(
    session_id: str,
    current: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if await get_access_session(db, session_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    events = await list_session_activity(db, session_id)
    return ApiResponse(data=events)


@router.post("/sessions/{session_id}/revoke", response_model=ApiResponse)
async def revoke(
    session_id: str,
    current: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    session = await get_access_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    await add_session_activity(db, _activity_out(session_id=session_id, kind="revoke", route=None))
    await revoke_access_session(db, session_id)
    await _cache_revocation(session_id)
    return ApiResponse(data={"revoked": True})


async def _cache_revocation(session_id: str) -> None:
    """Set the revoked key so later requests fail fast without a DB hit.

    The key's TTL is the configured JWT lifetime — comfortably covering any
    token that could still present this ``sid``.
    """
    from app.config import settings

    ttl = max(1, int(settings.jwt_expiry_hours * 3600))
    try:
        redis = await get_redis()
        await redis.set(revoked_session_key(session_id), "1", ex=ttl)
    except Exception:
        # Redis is a fast path only; the DB check in deps still rejects revoked.
        pass


def _activity_out(*, session_id: str, kind: str, route: str | None) -> SessionActivityOut:
    return SessionActivityOut(
        id=str(uuid.uuid4()),
        session_id=session_id,
        kind=kind,
        route=route,
        created_at=datetime.now(timezone.utc),
    )
