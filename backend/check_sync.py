#!/usr/bin/env python
"""Runnable self-check: runs a full Zammad -> PostgreSQL sync and verifies counts.

Usage:
    docker compose exec api python check_sync.py
"""
import asyncio
import sys

from sqlalchemy import func, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.db_models import GroupRow, TicketRow, UserRow
from app.tasks import run_full_sync


async def main():
    database = make_url(settings.database_url)
    print(f"[check_sync] Using DB: {database.host}/{database.database}")
    print(f"[check_sync] Using Zammad: {settings.zammad_base_url}")

    try:
        result = await run_full_sync()
    except Exception as e:
        print(f"[check_sync] FAILED: {e}")
        sys.exit(1)

    print(f"[check_sync] Sync result: {result}")

    # Verify counts by querying the DB directly
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as session:
        users = (await session.execute(select(func.count()).select_from(UserRow))).scalar()
        groups = (await session.execute(select(func.count()).select_from(GroupRow))).scalar()
        tickets = (await session.execute(select(func.count()).select_from(TicketRow))).scalar()
        coverage = (await session.execute(
            select(GroupRow.id, GroupRow.name, func.count(TicketRow.id))
            .outerjoin(TicketRow, TicketRow.group_id == GroupRow.id)
            .group_by(GroupRow.id, GroupRow.name)
            .order_by(func.count(TicketRow.id).desc(), GroupRow.id)
        )).all()

    print(f"[check_sync] DB counts: users={users}, groups={groups}, tickets={tickets}")

    if users == 0 or groups == 0 or tickets == 0:
        print("[check_sync] FAIL: Expected non-zero counts after full sync")
        await engine.dispose()
        sys.exit(1)

    for group_id, name, count in coverage:
        print(f"[check_sync] Group {group_id} ({name or 'Unknown'}): {count} tickets")
    zero_ticket_groups = [(group_id, name) for group_id, name, count in coverage if count == 0]
    if zero_ticket_groups:
        labels = ", ".join(f"{group_id} ({name or 'Unknown'})" for group_id, name in zero_ticket_groups)
        print(f"[check_sync] Zero-ticket groups: {labels}")
    if len(coverage) > 1 and len([count for _, _, count in coverage if count > 0]) == 1:
        print("[check_sync] WARNING: Synchronized tickets represent only one group. This may indicate API-token scope restrictions; it does not prove unseen upstream records exist.")

    print("[check_sync] OK: All tables have rows")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())