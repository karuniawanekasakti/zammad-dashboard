"""add sla monitor fields

Revision ID: 20260812_0004
Revises: 20260812_0003
Create Date: 2026-08-12
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260812_0004"
down_revision: str | None = "20260812_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


COLUMNS = (
    sa.Column("priority_id", sa.String(), nullable=False, server_default=""),
    sa.Column("state_id", sa.String(), nullable=False, server_default=""),
    sa.Column("escalation_at", sa.DateTime(timezone=True)),
    sa.Column("first_response_at", sa.DateTime(timezone=True)),
    sa.Column("first_response_escalation_at", sa.DateTime(timezone=True)),
    sa.Column("first_response_in_min", sa.Integer()),
    sa.Column("first_response_diff_in_min", sa.Integer()),
    sa.Column("close_at", sa.DateTime(timezone=True)),
    sa.Column("close_escalation_at", sa.DateTime(timezone=True)),
    sa.Column("close_in_min", sa.Integer()),
    sa.Column("close_diff_in_min", sa.Integer()),
    sa.Column("update_escalation_at", sa.DateTime(timezone=True)),
    sa.Column("update_diff_in_min", sa.Integer()),
)


def upgrade() -> None:
    for column in COLUMNS:
        op.add_column("tickets", column)


def downgrade() -> None:
    for column in reversed(COLUMNS):
        op.drop_column("tickets", column.name)
