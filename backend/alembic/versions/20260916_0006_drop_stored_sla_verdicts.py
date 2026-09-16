"""drop stored sla verdicts

The stored SLA verdict and remaining-time columns are derived and
time-relative, so they are wrong the moment they are written. The live verdict
is computed on read (see docs/adr/0001-sla-status-is-computed-on-read.md);
Zammad's own SLA facts are retained because they are evidence, not verdicts.

`sla_status` is NOT NULL with no server default, so the write path stops
supplying it in the same change that drops the column.

Revision ID: 20260916_0006
Revises: 20260904_0005
Create Date: 2026-09-16
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260916_0006"
down_revision: str | None = "20260904_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = ("first_response_remaining_secs", "sla_status")


def upgrade() -> None:
    for column in COLUMNS:
        op.drop_column("tickets", column)


def downgrade() -> None:
    # `sla_status` is restored NOT NULL with no default, as it was created in
    # 20260804_0001. Existing rows need a value while the column is added, so
    # it is added with a server default that is then dropped again.
    op.add_column("tickets", sa.Column("first_response_remaining_secs", sa.Integer()))
    op.add_column("tickets", sa.Column("sla_status", sa.String(length=50), nullable=False, server_default="no_sla"))
    op.alter_column("tickets", "sla_status", server_default=None)
