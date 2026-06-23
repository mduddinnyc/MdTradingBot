"""
Signal engine — Session 4.
Uses the `ta` library for indicators, a rule-based FSM for patterns,
and a weighted fusion to produce BUY/SELL/HOLD + confidence score.

No ML training required — pure rule-based for MVP.
Replace/augment with LSTM in a later session.
"""
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import ta as _ta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.market import Candle, Symbol
from app.models.signal import Signal

log = logging.getLogger(__name__)

MODEL_VERSION = "rule-v1"

# Fusion weights
W_TREND = 0.40
W_MOMENTUM = 0.35
W_PATTERN = 0.25

MIN_CANDLES = 30  # minimum bars needed to compute indicators


# ── Data classes ───────────────────────────────────────────────

@dataclass
class IndicatorResult:
    rsi: float = 50.0
    macd_hist: float = 0.0
    bb_pct: float = 0.5        # position within Bollinger Bands 0=lower 1=upper
    ema_signal: float = 0.0    # +1 price above ema200, -1 below
    adx: float = 20.0
    volume_ratio: float = 1.0  # current volume / 20-period avg
    vwap_signal: float = 0.0   # +1 price above VWAP, -1 below, 0 if no volume data


@dataclass
class PatternResult:
    name: str | None = None
    direction: str | None = None   # bullish | bearish | None
    confidence: float = 0.0


@dataclass
class FusionResult:
    signal_type: str = "HOLD"
    confidence: float = 0.0
    indicators: dict = field(default_factory=dict)
    pattern: PatternResult = field(default_factory=PatternResult)
    reasoning: str = ""
    entry_price: float | None = None
    target_price: float | None = None
    stop_price: float | None = None


# ── Indicator computation ──────────────────────────────────────

def compute_indicators(df: pd.DataFrame) -> IndicatorResult:
    close = df["close"]
    high = df["high"]
    low = df["low"]
    volume = df["volume"]

    # RSI
    try:
        rsi_val = _ta.momentum.RSIIndicator(close=close, window=14).rsi().iloc[-1]
        rsi = float(rsi_val) if not np.isnan(rsi_val) else 50.0
    except Exception:
        rsi = 50.0

    # MACD histogram
    macd_hist = 0.0
    try:
        macd_obj = _ta.trend.MACD(close=close, window_slow=26, window_fast=12, window_sign=9)
        val = macd_obj.macd_diff().iloc[-1]
        macd_hist = float(val) if not np.isnan(val) else 0.0
    except Exception:
        macd_hist = 0.0

    # Bollinger Bands %B
    bb_pct = 0.5
    try:
        bb_obj = _ta.volatility.BollingerBands(close=close, window=20, window_dev=2)
        upper = bb_obj.bollinger_hband().iloc[-1]
        lower = bb_obj.bollinger_lband().iloc[-1]
        price = float(close.iloc[-1])
        if upper != lower and not np.isnan(upper) and not np.isnan(lower):
            bb_pct = float(np.clip((price - lower) / (upper - lower), 0, 1))
    except Exception:
        bb_pct = 0.5

    # EMA signal
    ema_len = min(200, len(df) - 1)
    ema_signal = 0.0
    try:
        ema200 = _ta.trend.EMAIndicator(close=close, window=ema_len).ema_indicator()
        e = ema200.iloc[-1]
        if not np.isnan(e):
            ema_signal = 1.0 if close.iloc[-1] > e else -1.0
    except Exception:
        ema_signal = 0.0

    # ADX (trend strength)
    adx = 20.0
    try:
        adx_obj = _ta.trend.ADXIndicator(high=high, low=low, close=close, window=14)
        val = adx_obj.adx().iloc[-1]
        adx = float(val) if not np.isnan(val) else 20.0
    except Exception:
        adx = 20.0

    # Volume ratio
    vol_mean = volume.rolling(20).mean().iloc[-1]
    volume_ratio = float(volume.iloc[-1] / vol_mean) if vol_mean > 0 else 1.0

    # VWAP — cumulative (typical_price × volume) / cumulative volume
    # Resets daily; for intraday data this is correct. For daily bars it gives a
    # longer-term mean-price benchmark that still filters trend direction.
    typical = (high + low + close) / 3
    cum_tpv = (typical * volume).cumsum()
    cum_vol = volume.cumsum()
    vwap = cum_tpv / cum_vol.replace(0, np.nan)
    vwap_val = float(vwap.iloc[-1]) if not np.isnan(vwap.iloc[-1]) else float(close.iloc[-1])
    vwap_signal = 1.0 if close.iloc[-1] > vwap_val else -1.0

    return IndicatorResult(
        rsi=rsi,
        macd_hist=macd_hist,
        bb_pct=bb_pct,
        ema_signal=ema_signal,
        adx=adx,
        volume_ratio=volume_ratio,
        vwap_signal=vwap_signal,
    )


