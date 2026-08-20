"""Async Zammad REST API client."""
from __future__ import annotations
import httpx
from fastapi import HTTPException, status

from app.config import settings


class ZammadClient:
    def __init__(self):
        self._base = settings.zammad_base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Token token={settings.zammad_api_token}",
            "Content-Type": "application/json",
        }

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self._base, headers=self._headers, timeout=30)

    async def authenticate(self, login: str, password: str) -> dict | None:
        """Validate credentials against Zammad and return user data."""
        try:
            async with httpx.AsyncClient(base_url=self._base, timeout=15) as c:
                # expand=true so `roles` is populated; without it Zammad returns roles: None
                # and _map_role would fall through to the group-permission heuristic.
                r = await c.get("/api/v1/users/me?expand=true", auth=(login, password))
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Cannot reach Zammad at {self._base}: {exc}",
            ) from exc
        if r.status_code == 200:
            return r.json()
        return None

    async def get_tickets(self, page: int = 1, per_page: int = 50, updated_since: str | None = None) -> list[dict]:
        async with self._client() as c:
            params: dict = {"page": page, "per_page": per_page, "expand": "true"}
            if updated_since:
                params["query"] = f"updated_at:>{updated_since}"
            r = await c.get("/api/v1/tickets", params=params)
            r.raise_for_status()
            return r.json()

    async def get_all_tickets(self, per_page: int = 100, updated_since: str | None = None, max_pages: int = 1000) -> list[dict]:
        tickets: list[dict] = []
        async with self._client() as c:
            for page in range(1, max_pages + 1):
                params: dict = {"page": page, "per_page": per_page, "expand": "true"}
                if updated_since:
                    params["query"] = f"updated_at:>{updated_since}"
                r = await c.get("/api/v1/tickets", params=params)
                r.raise_for_status()
                rows = r.json()
                tickets.extend(rows)

                total_pages = r.headers.get("x-total-pages")
                if not rows or len(rows) < per_page or (total_pages and page >= int(total_pages)):
                    return tickets

        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Zammad ticket pagination exceeded max_pages")

    async def get_ticket(self, ticket_id: int) -> dict:
        async with self._client() as c:
            r = await c.get(f"/api/v1/tickets/{ticket_id}?expand=true")
            r.raise_for_status()
            return r.json()

    async def get_ticket_articles(self, ticket_id: int) -> list[dict]:
        async with self._client() as c:
            r = await c.get(f"/api/v1/ticket_articles/by_ticket/{ticket_id}?expand=true")
            r.raise_for_status()
            return r.json()

    async def get_ticket_history(self, ticket_id: int) -> list[dict] | dict:
        async with self._client() as c:
            for path in (
                f"/api/v1/ticket_history/{ticket_id}",
                f"/api/v1/ticket_histories/by_ticket/{ticket_id}",
                f"/api/v1/tickets/{ticket_id}/history",
            ):
                r = await c.get(path)
                if r.status_code != 404:
                    r.raise_for_status()
                    return r.json()
        return []

    async def get_users(self, page: int = 1, per_page: int = 200) -> list[dict]:
        async with self._client() as c:
            r = await c.get("/api/v1/users", params={"page": page, "per_page": per_page, "expand": "true"})
            r.raise_for_status()
            return r.json()

    async def get_user(self, user_id: int) -> dict:
        async with self._client() as c:
            r = await c.get(f"/api/v1/users/{user_id}?expand=true")
            r.raise_for_status()
            return r.json()

    async def get_groups(self) -> list[dict]:
        async with self._client() as c:
            r = await c.get("/api/v1/groups?expand=true")
            r.raise_for_status()
            return r.json()

    async def get_sla_policies(self) -> list[dict]:
        async with self._client() as c:
            r = await c.get("/api/v1/slas?expand=true")
            r.raise_for_status()
            return r.json()

    async def health_check(self) -> bool:
        try:
            async with self._client() as c:
                r = await c.get("/api/v1/users/me")
                return r.status_code == 200
        except Exception:
            return False


zammad = ZammadClient()
