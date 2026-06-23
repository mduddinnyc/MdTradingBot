"""market data tables: symbols, candles, watchlists

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "symbols",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("name", sa.String(255)),
        sa.Column("asset_class", sa.String(50), nullable=False, server_default="equity"),
        sa.Column("exchange", sa.String(20)),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
    )
    op.create_index("ix_symbols_ticker", "symbols", ["ticker"], unique=True)

    op.create_table(
        "candles",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("symbol_id", sa.Integer, sa.ForeignKey("symbols.id"), nullable=False),
        sa.Column("timeframe", sa.String(10), nullable=False),
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open", sa.Float, nullable=False),
        sa.Column("high", sa.Float, nullable=False),
        sa.Column("low", sa.Float, nullable=False),
        sa.Column("close", sa.Float, nullable=False),
        sa.Column("volume", sa.Float, nullable=False),
        sa.UniqueConstraint("symbol_id", "timeframe", "time", name="uq_candle_symbol_tf_time"),
    )
    op.create_index("ix_candles_symbol_tf_time", "candles", ["symbol_id", "timeframe", "time"])

    op.create_table(
        "watchlists",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "watchlist_items",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("watchlist_id", UUID(as_uuid=True), sa.ForeignKey("watchlists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("symbol_id", sa.Integer, sa.ForeignKey("symbols.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("watchlist_id", "symbol_id", name="uq_watchlist_symbol"),
    )


def downgrade() -> None:
    op.drop_table("watchlist_items")
    op.drop_table("watchlists")
    op.drop_table("candles")
    op.drop_table("symbols")