# ── Trend score ────────────────────────────────────────────────

def trend_score(ind: IndicatorResult) -> float:
    """Returns −1.0 (bearish) to +1.0 (bullish)."""
    score = 0.0

    # EMA direction: strong weight
    score += ind.ema_signal * 0.4

    # VWAP: price above VWAP = bullish intraday bias
    score += ind.vwap_signal * 0.25

    # BB position: above midline = bullish
    score += (ind.bb_pct - 0.5) * 0.25   # maps 0→-0.125, 1→+0.125

    # ADX amplifies when strong trend (>25)
    adx_boost = min((ind.adx - 20) / 30, 1.0) if ind.adx > 20 else 0
    score *= (1 + adx_boost * 0.2)

    return float(np.clip(score, -1, 1))


# ── Momentum score ─────────────────────────────────────────────

def momentum_score(ind: IndicatorResult) -> float:
    """Returns −1.0 to +1.0."""
    score = 0.0

    # RSI: oversold (<30) → bullish, overbought (>70) → bearish
    if ind.rsi < 30:
        score += (30 - ind.rsi) / 30 * 0.5      # max +0.5
    elif ind.rsi > 70:
        score -= (ind.rsi - 70) / 30 * 0.5      # max -0.5
    else:
        score += (ind.rsi - 50) / 50 * 0.2      # neutral zone gentle push

    # MACD histogram direction
    macd_contrib = np.tanh(ind.macd_hist * 10) * 0.4
    score += float(macd_contrib)

    # Volume confirms momentum
    if ind.volume_ratio > 1.5:
        score *= 1.1

    return float(np.clip(score, -1, 1))


# ── Pattern FSM ────────────────────────────────────────────────

def detect_pattern(df: pd.DataFrame) -> PatternResult:
    """
    Lightweight FSM pattern detector.
    Detects candlestick reversal patterns on the last 1–3 candles
    and simple trend-continuation patterns over last 10 candles.
    """
    if len(df) < 3:
        return PatternResult()

    c = df["close"].values
    o = df["open"].values
    h = df["high"].values
    l = df["low"].values

    # ── Single-candle patterns ─────────────────────────────────
    body = abs(c[-1] - o[-1])
    candle_range = h[-1] - l[-1] if h[-1] != l[-1] else 1e-9
    upper_shadow = h[-1] - max(c[-1], o[-1])
    lower_shadow = min(c[-1], o[-1]) - l[-1]

    # Hammer (bullish reversal): small body, long lower shadow, small upper
    if (lower_shadow > body * 2 and upper_shadow < body * 0.5
            and c[-1] > o[-1]):
        return PatternResult(name="Hammer", direction="bullish", confidence=0.65)

    # Shooting Star (bearish reversal): small body, long upper shadow
    if (upper_shadow > body * 2 and lower_shadow < body * 0.5
            and c[-1] < o[-1]):
        return PatternResult(name="Shooting Star", direction="bearish", confidence=0.65)

    # Doji: body very small relative to range
    if body < candle_range * 0.1:
        return PatternResult(name="Doji", direction=None, confidence=0.3)

    # ── Two-candle patterns ────────────────────────────────────
    if len(df) >= 2:
        prev_body = c[-2] - o[-2]  # positive = bullish candle
        curr_body = c[-1] - o[-1]

        # Bullish engulfing
        if (prev_body < 0 and curr_body > 0
                and c[-1] > o[-2] and o[-1] < c[-2]):
            return PatternResult(name="Bullish Engulfing", direction="bullish", confidence=0.72)

        # Bearish engulfing
        if (prev_body > 0 and curr_body < 0
                and c[-1] < o[-2] and o[-1] > c[-2]):
            return PatternResult(name="Bearish Engulfing", direction="bearish", confidence=0.72)

    # ── Multi-candle: simple double bottom/top ─────────────────
    if len(df) >= 10:
        recent_lows = l[-10:]
        recent_highs = h[-10:]
        low_min = recent_lows.min()
        high_max = recent_highs.max()
        tol = (high_max - low_min) * 0.02  # 2% tolerance

        # Double bottom: two lows close in price, middle higher
        sorted_idx = np.argsort(recent_lows)
        if len(sorted_idx) >= 2:
            i1, i2 = sorted_idx[0], sorted_idx[1]
            if (abs(recent_lows[i1] - recent_lows[i2]) < tol
                    and abs(i1 - i2) > 3):
                return PatternResult(name="Double Bottom", direction="bullish", confidence=0.68)

        # Double top
        sorted_idx_h = np.argsort(-recent_highs)
        if len(sorted_idx_h) >= 2:
            i1, i2 = sorted_idx_h[0], sorted_idx_h[1]
            if (abs(recent_highs[i1] - recent_highs[i2]) < tol
                    and abs(i1 - i2) > 3):
                return PatternResult(name="Double Top", direction="bearish", confidence=0.68)

    return PatternResult()


