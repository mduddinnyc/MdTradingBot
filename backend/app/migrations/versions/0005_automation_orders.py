"""automation configs and orders tables

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "automation_configs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("broker_connection_id", UUID(as_uuid=True), sa.ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_enabled", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("min_confidence", sa.Float, nullable=False, server_default="0.60"),
        sa.Column("max_position_size_usd", sa.Float),
        sa.Column("max_position_pct", sa.Float, nullable=False, server_default="0.10"),
        sa.Column("stop_loss_pct", sa.Float, nullable=False, server_default="0.02"),
        sa.Column("take_profit_pct", sa.Float, nullable=False, server_default="0.04"),
        sa.Column("max_daily_loss_usd", sa.Float),
        sa.Column("max_open_positions", sa.Integer, nullable=False, server_default="5"),
        sa.Column("cooldown_minutes", sa.Integer, nullable=False, server_default="60"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "orders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("broker_connection_id", UUID(as_uuid=True), sa.ForeignKey("broker_connections.id"), nullable=False),
        sa.Column("signal_id", UUID(as_uuid=True), sa.ForeignKey("signals.id")),
        sa.Column("broker_order_id", sa.String(255)),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("order_type", sa.String(20), nullable=False, server_default="market"),
        sa.Column("side", sa.String(10), nullable=False),
        sa.Column("quantity", sa.Float, nullable=False),
        sa.Column("limit_price", sa.Float),
        sa.Column("stop_price", sa.Float),
        sa.Column("take_profit_price", sa.Float),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("filled_quantity", sa.Float, server_default="0"),
        sa.Column("avg_fill_price", sa.Float),
        sa.Column("commission", sa.Float),
        sa.Column("is_automated", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("rejection_reason", sa.Text),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("filled_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_orders_user_created", "orders", ["user_id", "created_at"])
    op.create_index("ix_orders_broker_order_id", "orders", ["broker_order_id"])


def downgrade() -> None:
    op.drop_table("orders")
    op.drop_table("automation_configs")
