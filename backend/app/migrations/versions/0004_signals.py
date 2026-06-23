"""signals table

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "signals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("symbol_id", sa.Integer, sa.ForeignKey("symbols.id"), nullable=False),
        sa.Column("signal_type", sa.String(10), nullable=False),
        sa.Column("confidence", sa.Float, nullable=False),
        sa.Column("timeframe", sa.String(10), nullable=False),
        sa.Column("entry_price", sa.Float),
        sa.Column("target_price", sa.Float),
        sa.Column("stop_price", sa.Float),
        sa.Column("pattern_detected", sa.String(100)),
        sa.Column("indicators", JSONB, server_default="{}"),
        sa.Column("reasoning", sa.Text),
        sa.Column("model_version", sa.String(50), nullable=False, server_default="rule-v1"),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_signals_symbol_created", "signals", ["symbol_id", "created_at"])
    op.create_index("ix_signals_type_created", "signals", ["signal_type", "created_at"])


def downgrade() -> None:
    op.drop_table("signals")
