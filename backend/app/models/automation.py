import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class AutomationConfig(Base):
    __tablename__ = "automation_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    broker_connection_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False)

    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)

    min_confidence: Mapped[float] = mapped_column(Float, default=0.60)
    max_position_size_usd: Mapped[float | None] = mapped_column(Float)
    max_position_pct: Mapped[float] = mapped_column(Float, default=0.10)   # 10% of portfolio per trade
    stop_loss_pct: Mapped[float] = mapped_column(Float, default=0.02)       # 2%
    take_profit_pct: Mapped[float] = mapped_column(Float, default=0.04)     # 4%
    max_daily_loss_usd: Mapped[float | None] = mapped_column(Float)
    max_open_positions: Mapped[int] = mapped_column(Integer, default=5)
    cooldown_minutes: Mapped[int] = mapped_column(Integer, default=60)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    broker_connection_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("broker_connections.id"), nullable=False)
    signal_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("signals.id"))

    broker_order_id: Mapped[str | None] = mapped_column(String(255))
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    order_type: Mapped[str] = mapped_column(String(20), nullable=False, default="market")
    side: Mapped[str] = mapped_column(String(10), nullable=False)        # buy | sell
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    limit_price: Mapped[float | None] = mapped_column(Float)
    stop_price: Mapped[float | None] = mapped_column(Float)
    take_profit_price: Mapped[float | None] = mapped_column(Float)

    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    filled_quantity: Mapped[float] = mapped_column(Float, default=0.0)
    avg_fill_price: Mapped[float | None] = mapped_column(Float)
    commission: Mapped[float | None] = mapped_column(Float)

    is_automated: Mapped[bool] = mapped_column(Boolean, default=False)
    rejection_reason: Mapped[str | None] = mapped_column(Text)

    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    filled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
