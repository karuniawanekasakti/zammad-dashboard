import time
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models import Role

security = HTTPBearer()

REVOKED_SID_TTL = 8 * 3600


def revoked_session_key(sid: str) -> str:
    return f"revoked:sid:{sid}"

_redis: Redis | None = None


async def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def create_token(user_id: str, role: Role, group_ids: list[str], sid: str | None = None) -> str:
    payload = {
        "sub": user_id,
        "role": role.value,
        "group_ids": group_ids,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours),
    }
    if sid is not None:
        payload["sid"] = sid
    return jwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


class SessionRevokedError(HTTPException):
    """Raised when the token's session no longer exists or has been revoked."""

    def __init__(self) -> None:
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked")


def session_revoked_decision(row: dict | None) -> bool:
    """Pure decision: a `sid` is rejected when its session row is missing or revoked.

    Kept free of DB/Redis so the rule is verifiable without a live service.
    """
    if row is None:
        return True
    return bool(row.get("revoked"))


def revoked_cache_expiry(exp: int | float | None, *, now: float, max_ttl: int) -> int:
    """Seconds to cache a revoked `sid`, bounded by the token's remaining life.

    A revoked session stays in Redis at least until the token it was minted with
    would have expired, and never longer than the configured cap.
    """
    if exp is None:
        return max_ttl
    return max(1, min(int(exp - now), max_ttl))


async def ensure_session_active(sid: str | None, redis: Redis, db: AsyncSession, exp: int | float | None) -> None:
    """Reject a session that is revoked or no longer exists.

    The Redis revoked-key is the fast path; a cache miss falls back to the DB.
    """
    if not sid:
        return
    key = revoked_session_key(sid)
    if await redis.exists(key):
        raise SessionRevokedError()
    from app.repositories import get_access_session

    row = await get_access_session(db, sid)
    if session_revoked_decision(row):
        await redis.set(key, "1", ex=revoked_cache_expiry(exp, now=time.time(), max_ttl=REVOKED_SID_TTL))
        raise SessionRevokedError()


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    payload = decode_token(creds.credentials)
    await ensure_session_active(payload.get("sid"), await get_redis(), db, payload.get("exp"))
    return payload


def require_roles(*roles: Role):
    async def checker(user: Annotated[dict, Depends(get_current_user)]) -> dict:
        if user["role"] not in [r.value for r in roles]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user
    return checker
