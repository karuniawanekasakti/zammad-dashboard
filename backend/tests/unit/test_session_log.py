"""Check the hidden Session & Activity Log seam without a DB, Redis or Zammad.

Covers the pure pieces the feature leans on: the `sid` JWT claim round-trip,
User-Agent -> device-label parsing, route/event normalization plus the timeline
de-dup rule, and the revoked-session decision.

Run from backend/: .venv/bin/python tests/run.py unit/test_session_log.py
"""
import asyncio
from datetime import datetime, timedelta, timezone

from app.deps import (
    create_token,
    decode_token,
    revoked_cache_expiry,
    revoked_session_key,
    session_revoked_decision,
)
from app.models import Role
from app.routers.auth import _device_label
from app.routers.internal import (
    generate_session_id,
    is_duplicate_event,
    normalize_activity,
    normalize_route,
)


def check_sid_roundtrip() -> None:
    token = create_token("42", Role.admin, ["g1", "g2"], sid="session-abc")
    payload = decode_token(token)
    assert payload["sub"] == "42"
    assert payload["role"] == "admin"
    assert payload["group_ids"] == ["g1", "g2"]
    assert payload["sid"] == "session-abc"

    # The sid claim is optional: existing callers that mint a token without a
    # session still produce a valid token, just without `sid`.
    legacy = decode_token(create_token("42", Role.agent, []))
    assert "sid" not in legacy
    assert legacy["role"] == "agent"

    generated = generate_session_id()
    assert generated and generated != generate_session_id(), "session ids must be unique"


def check_device_label() -> None:
    chrome_win = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
    assert _device_label(chrome_win) == "Chrome on Windows"

    firefox_linux = "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0"
    assert _device_label(firefox_linux) == "Firefox on Linux"

    safari_mac = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.4 Safari/605.1.15"
    )
    assert _device_label(safari_mac) == "Safari on macOS"

    edge_win = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0"
    )
    assert _device_label(edge_win) == "Edge on Windows", "Edge must win over the Chrome token it embeds"

    iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1"
    assert _device_label(iphone) == "Safari on iPhone"

    cli = "curl/8.5.0"
    assert _device_label(cli) == "curl on Unknown OS"

    assert _device_label("") == "Unknown device"
    assert _device_label("some-random-agent") == "Unknown device"


def check_route_normalization() -> None:
    assert normalize_route("/tickets") == "/tickets"
    assert normalize_route("/tickets/") == "/tickets", "trailing slash collapses"
    assert normalize_route("/") == "/"

    # Query/hash are rejected outright, not silently trimmed off a real route.
    assert normalize_route("/tickets?page=2") is None
    assert normalize_route("/tickets#top") is None
    assert normalize_route("/tickets?page=2#top") is None

    # Relative, empty and non-string input must be ignored.
    assert normalize_route("tickets") is None
    assert normalize_route("") is None
    assert normalize_route(None) is None

    # The login page and the activity page itself are never recorded.
    assert normalize_route("/login") is None
    assert normalize_route("/session-log") is None
    assert normalize_route("/session-log/123") is None

    # A full URL reduces to its pathname (query/hash dropped) and is accepted.
    assert normalize_route("http://localhost:5173/tickets") == "/tickets"


def check_event_normalization_and_dedup() -> None:
    assert normalize_activity("view", "/tickets") == ("view", "/tickets")
    assert normalize_activity("view", "/session-log") is None
    assert normalize_activity("view", "/tickets?page=2") is None
    # Lifecycle kinds are server-written; a client cannot spoof them.
    assert normalize_activity("login", "/tickets") is None
    assert normalize_activity("logout", None) is None
    assert normalize_activity("view", None) is None

    # De-dup collapses a repeat of the session's most recent event only.
    previous = {"kind": "view", "route": "/tickets"}
    assert is_duplicate_event("view", "/tickets", previous) is True
    assert is_duplicate_event("view", "/settings", previous) is False
    assert is_duplicate_event("view", "/tickets", None) is False, "the first event is never a duplicate"


def check_revoked_decision() -> None:
    assert session_revoked_decision(None) is True, "a missing session is rejected"
    assert session_revoked_decision({"revoked": True}) is True
    assert session_revoked_decision({"revoked": False}) is False

    assert revoked_session_key("s1") == "revoked:sid:s1"

    now = 1_000_000.0
    # Remaining lifetime is used when it fits under the cap.
    assert revoked_cache_expiry(now + 120, now=now, max_ttl=28800) == 120
    # Capped when the token still has longer to live than the max TTL.
    assert revoked_cache_expiry(now + 99999, now=now, max_ttl=28800) == 28800
    # Never zero/negative even if the token is already past expiry.
    assert revoked_cache_expiry(now - 5, now=now, max_ttl=28800) == 1
    assert revoked_cache_expiry(None, now=now, max_ttl=28800) == 28800


async def main() -> None:
    check_sid_roundtrip()
    check_device_label()
    check_route_normalization()
    check_event_normalization_and_dedup()
    check_revoked_decision()
    print("check_session_log: OK")


if __name__ == "__main__":
    asyncio.run(main())