# ── Market regime detection ────────────────────────────────────

REGIME_TRENDING_BULL = "trending_bull"
REGIME_TRENDING_BEAR = "trending_bear"
REGIME_SIDEWAYS      = "sideways"


def detect_regime(df: pd.DataFrame, ind: IndicatorResult) -> str:
    """
    Classifies market regime using ADX + EMA200 slope + Bollinger Band width.

    trending_bull  — strong uptrend  (ADX > 25, EMA slope up,   price above EMA)
    trending_bear  — strong downtrend (ADX > 25, EMA slope down, price below EMA)
    sideways       — consolidation   (ADX ≤ 25 or BB width narrow)

    Used by the execution engine to filter signal types:
    - In trending_bull:  prefer BUY signals, skip SELL mean-reversion
    - In trending_bear:  prefer SELL signals, skip BUY mean-reversion
    - In sideways:       prefer mean-reversion signals (RSI extremes, BB touches)
    """
    close = df["close"]

    # EMA200 slope: compare current vs 5 bars ago (normalised)
    ema_slope = 0.0
    try:
        ema_len = min(200, len(df) - 1)
        ema200 = _ta.trend.EMAIndicator(close=close, window=ema_len).ema_indicator()
        if len(ema200) >= 6:
            e_now  = ema200.iloc[-1]
            e_prev = ema200.iloc[-6]
            if not np.isnan(e_now) and not np.isnan(e_prev) and e_prev != 0:
                ema_slope = (e_now - e_prev) / e_prev
    except Exception:
        ema_slope = 0.0

    # Bollinger Band width (normalised): narrow = sideways
    bb_width = 0.0
    try:
        bb_obj = _ta.volatility.BollingerBands(close=close, window=20, window_dev=2)
        upper = bb_obj.bollinger_hband().iloc[-1]
        lower = bb_obj.bollinger_lband().iloc[-1]
        mid = float(close.iloc[-1])
        if mid > 0 and not np.isnan(upper) and not np.isnan(lower):
            bb_width = (upper - lower) / mid
    except Exception:
        bb_width = 0.0

    strong_trend = ind.adx > 25
    wide_bands   = bb_width > 0.04  # 4% relative width = not compressed

    if strong_trend and wide_bands:
        if ind.ema_signal > 0 and ema_slope > 0:
            return REGIME_TRENDING_BULL
        if ind.ema_signal < 0 and ema_slope < 0:
            return REGIME_TRENDING_BEAR

    return REGIME_SIDEWAYS


# ── Signal fusion ──────────────────────────────────────────────

