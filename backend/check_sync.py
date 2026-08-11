#!/usr/bin/env python
"""Runnable self-check: runs a full Zammad -> PostgreSQL sync and verifies counts.

Usage:
    docker compose exec api python check_sync.py
"""
import asyncio
import sys

from app.config import settings
from app.db_models import GroupRow, TicketRow, UserRow
from app.tasks import run_full_sync


async def main():
    print(f"[check_sync] Using DB: {settings.database_url}")
    print(f"[check_sync] Using Zammad: {settings.zammad_base_url}")

    try:
        result = await run_full_sync()
    except Exception as e:
        print(f"[check_sync] FAILED: {e}")
        sys.exit(1)

    print(f"[check_sync] Sync result: {result}")

    # Verify counts by querying the DB directly
    from sqlalchemy import func, select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as session:
        users = (await session.execute(select(func.count()).select_from(UserRow))).scalar()
        groups = (await session.execute(select(func.count()).select_from(GroupRow))).scalar()
        tickets = (await session.execute(select(func.count()).select_from(TicketRow))).scalar()

    print(f"[check_sync] DB counts: users={users}, groups={groups}, tickets={tickets}")

    if users == 0 or groups == 0 or tickets == 0:
        print("[check_sync] FAIL: Expected non-zero counts after full sync")
        sys.exit(1)

    print("[check_sync] OK: All tables have rows")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())