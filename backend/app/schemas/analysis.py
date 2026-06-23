import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class GuardrailCheck(BaseModel):
    name: str
    passed: bool
    detail: str


class DecisionStep(BaseModel):
    step: str           # "market_data" | "indicators" | "pattern" | "fusion" | "guardrails" | "order"
    status: str         # "ok" | "warning" | "blocked"
    summary: str
    detail: dict[str, Any] = {}


class DecisionResponse(BaseModel):
    id: str
    symbol: str
    timeframe: str
    created_at: datetime

    # Signal
    signal_type: str
    confidence: float
    entry_price: float | None
    target_price: float | None
    stop_price: float | None
    pattern_detected: str | None
    indicators: dict[str, Any]
    reasoning: str | None

    # Guardrail checks
    guardrails: list[GuardrailCheck]
    guardrails_passed: bool

    # Order outcome
    order_id: str | None
    order_status: str | None     # submitted | filled | rejected | None
    order_side: str | None
    order_qty: float | None
    order_fill_price: float | None
    rejection_reason: str | None

    # Full step-by-step chain
    steps: list[DecisionStep]

    model_config = {"from_attributes": True}


class StatsResponse(BaseModel):
    total_signals: int
    buy_signals: int
    sell_signals: int
    hold_signals: int
    orders_placed: int
    orders_filled: int
    orders_rejected: int
    win_rate: float | None          # % of filled orders that were profitable
    avg_confidence: float
    symbols_tracked: int


class PerformancePoint(BaseModel):
    date: str
    symbol: str
    signal_type: str
    confidence: float
    entry_price: float | None
    fill_price: float | None
    pnl_pct: float | None           # realized if filled, None otherwise
    status: str
