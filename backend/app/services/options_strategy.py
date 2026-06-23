"""
Task 9 — Options strategy engine.

Analyses IV rank + market regime + signal type and recommends the best
options strategy from: CSP, Bull Put Spread, Bear Call Spread, Iron Condor.

Does NOT place orders — returns a recommendation payload that the user
reviews before the execution engine acts on it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class StrategyRecommendation:
    strategy: str            # "csp" | "bull_put_spread" | "bear_call_spread" | "iron_condor"
    rationale: str
    legs: list[dict]         # each leg: {type, action, delta_target, strike_hint, expiry_dte}
    max_profit_pct: float    # % of capital at risk
    break_even_hint: str
    iv_rank: float | None
    regime: str


def recommend(
    signal_type: str,       # "BUY" | "SELL" | "HOLD"
    regime: str,            # "trending_bull" | "trending_bear" | "sideways"
    iv_rank: float | None,  # 0-100; None if unknown
    current_price: float,
    options_chain: dict | None = None,
) -> StrategyRecommendation:
    """
    Decision matrix:
      Regime           Signal  IV Rank   → Strategy
      trending_bull    BUY     high(>50) → CSP (sell cash-secured put)
      trending_bull    BUY     low(<50)  → Bull Put Spread
      trending_bear    SELL    high      → Bear Call Spread
      sideways         HOLD    high(>50) → Iron Condor
      sideways         *       low       → wait / no trade
    """
    iv = iv_rank or 0.0

    if regime == "trending_bull" and signal_type == "BUY":
        if iv >= 50:
            return _csp(current_price, iv)
        return _bull_put_spread(current_price, iv)

    if regime == "trending_bear" and signal_type == "SELL":
        return _bear_call_spread(current_price, iv)

    if regime == "sideways" and iv >= 50:
        return _iron_condor(current_price, iv)

    return StrategyRecommendation(
        strategy="none",
        rationale=f"No high-probability options play: regime={regime}, signal={signal_type}, IV rank={iv:.0f}. Wait for better setup.",
        legs=[],
        max_profit_pct=0.0,
        break_even_hint="N/A",
        iv_rank=iv_rank,
        regime=regime,
    )


def _csp(price: float, iv: float) -> StrategyRecommendation:
    strike_hint = round(price * 0.95, 2)   # ~5% OTM put
    return StrategyRecommendation(
        strategy="csp",
        rationale=(
            f"Bullish trend + high IV rank ({iv:.0f}). "
            "Sell an OTM cash-secured put to collect elevated premium. "
            "If assigned, you own shares at a discount."
        ),
        legs=[{
            "type": "put",
            "action": "sell",
            "delta_target": 0.30,
            "strike_hint": strike_hint,
            "expiry_dte": 30,
        }],
        max_profit_pct=round((price - strike_hint) / price * 100, 1),
        break_even_hint=f"${strike_hint:.2f} (strike − premium received)",
        iv_rank=iv,
        regime="trending_bull",
    )


def _bull_put_spread(price: float, iv: float) -> StrategyRecommendation:
    short_strike = round(price * 0.95, 2)
    long_strike  = round(price * 0.90, 2)
    width = short_strike - long_strike
    return StrategyRecommendation(
        strategy="bull_put_spread",
        rationale=(
            f"Bullish trend, lower IV ({iv:.0f}). "
            "Defined-risk bull put spread: sell higher put, buy lower put. "
            "Caps max loss vs naked CSP."
        ),
        legs=[
            {"type": "put", "action": "sell", "delta_target": 0.30, "strike_hint": short_strike, "expiry_dte": 30},
            {"type": "put", "action": "buy",  "delta_target": 0.15, "strike_hint": long_strike,  "expiry_dte": 30},
        ],
        max_profit_pct=round(width / price * 100 * 0.5, 1),
        break_even_hint=f"${short_strike:.2f} − net premium received",
        iv_rank=iv,
        regime="trending_bull",
    )


def _bear_call_spread(price: float, iv: float) -> StrategyRecommendation:
    short_strike = round(price * 1.05, 2)
    long_strike  = round(price * 1.10, 2)
    return StrategyRecommendation(
        strategy="bear_call_spread",
        rationale=(
            f"Bearish trend, IV rank={iv:.0f}. "
            "Sell OTM call spread: max profit if price stays below short strike."
        ),
        legs=[
            {"type": "call", "action": "sell", "delta_target": 0.30, "strike_hint": short_strike, "expiry_dte": 30},
            {"type": "call", "action": "buy",  "delta_target": 0.15, "strike_hint": long_strike,  "expiry_dte": 30},
        ],
        max_profit_pct=round((long_strike - short_strike) / price * 100 * 0.5, 1),
        break_even_hint=f"${short_strike:.2f} + net premium received",
        iv_rank=iv,
        regime="trending_bear",
    )


def _iron_condor(price: float, iv: float) -> StrategyRecommendation:
    put_short  = round(price * 0.95, 2)
    put_long   = round(price * 0.90, 2)
    call_short = round(price * 1.05, 2)
    call_long  = round(price * 1.10, 2)
    return StrategyRecommendation(
        strategy="iron_condor",
        rationale=(
            f"Sideways market + high IV ({iv:.0f}). "
            "Iron condor collects premium from both sides — profit if price stays in range."
        ),
        legs=[
            {"type": "put",  "action": "sell", "delta_target": 0.20, "strike_hint": put_short,  "expiry_dte": 30},
            {"type": "put",  "action": "buy",  "delta_target": 0.10, "strike_hint": put_long,   "expiry_dte": 30},
            {"type": "call", "action": "sell", "delta_target": 0.20, "strike_hint": call_short, "expiry_dte": 30},
            {"type": "call", "action": "buy",  "delta_target": 0.10, "strike_hint": call_long,  "expiry_dte": 30},
        ],
        max_profit_pct=round((call_short - put_short) / price * 100 * 0.3, 1),
        break_even_hint=f"${put_short:.2f} – ${call_short:.2f} profit zone",
        iv_rank=iv,
        regime="sideways",
    )


def to_dict(rec: StrategyRecommendation) -> dict[str, Any]:
    return {
        "strategy": rec.strategy,
        "rationale": rec.rationale,
        "legs": rec.legs,
        "max_profit_pct": rec.max_profit_pct,
        "break_even_hint": rec.break_even_hint,
        "iv_rank": rec.iv_rank,
        "regime": rec.regime,
    }
