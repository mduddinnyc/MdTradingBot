"""strategies catalog + user_strategy_configs + signals.strategy_id

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-26
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, UUID

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Same indicators signal_engine.py always computed — these are just
# different weightings of trend/momentum/pattern plus a regime gate,
# not new indicator math. "balanced" reproduces today's exact module
# constants (W_TREND=0.40, W_MOMENTUM=0.35, W_PATTERN=0.25, any regime)
# so existing behavior is one named strategy among several, not replaced.
STRATEGIES = [
    {
        "key": "balanced",
        "name": "Balanced",
        "description": "Today's default weighting — trend, momentum, and pattern contribute roughly equally. Works in any market regime.",
        "w_trend": 0.40, "w_momentum": 0.35, "w_pattern": 0.25,
        "allowed_regimes": None, "min_volume_ratio": None,
    },
    {
        "key": "trend_following",
        "name": "Trend Following",
        "description": "Leans hard on EMA/VWAP/ADX trend strength. Only trades in a confirmed trending_bull or trending_bear regime — sits out sideways chop entirely.",
        "w_trend": 0.60, "w_momentum": 0.25, "w_pattern": 0.15,
        "allowed_regimes": ["trending_bull", "trending_bear"], "min_volume_ratio": None,
    },
    {
        "key": "mean_reversion",
        "name": "Mean Reversion",
        "description": "Leans on RSI extremes, Bollinger %B, and reversal candlestick patterns. Only trades sideways/range-bound regimes — skips trending markets where fading momentum is dangerous.",
        "w_trend": 0.15, "w_momentum": 0.55, "w_pattern": 0.30,
        "allowed_regimes": ["sideways"], "min_volume_ratio": None,
    },
    {
        "key": "momentum_breakout",
        "name": "Momentum Breakout",
        "description": "Trend + momentum with a hard volume-confirmation gate — won't fire unless current volume is at least 1.5x the 20-period average, so it skips breakouts nobody's actually trading.",
        "w_trend": 0.35, "w_momentum": 0.45, "w_pattern": 0.20,
        "allowed_regimes": None, "min_volume_ratio": 1.5,
    },
]


def upgrade() -> None:
    op.create_table(
        "strategies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(40), nullable=False, unique=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("w_trend", sa.Float(), nullable=False),
        sa.Column("w_momentum", sa.Float(), nullable=False),
        sa.Column("w_pattern", sa.Float(), nullable=False),
        sa.Column("allowed_regimes", ARRAY(sa.String()), nullable=True),
        sa.Column("min_volume_ratio", sa.Float(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "user_strategy_configs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("broker_connection_id", UUID(as_uuid=True), sa.ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("strategy_id", UUID(as_uuid=True), sa.ForeignKey("strategies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("mode", sa.String(10), nullable=False, server_default="manual"),
        sa.Column("allocated_capital_usd", sa.Float(), nullable=False, server_default="1000"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "broker_connection_id", "strategy_id", name="uq_user_conn_strategy"),
    )

    op.add_column("signals", sa.Column("strategy_id", UUID(as_uuid=True), sa.ForeignKey("strategies.id"), nullable=True))

    strategies_table = sa.table(
        "strategies",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("key", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.Text),
        sa.column("w_trend", sa.Float),
        sa.column("w_momentum", sa.Float),
        sa.column("w_pattern", sa.Float),
        sa.column("allowed_regimes", ARRAY(sa.String())),
        sa.column("min_volume_ratio", sa.Float),
    )
    op.bulk_insert(strategies_table, [{**s, "id": uuid.uuid4()} for s in STRATEGIES])


def downgrade() -> None:
    op.drop_column("signals", "strategy_id")
    op.drop_table("user_strategy_configs")
    op.drop_table("strategies")
