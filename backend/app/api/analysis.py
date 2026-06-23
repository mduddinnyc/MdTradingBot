"""
Analysis & Decision History API.
Joins signals → orders → audit_logs to reconstruct the full decision chain
for every trade the AI considered, showing exactly why it acted or didn't.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func

from app.core.deps import CurrentUser, DB
from app.models.automation import Order
from app.models.market import Symbol, Watchlist, WatchlistItem
from app.models.signal import Signal
from app.schemas.analysis import (
    DecisionResponse,
    DecisionStep,
    GuardrailCheck,
    PerformancePoint,
    StatsResponse,
)
from app.services import iv_rank as iv_rank_svc
from app.services import backtest as backtest_svc

router = APIRouter(prefix="/analysis", tags=["analysis"])


def _build_steps(signal: Signal, order: Order | None, guardrails: list[GuardrailCheck]) -> list[DecisionStep]:
    steps: list[DecisionStep] = []

    # Step 1 — market data
    steps.append(DecisionStep(
        step="market_data",
        status="ok",
        summary=f"Fetched candle data for {signal.timeframe} timeframe",
        detail={"timeframe": signal.timeframe, "model_version": signal.model_version},
    ))

    # Step 2 — indicator computation
    ind = signal.indicators or {}
    steps.append(DecisionStep(
        step="indicators",
        status="ok",
        summary=(
            f"RSI={ind.get('rsi', '?'):.1f}  "
            f"MACD={ind.get('macd_hist', 0):.4f}  "
            f"BB%={ind.get('bb_pct', 0):.2f}  "
            f"ADX={ind.get('adx', '?'):.1f}  "
            f"VolRatio={ind.get('volume_ratio', 1):.2f}"
        ) if isinstance(ind.get('rsi'), float) else "Indicators computed",
        detail=ind,
    ))

    # Step 3 — pattern detection
    pattern = signal.pattern_detected
    steps.append(DecisionStep(
        step="pattern",
        status="ok" if pattern else "warning",
        summary=f"Pattern detected: {pattern}" if pattern else "No candlestick pattern detected",
        detail={"pattern": pattern},
    ))

    # Step 4 — signal fusion
    ts = ind.get("trend_score", 0)
    ms = ind.get("momentum_score", 0)
    steps.append(DecisionStep(
        step="fusion",
        status="ok",
        summary=(
            f"Trend={ts:.2f}  Momentum={ms:.2f}  "
            f"→ {signal.signal_type} ({signal.confidence * 100:.1f}% confidence)"
        ),
        detail={
            "signal_type": signal.signal_type,
            "confidence": signal.confidence,
            "trend_score": ts,
            "momentum_score": ms,
            "entry_price": signal.entry_price,
            "target_price": signal.target_price,
            "stop_price": signal.stop_price,
        },
    ))

    # Step 5 — guardrail checks
    all_passed = all(g.passed for g in guardrails)
    steps.append(DecisionStep(
        step="guardrails",
        status="ok" if all_passed else "blocked",
        summary=f"{sum(g.passed for g in guardrails)}/{len(guardrails)} checks passed",
        detail={"checks": [g.model_dump() for g in guardrails]},
    ))

    # Step 6 — order outcome
    if order:
        steps.append(DecisionStep(
            step="order",
            status="ok" if order.status in ("submitted", "filled") else "blocked",
            summary=(
                f"{order.side.upper()} {order.quantity} {order.ticker}"
                + (f" @ ${order.avg_fill_price:.2f}" if order.avg_fill_price else "")
                + f"  [{order.status.upper()}]"
                + (f"  Reason: {order.rejection_reason}" if order.rejection_reason else "")
            ),
            detail={
                "side": order.side,
                "quantity": order.quantity,
                "status": order.status,
                "fill_price": order.avg_fill_price,
                "stop_price": order.stop_price,
                "take_profit_price": order.take_profit_price,
                "rejection_reason": order.rejection_reason,
            },
        ))

    return steps


def _infer_guardrails(signal: Signal, order: Order | None) -> list[GuardrailCheck]:
    """
    Reconstruct guardrail results from what we know.
    When order exists and is submitted/filled, all passed.
    When rejected, only the rejection_reason check failed.
    When no order (HOLD signal), guardrails weren't run.
    """
    if signal.signal_type == "HOLD":
        return []

    if not order:
        return []

    rejection = order.rejection_reason or ""
    checks = [
        GuardrailCheck(
            name="Confidence threshold",
            passed="Confidence" not in rejection,
            detail=f"{signal.confidence * 100:.1f}% confidence vs threshold" if "Confidence" in rejection else f"{signal.confidence * 100:.1f}% — passed",
        ),
        GuardrailCheck(
            name="Cooldown period",
            passed="Cooldown" not in rejection,
            detail="Cooldown active — too soon after last order" if "Cooldown" in rejection else "No recent orders for this ticker",
        ),
        GuardrailCheck(
            name="Daily loss limit",
            passed="Daily loss" not in rejection,
            detail="Daily loss limit reached" if "Daily loss" in rejection else "Within daily loss limit",
        ),
        GuardrailCheck(
            name="Max open positions",
            passed="Max open" not in rejection,
            detail="Too many open positions" if "Max open" in rejection else "Open positions within limit",
        ),
        GuardrailCheck(
            name="Position size",
            passed="Position size" not in rejection,
            detail="Position too small" if "Position size" in rejection else "Position size within limits",
        ),
    ]
    return checks


@router.get("/decisions", response_model=list[DecisionResponse])
async def get_decisions(
    current_user: CurrentUser,
    db: DB,
    limit: int = Query(50, le=200),
    symbol: str | None = None,
):
    # Get user's watchlisted symbol IDs
    wl_result = await db.execute(
        select(Watchlist).where(
            Watchlist.user_id == current_user.id,
            Watchlist.is_default == True,
        )
    )
    wl = wl_result.scalar_one_or_none()
    if not wl:
        return []

    wli_result = await db.execute(
        select(WatchlistItem.symbol_id).where(WatchlistItem.watchlist_id == wl.id)
    )
    symbol_ids = [r[0] for r in wli_result.all()]
    if not symbol_ids:
        return []

    # Fetch signals
    q = (
        select(Signal, Symbol)
        .join(Symbol, Signal.symbol_id == Symbol.id)
        .where(Signal.symbol_id.in_(symbol_ids))
    )
    if symbol:
        q = q.where(Symbol.ticker == symbol.upper())
    q = q.order_by(Signal.created_at.desc()).limit(limit)

    sig_rows = (await db.execute(q)).all()

    # Fetch corresponding orders (one per signal)
    signal_ids = [s.id for s, _ in sig_rows]
    order_map: dict[uuid.UUID, Order] = {}
    if signal_ids:
        ord_result = await db.execute(
            select(Order)
            .where(Order.signal_id.in_(signal_ids), Order.user_id == current_user.id)
        )
        for o in ord_result.scalars().all():
            if o.signal_id:
                order_map[o.signal_id] = o

    decisions = []
    for sig, sym in sig_rows:
        order = order_map.get(sig.id)
        guardrails = _infer_guardrails(sig, order)
        steps = _build_steps(sig, order, guardrails)

        decisions.append(DecisionResponse(
            id=str(sig.id),
            symbol=sym.ticker,
            timeframe=sig.timeframe,
            created_at=sig.created_at,
            signal_type=sig.signal_type,
            confidence=sig.confidence,
            entry_price=sig.entry_price,
            target_price=sig.target_price,
            stop_price=sig.stop_price,
            pattern_detected=sig.pattern_detected,
            indicators=sig.indicators or {},
            reasoning=sig.reasoning,
            guardrails=guardrails,
            guardrails_passed=all(g.passed for g in guardrails),
            order_id=str(order.id) if order else None,
            order_status=order.status if order else None,
            order_side=order.side if order else None,
            order_qty=order.quantity if order else None,
            order_fill_price=order.avg_fill_price if order else None,
            rejection_reason=order.rejection_reason if order else None,
            steps=steps,
        ))
    return decisions


@router.get("/stats", response_model=StatsResponse)
async def get_stats(current_user: CurrentUser, db: DB):
    wl_result = await db.execute(
        select(Watchlist).where(
            Watchlist.user_id == current_user.id, Watchlist.is_default == True
        )
    )
    wl = wl_result.scalar_one_or_none()

    if not wl:
        return StatsResponse(
            total_signals=0, buy_signals=0, sell_signals=0, hold_signals=0,
            orders_placed=0, orders_filled=0, orders_rejected=0,
            win_rate=None, avg_confidence=0.0, symbols_tracked=0,
        )

    wli = await db.execute(
        select(WatchlistItem.symbol_id).where(WatchlistItem.watchlist_id == wl.id)
    )
    symbol_ids = [r[0] for r in wli.all()]

    # Signal counts
    sig_counts = await db.execute(
        select(Signal.signal_type, func.count(Signal.id))
        .where(Signal.symbol_id.in_(symbol_ids))
        .group_by(Signal.signal_type)
    )
    counts = {row[0]: row[1] for row in sig_counts.all()}
    total = sum(counts.values())

    avg_conf = await db.execute(
        select(func.avg(Signal.confidence)).where(Signal.symbol_id.in_(symbol_ids))
    )
    avg_c = float(avg_conf.scalar_one_or_none() or 0)

    # Order stats
    ord_counts = await db.execute(
        select(Order.status, func.count(Order.id))
        .where(Order.user_id == current_user.id, Order.is_automated == True)
        .group_by(Order.status)
    )
    ord_map = {row[0]: row[1] for row in ord_counts.all()}

    placed  = sum(ord_map.get(s, 0) for s in ("submitted", "filled", "partially_filled"))
    filled  = ord_map.get("filled", 0)
    rejected = ord_map.get("rejected", 0)

    return StatsResponse(
        total_signals=total,
        buy_signals=counts.get("BUY", 0),
        sell_signals=counts.get("SELL", 0),
        hold_signals=counts.get("HOLD", 0),
        orders_placed=placed,
        orders_filled=filled,
        orders_rejected=rejected,
        win_rate=None,  # requires exit price tracking
        avg_confidence=round(avg_c, 4),
        symbols_tracked=len(symbol_ids),
    )


@router.get("/performance", response_model=list[PerformancePoint])
async def get_performance(current_user: CurrentUser, db: DB, symbol: str | None = None):
    ord_q = (
        select(Order)
        .where(Order.user_id == current_user.id, Order.is_automated == True)
        .order_by(Order.created_at.desc())
        .limit(200)
    )
    orders = (await db.execute(ord_q)).scalars().all()

    points = []
    for o in orders:
        if symbol and o.ticker != symbol.upper():
            continue
        # Approximate P&L: for filled orders, (fill - stop) / fill as worst-case risk
        pnl = None
        if o.status == "filled" and o.avg_fill_price and o.stop_price:
            if o.side == "buy":
                pnl = round((o.avg_fill_price - o.stop_price) / o.avg_fill_price * 100, 2)
            else:
                pnl = round((o.stop_price - o.avg_fill_price) / o.avg_fill_price * 100, 2)

        points.append(PerformancePoint(
            date=o.created_at.isoformat(),
            symbol=o.ticker,
            signal_type="BUY" if o.side == "buy" else "SELL",
            confidence=0.0,
            entry_price=o.avg_fill_price,
            fill_price=o.avg_fill_price,
            pnl_pct=pnl,
            status=o.status,
        ))
    return points


# ── Task 8: IV Rank ────────────────────────────────────────────

@router.get("/iv-rank/{symbol}")
async def get_iv_rank(symbol: str, current_user: CurrentUser, db: DB):
    return await iv_rank_svc.get_iv_rank(db, symbol.upper())


class StoreIVRequest(BaseModel):
    iv_30d: float


@router.post("/iv-rank/{symbol}")
async def store_iv(symbol: str, body: StoreIVRequest, current_user: CurrentUser, db: DB):
    """Manually record today's 30-day IV for a symbol (used by scheduler or testing)."""
    row = await iv_rank_svc.store_iv(db, symbol.upper(), body.iv_30d)
    return {"ticker": row.ticker, "date": str(row.date), "iv_rank": row.iv_rank, "iv_pct": row.iv_pct}


# ── Task 11: Backtesting ───────────────────────────────────────

class BacktestRequest(BaseModel):
    symbol: str
    bars: list[dict]              # [{t, o, h, l, c, v}, ...]
    initial_capital: float = 10_000.0
    stop_loss_pct: float = 0.02
    take_profit_pct: float = 0.04
    position_size_pct: float = 0.10


@router.post("/backtest")
async def run_backtest(body: BacktestRequest, current_user: CurrentUser):
    try:
        result = backtest_svc.run(
            symbol=body.symbol.upper(),
            bars=body.bars,
            initial_capital=body.initial_capital,
            stop_loss_pct=body.stop_loss_pct,
            take_profit_pct=body.take_profit_pct,
            position_size_pct=body.position_size_pct,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return backtest_svc.to_dict(result)
