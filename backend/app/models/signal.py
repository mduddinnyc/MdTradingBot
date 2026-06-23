import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class Signal(Base):
    __tablename__ = "signals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    symbol_id: Mapped[int] = mapped_column(Integer, ForeignKey("symbols.id"), nullable=False)
    signal_type: Mapped[str] = mapped_column(String(10), nullable=False)   # BUY SELL HOLD
    confidence: Mapped[float] = mapped_column(Float, nullable=False)        # 0.0 – 1.0
    timeframe: Mapped[str] = mapped_column(String(10), nullable=False)

    entry_price: Mapped[float | None] = mapped_column(Float)
    target_price: Mapped[float | None] = mapped_column(Float)
    stop_price: Mapped[float | None] = mapped_column(Float)

    pattern_detected: Mapped[str | None] = mapped_column(String(100))
    indicators: Mapped[dict] = mapped_column(JSONB, default=dict)   # {rsi, macd, bb_pct, ...}
    reasoning: Mapped[str | None] = mapped_column(Text)             # human-readable why

    model_version: Mapped[str] = mapped_column(String(50), default="rule-v1")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    symbol: Mapped["Symbol"] = relationship("Symbol", back_populates="signals")  # type: ignore[name-defined]

    __table_args__ = (
        Index("ix_signals_symbol_created", "symbol_id", "created_at"),
        Index("ix_signals_type_created", "signal_type", "created_at"),
    )
