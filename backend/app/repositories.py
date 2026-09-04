"""Data access helpers (write = upsert, read = select)."""
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db_models import (
    AlertRuleRow,
    ChannelRow,
    GroupRow,
    NotificationRow,
    SettingRow,
    TicketArticleRow,
    TicketHistoryRow,
    TicketRow,
    UserRow,
)
from app.models import AlertRuleOut, ChannelConfigOut, GroupOut, NotificationOut, TicketArticleOut, TicketHistoryOut, TicketOut, UserOut


async def list_users(db: AsyncSession) -> list[UserRow]:
    return (await db.scalars(select(UserRow))).all()


async def list_groups(db: AsyncSession) -> list[GroupRow]:
    return (await db.scalars(select(GroupRow))).all()


async def list_tickets(db: AsyncSession) -> list[TicketRow]:
    return (await db.scalars(select(TicketRow))).all()


async def get_articles_for_ticket(db: AsyncSession, ticket_id: str) -> list[TicketArticleRow]:
    return (await db.scalars(
        select(TicketArticleRow).where(TicketArticleRow.ticket_id == ticket_id)
    )).all()


async def get_state_history(db: AsyncSession) -> list[TicketHistoryRow]:
    return (await db.scalars(
        select(TicketHistoryRow).where(TicketHistoryRow.attribute == "state")
    )).all()


async def upsert_history(db: AsyncSession, history: list[TicketHistoryOut]) -> None:
    for entry in history:
        await _upsert(db, TicketHistoryRow, entry.model_dump())


async def get_setting(db: AsyncSession, key: str) -> dict | None:
    row = await db.get(SettingRow, key)
    return row.value if row else None


async def set_setting(db: AsyncSession, key: str, value: dict) -> None:
    await db.merge(SettingRow(key=key, value=value))
    await db.commit()


async def upsert_user(db: AsyncSession, user: UserOut) -> None:
    await _upsert(db, UserRow, user.model_dump(mode="json"))
    await db.commit()


async def upsert_users(db: AsyncSession, users: list[UserOut]) -> None:
    for user in users:
        await _upsert(db, UserRow, user.model_dump(mode="json"))
    await db.commit()


async def upsert_group(db: AsyncSession, group: GroupOut) -> None:
    await _upsert(db, GroupRow, group.model_dump(mode="json"))
    await db.commit()


async def upsert_groups(db: AsyncSession, groups: list[GroupOut]) -> None:
    for group in groups:
        await _upsert(db, GroupRow, group.model_dump(mode="json"))
    await db.commit()


async def upsert_ticket(db: AsyncSession, ticket: TicketOut) -> None:
    await _upsert(db, TicketRow, ticket.model_dump())
    await db.commit()


async def upsert_tickets(db: AsyncSession, tickets: list[TicketOut]) -> None:
    for ticket in tickets:
        await _upsert(db, TicketRow, ticket.model_dump())
    await db.commit()


async def upsert_articles(db: AsyncSession, articles: list[TicketArticleOut]) -> None:
    for article in articles:
        await _upsert(db, TicketArticleRow, article.model_dump())
    await db.commit()


async def list_alert_rules(db: AsyncSession) -> list[dict]:
    rows = (await db.scalars(select(AlertRuleRow).order_by(AlertRuleRow.created_at.desc()))).all()
    return [_alert_dict(row) for row in rows]


async def save_alert_rule(db: AsyncSession, rule: AlertRuleOut) -> dict:
    data = rule.model_dump()
    await _upsert(db, AlertRuleRow, data)
    await db.commit()
    return AlertRuleOut(**data).model_dump(mode="json")


async def update_alert_rule(db: AsyncSession, rule_id: str, patch: dict) -> dict | None:
    row = await db.get(AlertRuleRow, rule_id)
    if not row:
        return None
    for key, value in patch.items():
        if hasattr(row, key):
            setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    return _alert_dict(row)


async def delete_alert_rule(db: AsyncSession, rule_id: str) -> None:
    await db.execute(delete(AlertRuleRow).where(AlertRuleRow.id == rule_id))
    await db.commit()


async def list_notifications(db: AsyncSession, user_id: str) -> list[dict]:
    rows = (await db.scalars(
        select(NotificationRow).where(NotificationRow.user_id == user_id).order_by(NotificationRow.created_at.desc())
    )).all()
    return [_notification_dict(row) for row in rows]


async def mark_notification_read(db: AsyncSession, user_id: str, notif_id: str) -> None:
    row = await db.get(NotificationRow, notif_id)
    if row and row.user_id == user_id:
        row.status = "read"
        row.read_at = datetime.now(timezone.utc)
        await db.commit()


async def mark_all_notifications_read(db: AsyncSession, user_id: str) -> None:
    rows = (await db.scalars(select(NotificationRow).where(NotificationRow.user_id == user_id))).all()
    now = datetime.now(timezone.utc)
    for row in rows:
        row.status = "read"
        row.read_at = row.read_at or now
    await db.commit()


async def list_channels(db: AsyncSession, user_id: str) -> list[dict]:
    rows = (await db.scalars(select(ChannelRow).where(ChannelRow.user_id == user_id))).all()
    return [_channel_dict(row) for row in rows]


async def upsert_channel(db: AsyncSession, user_id: str, data: dict) -> dict:
    channel = ChannelConfigOut(**data)
    row = ChannelRow(user_id=user_id, **channel.model_dump())
    await db.merge(row)
    await db.commit()
    return channel.model_dump(mode="json")


async def _upsert(db: AsyncSession, model: type, data: dict) -> None:
    stmt = insert(model).values(**data)
    await db.execute(stmt.on_conflict_do_update(index_elements=["id"], set_={k: stmt.excluded[k] for k in data if k != "id"}))


def _alert_dict(row: AlertRuleRow) -> dict:
    return AlertRuleOut(
        id=row.id,
        name=row.name,
        scope_type=row.scope_type,
        scope_id=row.scope_id,
        scope_label=row.scope_label,
        condition_type=row.condition_type,
        condition_params=row.condition_params,
        channels=row.channels,
        is_active=row.is_active,
        cooldown_mins=row.cooldown_mins,
        created_at=row.created_at,
    ).model_dump(mode="json")


def _notification_dict(row: NotificationRow) -> dict:
    return NotificationOut(
        id=row.id,
        rule_name=row.rule_name,
        ticket_id=row.ticket_id,
        ticket_number=row.ticket_number,
        channel=row.channel,
        status=row.status,
        message=row.message,
        created_at=row.created_at,
        read_at=row.read_at,
    ).model_dump(mode="json")


def _channel_dict(row: ChannelRow) -> dict:
    return ChannelConfigOut(
        id=row.id,
        channel_type=row.channel_type,
        label=row.label,
        config=row.config,
        is_active=row.is_active,
        verified_at=row.verified_at,
    ).model_dump(mode="json")
