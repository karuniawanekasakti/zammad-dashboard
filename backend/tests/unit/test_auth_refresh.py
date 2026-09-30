"""Check the sliding session: 1-hour default lifetime and POST /auth/refresh.

Run from backend/: .venv/bin/python tests/run.py unit/test_auth_refresh.py
"""
import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jose import jwt

from app.config import Settings, settings
from app.deps import decode_token, get_current_user
from app.routers import auth


def token_with_exp(exp: datetime) -> str:
    payload = {"sub": "42", "role": "team_lead", "group_ids": ["g1", "g2"], "exp": exp}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")


async def main() -> None:
    # A developer's .env may override JWT_EXPIRY_HOURS, so pin the declared default.
    default = Settings.model_fields["jwt_expiry_hours"].default
    assert default == 1, f"jwt_expiry_hours default must be 1, got {default}"

    # Only a still-valid token may refresh: the route sits behind get_current_user.
    route = next((r for r in auth.router.routes if r.path == "/refresh"), None)
    assert route is not None, "POST /auth/refresh is not registered"
    assert route.methods == {"POST"}, route.methods
    assert route.dependant.dependencies[0].call is get_current_user

    # A refresh keeps the caller's identity and extends the expiry.
    now = datetime.now(timezone.utc)
    old_claims = decode_token(token_with_exp(now + timedelta(minutes=1)))
    response = await auth.refresh(current=old_claims)
    new_claims = decode_token(response.data["token"])
    assert new_claims["sub"] == old_claims["sub"]
    assert new_claims["role"] == old_claims["role"]
    assert new_claims["group_ids"] == old_claims["group_ids"]
    assert new_claims["exp"] > old_claims["exp"], "a refreshed token must outlive the one it replaces"
    lifetime = new_claims["exp"] - now.timestamp()
    assert abs(lifetime - settings.jwt_expiry_hours * 3600) < 5, lifetime

    # An expired token is rejected before it can reach the refresh handler.
    expired = token_with_exp(now - timedelta(seconds=1))
    try:
        await get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=expired))
    except HTTPException as exc:
        assert exc.status_code == 401, exc.status_code
    else:
        raise AssertionError("an expired token must be rejected before it can refresh")

    print("check_auth_refresh: OK")


if __name__ == "__main__":
    asyncio.run(main())