"""Auth router — JWT login via Zammad proxy auth."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import cache_set
from app.deps import create_token, get_current_user, get_db
from app.models import LoginRequest, Role, TokenResponse, UserOut
from app.repositories import upsert_user
from app.zammad_client import zammad

router = APIRouter()


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
async def login(body: LoginRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    zammad_user = await zammad.authenticate(body.login, body.password)
    if not zammad_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    role = _map_role(zammad_user)
    user = _map_user(zammad_user, role)
    token = create_token(user.id, role, user.group_ids)
    await upsert_user(db, user)

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
