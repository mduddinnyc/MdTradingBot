"""Add max_trades_per_day to automation_configs

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "automation_configs",
        sa.Column("max_trades_per_day", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("automation_configs", "max_trades_per_day")
