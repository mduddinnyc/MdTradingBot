"""broker connections table

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "broker_connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("broker_name", sa.String(50), nullable=False),
        sa.Column("display_name", sa.String(255)),
        sa.Column("api_key_enc", sa.Text, nullable=False),
        sa.Column("api_secret_enc", sa.Text, nullable=False),
        sa.Column("account_id", sa.String(255)),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("is_paper", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("permissions", JSONB, server_default="{}"),
        sa.Column("last_sync_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_broker_connections_user_id", "broker_connections", ["user_id"])


def downgrade() -> None:
    op.drop_table("broker_connections")
