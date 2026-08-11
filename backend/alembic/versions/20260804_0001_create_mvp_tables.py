"""create mvp tables

Revision ID: 20260804_0001
Revises:
Create Date: 2026-08-04
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260804_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("zammad_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("firstname", sa.String(length=100), nullable=False),
        sa.Column("lastname", sa.String(length=100), nullable=False),
        sa.Column("login", sa.String(length=100), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False),
        sa.Column("group_ids", postgresql.JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "groups",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("agent_count", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "tickets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("zammad_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("number", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("state", sa.String(length=50), nullable=False),
        sa.Column("priority", sa.String(length=50), nullable=False),
        sa.Column("group_id", sa.String(), nullable=False),
        sa.Column("group_name", sa.String(length=255), nullable=False),
        sa.Column("owner_id", sa.String()),
        sa.Column("owner_name", sa.String(length=255)),
        sa.Column("customer_name", sa.String(length=255), nullable=False),
        sa.Column("tags", postgresql.JSONB(), nullable=False),
        sa.Column("sla_status", sa.String(length=50), nullable=False),
        sa.Column("first_response_remaining_secs", sa.Integer()),
        sa.Column("first_response_breached", sa.Boolean(), nullable=False),
        sa.Column("close_breached", sa.Boolean(), nullable=False),
        sa.Column("reopen_count", sa.Integer(), nullable=False),
        sa.Column("first_reply_time_secs", sa.Integer()),
        sa.Column("resolution_time_secs", sa.Integer()),
        sa.Column("zammad_created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("zammad_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "ticket_articles",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("ticket_id", sa.String(), nullable=False),
        sa.Column("author_name", sa.String(length=255), nullable=False),
        sa.Column("author_role", sa.String(length=50), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("internal", sa.Boolean(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "alert_rules",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("scope_type", sa.String(length=50), nullable=False),
        sa.Column("scope_id", sa.String()),
        sa.Column("scope_label", sa.String(length=255), nullable=False),
        sa.Column("condition_type", sa.String(length=100), nullable=False),
        sa.Column("condition_params", postgresql.JSONB(), nullable=False),
        sa.Column("channels", postgresql.JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("cooldown_mins", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("rule_name", sa.String(length=255), nullable=False),
        sa.Column("ticket_id", sa.String()),
        sa.Column("ticket_number", sa.String(length=50)),
        sa.Column("channel", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_table(
        "channels",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("channel_type", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("config", postgresql.JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_channels_user_id", "channels", ["user_id"])
    op.create_table(
        "settings",
        sa.Column("key", sa.String(length=100), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("settings")
    op.drop_index("ix_channels_user_id", table_name="channels")
    op.drop_table("channels")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
    op.drop_table("alert_rules")
    op.drop_table("ticket_articles")
    op.drop_table("tickets")
    op.drop_table("groups")
    op.drop_table("users")
