import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class BrokerConnection(Base):
    __tablename__ = "broker_connections"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    broker_name: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))

    # Fernet-encrypted API key + secret stored as separate ciphertext columns.
    # In production replace with AWS Secrets Manager ARN.
    api_key_enc: Mapped[str] = mapped_column(Text, nullable=False)
    api_secret_enc: Mapped[str] = mapped_column(Text, nullable=False)

    # Alpaca account ID returned on first successful auth
    account_id: Mapped[str | None] = mapped_column(String(255))

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_paper: Mapped[bool] = mapped_column(Boolean, default=True)

    # {read: true, trade: true}
    permissions: Mapped[dict] = mapped_column(JSONB, default=dict)

    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship("User", back_populates="broker_connections")  # type: ignore[name-defined]

    __table_args__ = (
        Index("ix_broker_connections_user_id", "user_id"),
    )
