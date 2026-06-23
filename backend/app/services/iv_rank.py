"""
Task 8 — IV Rank calculator.

IV Rank  = (current_iv - 52w_low) / (52w_high - 52w_low) * 100
IV Pct   = fraction of past-year days where IV was below current * 100

Reads/writes the iv_history table.  Called by:
  - Daily scheduler (cron) to persist each day's IV
  - /analysis/iv-rank/{symbol} API endpoint on-demand
"""
from __future__ import annotations

import datetime as dt
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.market import IVHistory


async def store_iv(db: AsyncSession, ticker: str, iv_30d: float) -> IVHistory:
    """Upsert today's IV reading and (re)compute rank/percentile."""
    today = dt.date.today()

    # Fetch last 252 trading days (≈1 year)
    cutoff = today - dt.timedelta(days=380)
    result = await db.execute(
        select(IVHistory)
        .where(IVHistory.ticker == ticker.upper(), IVHistory.date >= cutoff)
        .order_by(IVHistory.date)
    )
    history: Sequence[IVHistory] = result.scalars().all()

    iv_values = [r.iv_30d for r in history if r.iv_30d is not None]
    iv_rank = _compute_rank(iv_30d, iv_values)
    iv_pct  = _compute_pct(iv_30d, iv_values)

    # Upsert today's row
    existing = next((r for r in history if r.date == today), None)
    if existing:
        existing.iv_30d = iv_30d
        existing.iv_rank = iv_rank
        existing.iv_pct = iv_pct
        row = existing
    else:
        row = IVHistory(
            ticker=ticker.upper(),
            date=today,
            iv_30d=iv_30d,
            iv_rank=iv_rank,
            iv_pct=iv_pct,
        )
        db.add(row)

    await db.flush()
    return row


async def get_iv_rank(db: AsyncSession, ticker: str) -> dict:
    """Return latest IV rank and percentile for ticker."""
    result = await db.execute(
        select(IVHistory)
        .where(IVHistory.ticker == ticker.upper())
        .order_by(IVHistory.date.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if not row:
        return {"ticker": ticker.upper(), "iv_rank": None, "iv_pct": None, "iv_30d": None, "date": None}
    return {
        "ticker": row.ticker,
        "iv_30d": row.iv_30d,
        "iv_rank": row.iv_rank,
        "iv_pct": row.iv_pct,
        "date": str(row.date),
    }


def _compute_rank(current: float, history: list[float]) -> float | None:
    if not history:
        return None
    lo, hi = min(history), max(history)
    if hi == lo:
        return 50.0
    return round((current - lo) / (hi - lo) * 100, 1)


def _compute_pct(current: float, history: list[float]) -> float | None:
    if not history:
        return None
    below = sum(1 for v in history if v < current)
    return round(below / len(history) * 100, 1)
