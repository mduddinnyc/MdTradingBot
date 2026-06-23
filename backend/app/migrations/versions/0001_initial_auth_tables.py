"""initial auth tables

Revision ID: 0001
Revises:
Create Date: 2026-05-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255)),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("is_verified", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("totp_secret_enc", sa.Text),
        sa.Column("totp_enabled", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("subscription_tier", sa.String(50), nullable=False, server_default="free"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "user_sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("refresh_token_hash", sa.String(255), nullable=False),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("user_agent", sa.Text),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
    op.create_index("ix_user_sessions_token_hash", "user_sessions", ["refresh_token_hash"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("actor_type", sa.Enum("user", "system", "automation", name="actor_type_enum"), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(50)),
        sa.Column("resource_id", sa.String(255)),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("user_agent", sa.Text),
        sa.Column("metadata", JSONB, server_default="{}"),
        sa.Column("outcome", sa.Enum("success", "failure", "blocked", name="outcome_enum"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_audit_logs_user_id_created", "audit_logs", ["user_id", "created_at"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])

    # Prevent UPDATE/DELETE on audit_logs at DB level
    op.execute("""
        CREATE RULE audit_log_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING
    """)
    op.execute("""
        CREATE RULE audit_log_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING
    """)


def downgrade() -> None:
    op.execute("DROP RULE IF EXISTS audit_log_no_delete ON audit_logs")
    op.execute("DROP RULE IF EXISTS audit_log_no_update ON audit_logs")
    op.drop_table("audit_logs")
    op.drop_table("user_sessions")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS outcome_enum")
    op.execute("DROP TYPE IF EXISTS actor_type_enum")
