from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db import Base


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    zammad_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    firstname: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    lastname: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    login: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    group_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class GroupRow(Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    note: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    agent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TicketRow(Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    zammad_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    number: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    state: Mapped[str] = mapped_column(String(50), nullable=False)
    priority: Mapped[str] = mapped_column(String(50), nullable=False)
    priority_id: Mapped[str] = mapped_column(String, nullable=False, default="")
    state_id: Mapped[str] = mapped_column(String, nullable=False, default="")
    severity: Mapped[str | None] = mapped_column(String(255))
    severity_label: Mapped[str | None] = mapped_column(String(255))
    ticket_category: Mapped[str | None] = mapped_column(String(255))
    ticket_category_label: Mapped[str | None] = mapped_column(String(255))
    group_id: Mapped[str] = mapped_column(String, nullable=False, default="")
    group_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    owner_id: Mapped[str | None] = mapped_column(String)
    owner_name: Mapped[str | None] = mapped_column(String(255))
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    sla_status: Mapped[str] = mapped_column(String(50), nullable=False)
    escalation_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_response_escalation_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_response_in_min: Mapped[int | None] = mapped_column(Integer)
    first_response_diff_in_min: Mapped[int | None] = mapped_column(Integer)
    close_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    close_escalation_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    close_in_min: Mapped[int | None] = mapped_column(Integer)
    close_diff_in_min: Mapped[int | None] = mapped_column(Integer)
    update_escalation_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    update_diff_in_min: Mapped[int | None] = mapped_column(Integer)
    first_response_remaining_secs: Mapped[int | None] = mapped_column(Integer)
    first_response_breached: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    close_breached: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reopen_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    first_reply_time_secs: Mapped[int | None] = mapped_column(Integer)
    resolution_time_secs: Mapped[int | None] = mapped_column(Integer)
    zammad_created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    zammad_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TicketArticleRow(Base):
    __tablename__ = "ticket_articles"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String, nullable=False)
    author_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    author_role: Mapped[str] = mapped_column(String(50), nullable=False, default="agent")
    type: Mapped[str] = mapped_column(String(50), nullable=False, default="note")
    internal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TicketHistoryRow(Base):
    __tablename__ = "ticket_history"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    attribute: Mapped[str | None] = mapped_column(String(100))
    value_from: Mapped[str | None] = mapped_column(Text)
    value_to: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AlertRuleRow(Base):
    __tablename__ = "alert_rules"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    scope_type: Mapped[str] = mapped_column(String(50), nullable=False, default="global")
    scope_id: Mapped[str | None] = mapped_column(String)
    scope_label: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    condition_type: Mapped[str] = mapped_column(String(100), nullable=False)
    condition_params: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    channels: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    cooldown_mins: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class NotificationRow(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    rule_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    ticket_id: Mapped[str | None] = mapped_column(String)
    ticket_number: Mapped[str | None] = mapped_column(String(50))
    channel: Mapped[str] = mapped_column(String(50), nullable=False, default="in_app")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="unread")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChannelRow(Base):
    __tablename__ = "channels"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    channel_type: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    config: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SettingRow(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
