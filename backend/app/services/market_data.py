"""
Market data worker.
Fetches OHLCV bars from Alpaca for all watchlisted symbols,
upserts into candles table, then triggers signal generation.
Called by APScheduler every N minutes (per timeframe).
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.broker import BrokerConnection
from app.models.market import Candle, Symbol, Watchlist, WatchlistItem
from app.services.broker_adapter import get_adapter

log = logging.getLogger(__name__)

TIMEFRAMES = ["5Min", "15Min", "1Hour", "1Day"]


async def get_or_create_symbol(db: AsyncSession, ticker: str) -> Symbol:
    result = await db.execute(select(Symbol).where(Symbol.ticker == ticker))
    symbol = result.scalar_one_or_none()
    if not symbol:
        symbol = Symbol(ticker=ticker)
        db.add(symbol)
        await db.flush()
    return symbol


async def fetch_and_store_bars(
    db: AsyncSession,
    conn: BrokerConnection,
    ticker: str,
    timeframe: str = "1Hour",
    limit: int = 100,
) -> int:
    """Fetch bars from Alpaca and upsert into candles. Returns count stored."""
    symbol = await get_or_create_symbol(db, ticker)
    bars = get_adapter(conn.broker_name).get_bars(conn, ticker, timeframe, limit)

    if not bars:
        return 0

    rows = [
        {
            "symbol_id": symbol.id,
            "timeframe": timeframe,
            "time": datetime.fromisoformat(b["t"]),
            "open": b["o"],
            "high": b["h"],
            "low": b["l"],
            "close": b["c"],
            "volume": b["v"],
        }
        for b in bars
    ]

    stmt = pg_insert(Candle).values(rows).on_conflict_do_update(
        constraint="uq_candle_symbol_tf_time",
        set_={"open": pg_insert(Candle).excluded.open,
              "high": pg_insert(Candle).excluded.high,
              "low": pg_insert(Candle).excluded.low,
              "close": pg_insert(Candle).excluded.close,
              "volume": pg_insert(Candle).excluded.volume},
    )
    await db.execute(stmt)
    log.info("Stored %d %s bars for %s", len(rows), timeframe, ticker)
    return len(rows)


async def get_latest_candles(
    db: AsyncSession,
    ticker: str,
    timeframe: str = "1Hour",
    limit: int = 100,
) -> list[dict]:
    """Read stored candles for signal engine / frontend charts."""
    result = await db.execute(
        select(Symbol).where(Symbol.ticker == ticker)
    )
    symbol = result.scalar_one_or_none()
    if not symbol:
        return []

    result = await db.execute(
        select(Candle)
        .where(Candle.symbol_id == symbol.id, Candle.timeframe == timeframe)
        .order_by(Candle.time.desc())
        .limit(limit)
    )
    candles = result.scalars().all()
    return [
        {"t": c.time.isoformat(), "o": c.open, "h": c.high, "l": c.low, "c": c.close, "v": c.volume}
        for c in reversed(candles)
    ]


async def refresh_all_watchlisted_symbols(
    db: AsyncSession,
    conn: BrokerConnection,
    timeframe: str = "1Hour",
) -> dict[str, int]:
    """Fetch bars for every symbol a user has on any watchlist."""
    result = await db.execute(
        select(WatchlistItem)
        .join(Watchlist, WatchlistItem.watchlist_id == Watchlist.id)
        .where(Watchlist.user_id == conn.user_id)
    )
    items = result.scalars().all()

    symbol_ids = {item.symbol_id for item in items}
    if not symbol_ids:
        return {}

    result = await db.execute(select(Symbol).where(Symbol.id.in_(symbol_ids)))
    symbols = result.scalars().all()

    counts: dict[str, int] = {}
    for sym in symbols:
        try:
            count = await fetch_and_store_bars(db, conn, sym.ticker, timeframe)
            counts[sym.ticker] = count
        except Exception as exc:
            log.warning("Failed to fetch %s: %s", sym.ticker, exc)
            counts[sym.ticker] = 0

    return counts
