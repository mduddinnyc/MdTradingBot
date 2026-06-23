"""options columns on orders + options_automation_configs table

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("asset_type", sa.String(10), nullable=False, server_default="equity"))
    op.add_column("orders", sa.Column("option_symbol", sa.String(40), nullable=True))
    op.add_column("orders", sa.Column("strike_price", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("expiration_date", sa.Date(), nullable=True))
    op.add_column("orders", sa.Column("option_right", sa.String(4), nullable=True))
    op.add_column("orders", sa.Column("premium_paid", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("closing_order_id", UUID(as_uuid=True), sa.ForeignKey("orders.id"), nullable=True))

    op.create_table(
        "options_automation_configs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("broker_connection_id", UUID(as_uuid=True), sa.ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("require_manual_approval", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("budget_usd", sa.Float(), nullable=False, server_default="10000"),
        sa.Column("min_confidence", sa.Float(), nullable=False, server_default="0.4"),
        sa.Column("max_contracts_per_trade", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("max_open_positions", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("target_dte_min", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("target_dte_max", sa.Integer(), nullable=False, server_default="21"),
        sa.Column("profit_target_pct", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("stop_loss_pct", sa.Float(), nullable=False, server_default="0.3"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("options_automation_configs")

    op.drop_column("orders", "closing_order_id")
    op.drop_column("orders", "premium_paid")
    op.drop_column("orders", "option_right")
    op.drop_column("orders", "expiration_date")
    op.drop_column("orders", "strike_price")
    op.drop_column("orders", "option_symbol")
    op.drop_column("orders", "asset_type")
