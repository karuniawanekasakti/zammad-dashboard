"""Auth router — JWT login via Zammad proxy auth."""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import cache_set
from app.deps import create_token, get_current_user, get_db
from app.models import AccessSessionOut, LoginRequest, Role, TokenResponse, UserOut
from app.repositories import create_access_session, upsert_user
from app.routers.internal import generate_session_id
from app.zammad_client import zammad

router = APIRouter()

ALLOWED_LOGIN = "helpdeskadmin@mti-tech.co.id"


def client_host(request: Request) -> str:
    """Direct socket peer address of the login request.

    The socket IP is used deliberately — not ``X-Forwarded-For`` — so a client
    cannot spoof the recorded IP with a header.
    """
    return request.client.host if request.client else ""

def _device_label(user_agent: str) -> str:
    """Parse a User-Agent string into a friendly "Browser on OS" label.

    Best-effort only; unknown/absent input degrades to "Unknown device" rather
    than failing the login.
    """
    ua = user_agent or ""

    browser = "Unknown browser"
    browser_markers = (
        ("Edg/", "Edge"),
        ("OPR/", "Opera"),
        ("Chrome/", "Chrome"),
        ("Firefox/", "Firefox"),
        ("Safari/", "Safari"),
    )
    for marker, name in browser_markers:
        if marker in ua:
            browser = name
            break
    else:
        if "curl/" in ua:
            browser = "curl"

    system = "Unknown OS"
    system_markers = (
        ("Windows", "Windows"),
        ("iPhone", "iPhone"),
        ("iPad", "iPad"),
        ("Android", "Android"),
        ("Mac OS X", "macOS"),
        ("Linux", "Linux"),
    )
    for marker, name in system_markers:
        if marker in ua:
            system = name
            break

    if browser == "Unknown browser" and system == "Unknown OS":
        return "Unknown device"
    return f"{browser} on {system}"


def _map_role(zammad_user: dict) -> Role:
    """Map Zammad roles/tags to internal role."""
    roles = [r.lower() if isinstance(r, str) else str(r.get("name", "")).lower() for r in zammad_user.get("roles") or []]
    if "admin" in roles:
        return Role.admin
    # Check for custom tag-based roles
    note = (zammad_user.get("note") or "").lower()
    if "team_lead" in note:
        return Role.team_lead
    if "project_manager" in note:
        return Role.project_manager
    group_perms = zammad_user.get("group_ids") or {}
    if isinstance(group_perms, dict) and any("full" in perms for perms in group_perms.values()):
        return Role.team_lead
    return Role.agent


def _map_user(z: dict, role: Role) -> UserOut:
    raw_groups = z.get("group_ids") or z.get("groups", {})
    group_ids = [str(g) for g in (raw_groups.keys() if isinstance(raw_groups, dict) else raw_groups or [])]
    return UserOut(
        id=str(z["id"]),
        zammad_id=z["id"],
        email=z.get("email", ""),
        firstname=z.get("firstname", ""),
        lastname=z.get("lastname", ""),
        login=z.get("login", ""),
        role=role,
        group_ids=group_ids,
        is_active=z.get("active", True),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: Annotated[AsyncSession, Depends(get_db)]):
    if body.login.lower() != ALLOWED_LOGIN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    zammad_user = await zammad.authenticate(body.login, body.password)
    if not zammad_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    role = _map_role(zammad_user)
    user = _map_user(zammad_user, role)
    await upsert_user(db, user)

    # Record the login session before minting the token, so a token can never
    # reference a session row that failed to persist.
    now = datetime.now(timezone.utc)
    user_agent = request.headers.get("user-agent", "")
    sid = generate_session_id()
    await create_access_session(
        db,
        AccessSessionOut(
            id=sid,
            user_id=user.id,
            device_label=_device_label(user_agent),
            ip=client_host(request),
            user_agent=user_agent,
            created_at=now,
            last_seen_at=now,
        ),
    )
    token = create_token(user.id, role, user.group_ids, sid=sid)

    # Redis remains a hot cache only.
    await cache_set(f"user:{user.id}", user.model_dump(mode="json"), ttl=3600)

    return TokenResponse(token=token, user=user)


@router.get("/me", response_model=UserOut)
async def me(current: Annotated[dict, Depends(get_current_user)]):
    from app.cache import cache_get
    cached = await cache_get(f"user:{current['sub']}")
    if cached:
        return UserOut(**cached)
    # Fallback: fetch from Zammad
    z = await zammad.get_user(int(current["sub"]))
    role = Role(current["role"])
    return _map_user(z, role)
