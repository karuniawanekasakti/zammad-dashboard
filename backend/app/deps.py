from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from redis.asyncio import Redis

from app.config import settings
from app.models import Role

security = HTTPBearer()

_redis: Redis | None = None


async def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def create_token(user_id: str, role: Role, group_ids: list[str]) -> str:
    payload = {
        "sub": user_id,
        "role": role.value,
        "group_ids": group_ids,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials, Depends(security)],
) -> dict:
    return decode_token(creds.credentials)


def require_roles(*roles: Role):
    async def checker(user: Annotated[dict, Depends(get_current_user)]) -> dict:
        if user["role"] not in [r.value for r in roles]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user
    return checker
