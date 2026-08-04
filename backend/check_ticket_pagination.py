from __future__ import annotations

import asyncio

import httpx

from app.zammad_client import ZammadClient


async def main() -> None:
    pages = {
        1: [{"id": 1}, {"id": 2}],
        2: [{"id": 3}, {"id": 4}],
        3: [{"id": 5}],
    }
    seen: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        seen.append(page)
        return httpx.Response(200, json=pages[page], headers={"x-total-pages": "3"})

    client = ZammadClient()
    client._client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://zammad.test")  # type: ignore[method-assign]

    tickets = await client.get_all_tickets(per_page=2)
    assert [t["id"] for t in tickets] == [1, 2, 3, 4, 5]
    assert seen == [1, 2, 3]


if __name__ == "__main__":
    asyncio.run(main())
