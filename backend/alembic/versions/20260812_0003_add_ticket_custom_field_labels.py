"""add ticket custom field labels

Revision ID: 20260812_0003
Revises: 20260812_0002
Create Date: 2026-08-12
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260812_0003"
down_revision: str | None = "20260812_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tickets", sa.Column("severity_label", sa.String(length=255)))
    op.add_column("tickets", sa.Column("ticket_category_label", sa.String(length=255)))


def downgrade() -> None:
    op.drop_column("tickets", "ticket_category_label")
    op.drop_column("tickets", "severity_label")
