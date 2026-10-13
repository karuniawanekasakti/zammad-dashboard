"""Check that /internal/logout can close a session with an idle-expired token.

Run from backend/: .venv/bin/python tests/run.py unit/test_internal_logout.py
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from jose import jwt

from app.config import settings
from app.routers.internal import decode_token_allow_expired, is_session_closed


def make_token(exp: datetime, secret: str | None = None, sid: str | None = "session-1") -> str:
    payload = {"sub": "42", "role": "agent", "group_ids": [], "exp": exp}
    if sid:
        payload["sid"] = sid
    return jwt.encode(payload, secret or settings.jwt_secret_key, algorithm="HS256")


def expect_401(token: str | None, message: str) -> None:
    try:
        decode_token_allow_expired(token)
    except HTTPException as exc:
        assert exc.status_code == 401, (message, exc.status_code)
    else:
        raise AssertionError(message)


def main() -> None:
    now = datetime.now(timezone.utc)

    # An expired but genuine token still yields its claims, so the session can be closed.
    claims = decode_token_allow_expired(make_token(now - timedelta(hours=2)))
    assert claims["sid"] == "session-1"
    assert claims["sub"] == "42"

    # A still-valid token works too.
    assert decode_token_allow_expired(make_token(now + timedelta(minutes=5)))["sid"] == "session-1"

    # A forged token (wrong secret) is rejected, expired or not.
    expect_401(make_token(now - timedelta(hours=2), secret="not-the-real-secret"), "forged token must be rejected")
    expect_401(make_token(now + timedelta(hours=1), secret="not-the-real-secret"), "forged token must be rejected")

    # Missing or malformed input is rejected.
    expect_401(None, "a missing token must be rejected")
    expect_401("", "an empty token must be rejected")
    expect_401("not.a.jwt", "a malformed token must be rejected")

    # Already-closed detection works for both dict and object rows.
    class Row:
        logout_at = now

    assert is_session_closed({"logout_at": now})
    assert is_session_closed(Row())
    assert not is_session_closed({"logout_at": None})
    assert not is_session_closed({})

    print("check_internal_logout: OK")


if __name__ == "__main__":
    main()