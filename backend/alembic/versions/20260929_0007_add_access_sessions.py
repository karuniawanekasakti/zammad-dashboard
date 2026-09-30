"""add access sessions and activity

Backs the hidden Session & Activity Log: one `access_sessions` row per login
(device identity = browser UA + IP + parsed label) and a de-duplicated
`session_activity` timeline per session. Lifecycle rows (`login`/`logout`) are
written server-side; route `view` events arrive from the client beacon.

Retention: neither table is pruned here. A 30-day cleanup job (PRD §5.3 Data
Retention) is out of scope for this change.

Revision ID: 20260929_0007
Revises: 20260916_0006
Create Date: 2026-09-29
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260929_0007"
down_revision: str | None = "20260916_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "access_sessions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("user_agent", sa.Text(), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=False),
        sa.Column("device_label", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("logout_at", sa.DateTime(timezone=True)),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_access_sessions_user_id", "access_sessions", ["user_id"])

    op.create_table(
        "session_activity",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), sa.ForeignKey("access_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("route", sa.String(length=500)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_session_activity_session_id", "session_activity", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_session_activity_session_id", table_name="session_activity")
    op.drop_table("session_activity")
    op.drop_index("ix_access_sessions_user_id", table_name="access_sessions")
    op.drop_table("access_sessions")
