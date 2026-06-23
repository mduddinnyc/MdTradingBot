"""iv_history table for IV Rank calculation

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-19
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "iv_history",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("iv_30d", sa.Float(), nullable=True),
        sa.Column("iv_rank", sa.Float(), nullable=True),
        sa.Column("iv_pct", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ticker", "date", name="uq_iv_ticker_date"),
    )
    op.create_index("ix_iv_ticker_date", "iv_history", ["ticker", "date"])


def downgrade() -> None:
    op.drop_index("ix_iv_ticker_date", "iv_history")
    op.drop_table("iv_history")
