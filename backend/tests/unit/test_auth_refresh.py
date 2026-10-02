"""Check the sliding session: 1-hour default lifetime and POST /auth/refresh.

Run from backend/: .venv/bin/python tests/run.py unit/test_auth_refresh.py
"""
import asyncio
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException
from jose import jwt

from app.config import Settings, settings
from app.deps import decode_token, get_current_user
from app.models import Role
from app.routers import auth


def token_with_exp(exp: datetime) -> str:
    payload = {
        "sub": "42",
        "role": "team_lead",
        "group_ids": ["g1", "g2"],
        "sid": "session-1",
        "exp": exp,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")


class FakeDB:
    """Stands in for the AsyncSession: upsert_user is patched, so it is never used."""


async def noop(*args, **kwargs):
    return None


def zammad_user(**overrides) -> dict:
    """What Zammad reports *now*: a plain agent who lost team_lead and group g2."""
    user = {
        "id": 42,
        "email": "agent@example.com",
        "firstname": "Test",
        "lastname": "Agent",
        "login": "agent@example.com",
        "active": True,
        "roles": ["Agent"],
        "note": "",
        "group_ids": {"1": ["read"]},
    }
    user.update(overrides)
    return user


@contextmanager
def server_state(get_user):
    """Replace Zammad, the DB write and the cache so refresh runs without I/O."""
    with patch.object(auth.zammad, "get_user", new=get_user), \
         patch.object(auth, "upsert_user", new=noop), \
         patch.object(auth, "cache_set", new=noop):
        yield


async def expect_status(coro, status_code: int, message: str) -> None:
    try:
        await coro
    except HTTPException as exc:
        assert exc.status_code == status_code, (message, exc.status_code)
    else:
        raise AssertionError(message)


async def main() -> None:
    # A developer's .env may override JWT_EXPIRY_HOURS, so pin the declared default.
    default = Settings.model_fields["jwt_expiry_hours"].default
    assert default == 1, f"jwt_expiry_hours default must be 1, got {default}"

    # Only a still-valid token may refresh: the route sits behind get_current_user.
    route = next((r for r in auth.router.routes if r.path == "/refresh"), None)
    assert route is not None, "POST /auth/refresh is not registered"
    assert route.methods == {"POST"}, route.methods
    assert route.dependant.dependencies[0].call is get_current_user

    now = datetime.now(timezone.utc)
    old_claims = decode_token(token_with_exp(now + timedelta(minutes=1)))

    # A refresh keeps the caller's identity and session, and extends the expiry.
    async def get_user(_user_id):
        return zammad_user()

    with server_state(get_user):
        response = await auth.refresh(current=old_claims, db=FakeDB())
    new_claims = decode_token(response.data["token"])
    assert new_claims["sub"] == old_claims["sub"]
    assert new_claims["sid"] == old_claims["sid"], "the refreshed token must stay on the same login session"
    assert new_claims["exp"] > old_claims["exp"], "a refreshed token must outlive the one it replaces"
    lifetime = new_claims["exp"] - now.timestamp()
    assert abs(lifetime - settings.jwt_expiry_hours * 3600) < 5, lifetime

    # Authorization comes from the server, never from the old token: the old token
    assert old_claims["role"] == "team_lead" and old_claims["group_ids"] == ["g1", "g2"]
    assert new_claims["role"] == Role.agent.value, "revoked role must not be carried over"
    assert new_claims["group_ids"] == ["1"], "revoked group access must not be carried over"

    # A user whose admin role was removed must not get an admin token back.
    admin_claims = {**old_claims, "role": "admin"}
    with server_state(get_user):
        response = await auth.refresh(current=admin_claims, db=FakeDB())
    assert decode_token(response.data["token"])["role"] != Role.admin.value

    # An inactive user cannot refresh.
    async def get_inactive_user(_user_id):
        return zammad_user(active=False)

    with server_state(get_inactive_user):
        await expect_status(
            auth.refresh(current=old_claims, db=FakeDB()),
            401,
            "an inactive user must not be able to refresh",
        )

    # A user Zammad no longer knows cannot refresh either.
    async def get_missing_user(_user_id):
        return None

    with server_state(get_missing_user):
        await expect_status(
            auth.refresh(current=old_claims, db=FakeDB()),
            401,
            "an unknown user must not be able to refresh",
        )

    # If Zammad is unreachable, no token is minted and the client is told to retry.
    async def get_user_down(_user_id):
        raise ConnectionError("zammad unreachable")

    with server_state(get_user_down), patch.object(auth.logger, "exception"):
        await expect_status(
            auth.refresh(current=old_claims, db=FakeDB()),
            503,
            "refresh must fail closed when Zammad cannot be reached",
        )

    # An expired token is rejected, so it can never reach the refresh handler.
    expired = token_with_exp(now - timedelta(seconds=1))
    try:
        decode_token(expired)
    except HTTPException as exc:
        assert exc.status_code == 401, exc.status_code
    else:
        raise AssertionError("an expired token must be rejected before it can refresh")

    print("check_auth_refresh: OK")


if __name__ == "__main__":
    asyncio.run(main())