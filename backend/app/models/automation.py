import uuid
from datetime import datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
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

    # Options — null for equity orders (the only kind that existed before this).
    asset_type: Mapped[str] = mapped_column(String(10), nullable=False, default="equity")  # "equity" | "option"
    option_symbol: Mapped[str | None] = mapped_column(String(40))   # real OCC symbol from the broker's chain, never hand-built
    strike_price: Mapped[float | None] = mapped_column(Float)
    expiration_date: Mapped[datetime | None] = mapped_column(Date)
    option_right: Mapped[str | None] = mapped_column(String(4))     # "call" | "put"
    premium_paid: Mapped[float | None] = mapped_column(Float)       # per-contract premium at fill/staging time
    closing_order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"))

    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    filled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Strategy(Base):
    """
    System-seeded catalog of named signal-fusion profiles — same
    indicators signal_engine.py always computed (RSI/MACD/BB%/EMA/ADX/
    volume/VWAP/patterns/regime), just different weights and a regime
    gate per strategy instead of one fixed weighting. See seed data in
    migration 0009. `is_system=False` is reserved for future user-defined
    strategies; nothing creates those yet.
    """
    __tablename__ = "strategies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    w_trend: Mapped[float] = mapped_column(Float, nullable=False)
    w_momentum: Mapped[float] = mapped_column(Float, nullable=False)
    w_pattern: Mapped[float] = mapped_column(Float, nullable=False)
    allowed_regimes: Mapped[list[str] | None] = mapped_column(ARRAY(String))  # null = any regime
    min_volume_ratio: Mapped[float | None] = mapped_column(Float)             # extra gate, e.g. breakout needs volume confirmation

    is_system: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserStrategyConfig(Base):
    """Per-user enablement of a Strategy — gated by the parent
    AutomationConfig.is_enabled, which stays the account-wide safety rail
    (daily loss cap, PDT, max open positions, cooldown). This table only
    controls which strategies are allowed to fire and how much capital
    each gets, on top of that."""
    __tablename__ = "user_strategy_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    broker_connection_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False)
    strategy_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("strategies.id", ondelete="CASCADE"), nullable=False)

    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mode: Mapped[str] = mapped_column(String(10), nullable=False, default="manual")  # "auto" | "manual"
    allocated_capital_usd: Mapped[float] = mapped_column(Float, nullable=False, default=1000.0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # null = run forever

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OptionsAutomationConfig(Base):
    """Paper-trading-only options automation, gated behind manual approval
    by default (require_manual_approval) — see options_execution.py."""
    __tablename__ = "options_automation_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    broker_connection_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("broker_connections.id", ondelete="CASCADE"), nullable=False)

    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    require_manual_approval: Mapped[bool] = mapped_column(Boolean, default=True)

    budget_usd: Mapped[float] = mapped_column(Float, default=10_000.0)
    min_confidence: Mapped[float] = mapped_column(Float, default=0.40)
    max_contracts_per_trade: Mapped[int] = mapped_column(Integer, default=1)
    max_open_positions: Mapped[int] = mapped_column(Integer, default=5)
    target_dte_min: Mapped[int] = mapped_column(Integer, default=7)
    target_dte_max: Mapped[int] = mapped_column(Integer, default=21)
    profit_target_pct: Mapped[float] = mapped_column(Float, default=0.50)   # +50% premium
    stop_loss_pct: Mapped[float] = mapped_column(Float, default=0.30)       # -30% premium

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
