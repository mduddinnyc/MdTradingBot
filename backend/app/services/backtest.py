"""
Task 11 — Backtesting engine (pandas-based, no external deps).

Simulates the platform's rule-based signal engine on historical OHLCV data
and returns performance metrics: total return, Sharpe ratio, max drawdown,
win rate, and trade log.

Designed to work with the bars already stored in the candles table.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class BacktestResult:
    symbol: str
    total_return_pct: float
    annualised_return_pct: float
    sharpe_ratio: float
    max_drawdown_pct: float
    win_rate_pct: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    trades: list[dict] = field(default_factory=list)
    equity_curve: list[dict] = field(default_factory=list)


def run(
    symbol: str,
    bars: list[dict],           # [{t, o, h, l, c, v}, ...]
    initial_capital: float = 10_000.0,
    stop_loss_pct: float = 0.02,
    take_profit_pct: float = 0.04,
    min_confidence: float = 0.60,
    position_size_pct: float = 0.10,
) -> BacktestResult:
    """
    Simple trend-following backtest using a moving-average crossover
    as a proxy for the signal engine (EMA9 > EMA21 = BUY, else SELL).

    Returns BacktestResult with full trade log and equity curve.
    """
    if len(bars) < 30:
        raise ValueError(f"Need at least 30 bars for backtest, got {len(bars)}")

    closes = [float(b["c"]) for b in bars]
    times  = [b["t"] for b in bars]

    ema9  = _ema(closes, 9)
    ema21 = _ema(closes, 21)

    capital   = initial_capital
    position  = 0.0          # shares held
    entry_px  = 0.0
    tp_px     = 0.0
    sl_px     = 0.0
    trades: list[dict] = []
    equity: list[dict] = []

    for i in range(21, len(closes)):
        price = closes[i]
        ts    = times[i]

        # Exit logic first
        if position > 0:
            pnl = 0.0
            if price >= tp_px:
                pnl = (tp_px - entry_px) * position
                capital += pnl + entry_px * position
                trades.append(_trade(ts, symbol, "sell", entry_px, tp_px, position, pnl, "take_profit"))
                position = 0.0
            elif price <= sl_px:
                pnl = (sl_px - entry_px) * position
                capital += pnl + entry_px * position
                trades.append(_trade(ts, symbol, "sell", entry_px, sl_px, position, pnl, "stop_loss"))
                position = 0.0

        # Entry logic
        if position == 0 and ema9[i] > ema21[i] and ema9[i - 1] <= ema21[i - 1]:
            pos_value = capital * position_size_pct
            qty = pos_value / price
            capital -= pos_value
            position  = qty
            entry_px  = price
            tp_px     = price * (1 + take_profit_pct)
            sl_px     = price * (1 - stop_loss_pct)
            trades.append(_trade(ts, symbol, "buy", price, price, qty, 0, "entry"))

        equity.append({"t": ts, "equity": round(capital + position * price, 2)})

    # Force close any open position at end
    if position > 0:
        last_px = closes[-1]
        pnl = (last_px - entry_px) * position
        capital += pnl + entry_px * position
        trades.append(_trade(times[-1], symbol, "sell", entry_px, last_px, position, pnl, "eod_close"))
        position = 0.0

    # Metrics
    closed = [t for t in trades if t["side"] == "sell"]
    wins   = [t for t in closed if t["pnl"] > 0]
    losses = [t for t in closed if t["pnl"] <= 0]

    total_return = (capital - initial_capital) / initial_capital * 100
    n_years = max(len(bars) / 252, 0.01)
    ann_return = ((capital / initial_capital) ** (1 / n_years) - 1) * 100

    eq_vals = [e["equity"] for e in equity]
    sharpe  = _sharpe(eq_vals, initial_capital)
    mdd     = _max_drawdown(eq_vals)
    win_rate = len(wins) / len(closed) * 100 if closed else 0.0

    return BacktestResult(
        symbol=symbol,
        total_return_pct=round(total_return, 2),
        annualised_return_pct=round(ann_return, 2),
        sharpe_ratio=round(sharpe, 2),
        max_drawdown_pct=round(mdd, 2),
        win_rate_pct=round(win_rate, 1),
        total_trades=len(closed),
        winning_trades=len(wins),
        losing_trades=len(losses),
        trades=trades,
        equity_curve=equity,
    )


def to_dict(r: BacktestResult) -> dict:
    return {
        "symbol": r.symbol,
        "total_return_pct": r.total_return_pct,
        "annualised_return_pct": r.annualised_return_pct,
        "sharpe_ratio": r.sharpe_ratio,
        "max_drawdown_pct": r.max_drawdown_pct,
        "win_rate_pct": r.win_rate_pct,
        "total_trades": r.total_trades,
        "winning_trades": r.winning_trades,
        "losing_trades": r.losing_trades,
        "trades": r.trades,
        "equity_curve": r.equity_curve,
    }


# ── Internal helpers ───────────────────────────────────────────

def _ema(prices: list[float], n: int) -> list[float]:
    k = 2 / (n + 1)
    result = [prices[0]] * len(prices)
    for i in range(1, len(prices)):
        result[i] = prices[i] * k + result[i - 1] * (1 - k)
    return result


def _trade(ts, symbol, side, entry, exit_px, qty, pnl, reason) -> dict:
    return {
        "timestamp": str(ts),
        "symbol": symbol,
        "side": side,
        "entry_price": round(entry, 4),
        "exit_price": round(exit_px, 4),
        "qty": round(qty, 6),
        "pnl": round(pnl, 2),
        "reason": reason,
    }


def _sharpe(equity: list[float], start: float) -> float:
    if len(equity) < 2:
        return 0.0
    returns = [(equity[i] - equity[i - 1]) / equity[i - 1] for i in range(1, len(equity))]
    if not returns:
        return 0.0
    avg = sum(returns) / len(returns)
    variance = sum((r - avg) ** 2 for r in returns) / len(returns)
    std = math.sqrt(variance) if variance > 0 else 1e-9
    return avg / std * math.sqrt(252)


def _max_drawdown(equity: list[float]) -> float:
    peak = equity[0]
    mdd  = 0.0
    for e in equity:
        if e > peak:
            peak = e
        dd = (peak - e) / peak * 100
        if dd > mdd:
            mdd = dd
    return mdd
