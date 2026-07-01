"""Add expires_at to user_strategy_configs

Revision ID: 0010
Revises: 0009
Create Date: 2026-06-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_strategy_configs",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_strategy_configs", "expires_at")