def fuse(ind: IndicatorResult, pattern: PatternResult, close: float) -> FusionResult:
    ts = trend_score(ind)
    ms = momentum_score(ind)

    # Pattern contribution
    ps = 0.0
    if pattern.direction == "bullish":
        ps = pattern.confidence
    elif pattern.direction == "bearish":
        ps = -pattern.confidence

    # Weighted sum → raw score in [-1, 1]
    raw = W_TREND * ts + W_MOMENTUM * ms + W_PATTERN * ps
    raw = float(np.clip(raw, -1, 1))

    confidence = abs(raw)
    if raw > 0.15:
        signal_type = "BUY"
        atr_mult = 2.0
        target = close * (1 + confidence * atr_mult / 100)
        stop = close * (1 - 0.02)
    elif raw < -0.15:
        signal_type = "SELL"
        atr_mult = 2.0
        target = close * (1 - confidence * atr_mult / 100)
        stop = close * (1 + 0.02)
    else:
        signal_type = "HOLD"
        target = None
        stop = None

    vwap_label = "above" if ind.vwap_signal > 0 else "below"
    reasoning_parts = [
        f"Trend={ts:.2f} Momentum={ms:.2f} Pattern={ps:.2f}",
        f"RSI={ind.rsi:.1f} MACD_hist={ind.macd_hist:.4f} BB%={ind.bb_pct:.2f}",
        f"EMA_signal={ind.ema_signal} VWAP={vwap_label} ADX={ind.adx:.1f} VolRatio={ind.volume_ratio:.2f}",
    ]
    if pattern.name:
        reasoning_parts.append(f"Pattern: {pattern.name} ({pattern.direction})")

    return FusionResult(
        signal_type=signal_type,
        confidence=round(confidence, 4),
        indicators={
            "rsi": round(ind.rsi, 2),
            "macd_hist": round(ind.macd_hist, 6),
            "bb_pct": round(ind.bb_pct, 4),
            "ema_signal": ind.ema_signal,
            "adx": round(ind.adx, 2),
            "volume_ratio": round(ind.volume_ratio, 2),
            "vwap_signal": ind.vwap_signal,
            "trend_score": round(ts, 4),
            "momentum_score": round(ms, 4),
        },
        pattern=pattern,
        reasoning=" | ".join(reasoning_parts),
        entry_price=round(close, 4),
        target_price=round(target, 4) if target else None,
        stop_price=round(stop, 4) if stop else None,
    )


# ── Main entry point ───────────────────────────────────────────

async def generate_signal(
    db: AsyncSession,
    ticker: str,
    timeframe: str = "1Hour",
) -> Signal | None:
    """
    Pull stored candles, run indicator + pattern + fusion,
    persist the Signal record, and return it.
    Returns None if not enough data.
    """
    result = await db.execute(select(Symbol).where(Symbol.ticker == ticker))
    symbol = result.scalar_one_or_none()
    if not symbol:
        log.warning("Symbol %s not found", ticker)
        return None

    result = await db.execute(
        select(Candle)
        .where(Candle.symbol_id == symbol.id, Candle.timeframe == timeframe)
        .order_by(Candle.time.desc())
        .limit(250)
    )
    candles = list(reversed(result.scalars().all()))

    if len(candles) < MIN_CANDLES:
        log.info("Not enough candles for %s (%d < %d)", ticker, len(candles), MIN_CANDLES)
        return None

    df = pd.DataFrame([
        {"time": c.time, "open": c.open, "high": c.high,
         "low": c.low, "close": c.close, "volume": c.volume}
        for c in candles
    ])

    ind = compute_indicators(df)
    pattern = detect_pattern(df)
    regime = detect_regime(df, ind)
    result_fusion = fuse(ind, pattern, close=float(df["close"].iloc[-1]))

    expires = datetime.now(timezone.utc) + timedelta(hours=4 if timeframe == "1Hour" else 24)

    signal = Signal(
        symbol_id=symbol.id,
        signal_type=result_fusion.signal_type,
        confidence=result_fusion.confidence,
        timeframe=timeframe,
        entry_price=result_fusion.entry_price,
        target_price=result_fusion.target_price,
        stop_price=result_fusion.stop_price,
        pattern_detected=result_fusion.pattern.name,
        indicators={**result_fusion.indicators, "regime": regime},
        reasoning=result_fusion.reasoning + f" | Regime={regime}",
        model_version=MODEL_VERSION,
        expires_at=expires,
    )
    db.add(signal)
    await db.flush()

    log.info(
        "Signal %s %s confidence=%.2f pattern=%s",
        result_fusion.signal_type, ticker, result_fusion.confidence, result_fusion.pattern.name
    )
    return signal
