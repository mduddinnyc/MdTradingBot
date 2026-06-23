import uuid
from datetime import datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class Symbol(Base):
    __tablename__ = "symbols"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(255))
    asset_class: Mapped[str] = mapped_column(String(50), default="equity")
    exchange: Mapped[str | None] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    candles: Mapped[list["Candle"]] = relationship("Candle", back_populates="symbol")
    signals: Mapped[list["Signal"]] = relationship("Signal", back_populates="symbol")  # type: ignore[name-defined]


class Candle(Base):
    __tablename__ = "candles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol_id: Mapped[int] = mapped_column(Integer, ForeignKey("symbols.id"), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(10), nullable=False)
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[float] = mapped_column(Float, nullable=False)

    symbol: Mapped["Symbol"] = relationship("Symbol", back_populates="candles")

    __table_args__ = (
        UniqueConstraint("symbol_id", "timeframe", "time", name="uq_candle_symbol_tf_time"),
        Index("ix_candles_symbol_tf_time", "symbol_id", "timeframe", "time"),
    )


class Watchlist(Base):
    __tablename__ = "watchlists"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    items: Mapped[list["WatchlistItem"]] = relationship("WatchlistItem", back_populates="watchlist", cascade="all, delete-orphan")


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    watchlist_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("watchlists.id", ondelete="CASCADE"), nullable=False)
    symbol_id: Mapped[int] = mapped_column(Integer, ForeignKey("symbols.id", ondelete="CASCADE"), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    watchlist: Mapped["Watchlist"] = relationship("Watchlist", back_populates="items")
    symbol: Mapped["Symbol"] = relationship("Symbol")

    __table_args__ = (
        UniqueConstraint("watchlist_id", "symbol_id", name="uq_watchlist_symbol"),
    )


class IVHistory(Base):
    """Daily implied-volatility snapshot — used to compute IV Rank and IV Percentile."""
    __tablename__ = "iv_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    date: Mapped[datetime] = mapped_column(Date, nullable=False)
    iv_30d: Mapped[float | None] = mapped_column(Float)    # 30-day ATM IV
    iv_rank: Mapped[float | None] = mapped_column(Float)   # 0-100 rank vs 52-week range
    iv_pct: Mapped[float | None] = mapped_column(Float)    # 0-100 percentile

    __table_args__ = (
        UniqueConstraint("ticker", "date", name="uq_iv_ticker_date"),
        Index("ix_iv_ticker_date", "ticker", "date"),
    )
