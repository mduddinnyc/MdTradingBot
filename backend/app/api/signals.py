import uuid
from datetime import datetime, timezone

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func, select, update

from app.core.audit import log as audit_log
from app.core.deps import CurrentUser, DB
from app.core.encryption import decrypt_secret
from app.models.automation import AutomationConfig, Order
from app.models.broker import BrokerConnection
from app.models.market import Symbol, Watchlist, WatchlistItem
from app.models.signal import Signal
from app.schemas.auth import MessageResponse
from app.schemas.signal import (
    AutomationConfigRequest,
    AutomationConfigResponse,
    OrderResponse,
    RankedSignalResponse,
    SignalResponse,
    WatchlistAddRequest,
)
from app.services import market_data as md_svc
from app.services import signal_engine
from app.services import notifications as notif_svc
from app.services import options_strategy as opts_svc
from app.services.broker_adapter import get_adapter

router = APIRouter(prefix="/signals", tags=["signals"])


# ── Watchlist ──────────────────────────────────────────────────

@router.get("/watchlist")
async def get_watchlist(current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(Watchlist).where(
            Watchlist.user_id == current_user.id, Watchlist.is_default == True
        )
    )
    wl = result.scalar_one_or_none()
    if not wl:
        return []

    result = await db.execute(
        select(WatchlistItem, Symbol)
        .join(Symbol, WatchlistItem.symbol_id == Symbol.id)
        .where(WatchlistItem.watchlist_id == wl.id)
    )
    rows = result.all()
    return [{"ticker": sym.ticker, "name": sym.name, "added_at": item.added_at} for item, sym in rows]


@router.post("/watchlist", response_model=MessageResponse, status_code=201)
async def add_to_watchlist(body: WatchlistAddRequest, current_user: CurrentUser, db: DB):
    # Get or create default watchlist
    result = await db.execute(
        select(Watchlist).where(
            Watchlist.user_id == current_user.id, Watchlist.is_default == True
        )
    )
    wl = result.scalar_one_or_none()
    if not wl:
        wl = Watchlist(user_id=current_user.id, name="Default", is_default=True)
        db.add(wl)
        await db.flush()

    symbol = await md_svc.get_or_create_symbol(db, body.ticker)

    # Check not already on list
    result = await db.execute(
        select(WatchlistItem).where(
            WatchlistItem.watchlist_id == wl.id,
            WatchlistItem.symbol_id == symbol.id,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"{body.ticker} already on watchlist")

    db.add(WatchlistItem(watchlist_id=wl.id, symbol_id=symbol.id))
    return MessageResponse(message=f"{body.ticker} added to watchlist")


@router.delete("/watchlist/{ticker}", response_model=MessageResponse)
async def remove_from_watchlist(ticker: str, current_user: CurrentUser, db: DB):
    ticker = ticker.upper()
    result = await db.execute(
        select(Watchlist).where(
            Watchlist.user_id == current_user.id, Watchlist.is_default == True
        )
    )
    wl = result.scalar_one_or_none()
    if not wl:
        return MessageResponse(message=f"{ticker} not on watchlist")

    result = await db.execute(select(Symbol).where(Symbol.ticker == ticker))
    sym = result.scalar_one_or_none()
    if sym:
        result = await db.execute(
            select(WatchlistItem).where(
                WatchlistItem.watchlist_id == wl.id,
                WatchlistItem.symbol_id == sym.id,
            )
        )
        item = result.scalar_one_or_none()
        if item:
            await db.delete(item)

    return MessageResponse(message=f"{ticker} removed from watchlist")


# ── Signals ────────────────────────────────────────────────────

@router.get("/", response_model=list[SignalResponse])
async def get_signals(current_user: CurrentUser, db: DB, limit: int = 50):
    """Get latest signals for user's watchlisted symbols."""
    result = await db.execute(
        select(Watchlist).where(
            Watchlist.user_id == current_user.id, Watchlist.is_default == True
        )
    )
    wl = result.scalar_one_or_none()
    if not wl:
        return []

    result = await db.execute(
        select(WatchlistItem.symbol_id).where(WatchlistItem.watchlist_id == wl.id)
    )
    symbol_ids = [r[0] for r in result.all()]
    if not symbol_ids:
        return []

    result = await db.execute(
        select(Signal, Symbol)
        .join(Symbol, Signal.symbol_id == Symbol.id)
        .where(Signal.symbol_id.in_(symbol_ids))
        .order_by(Signal.created_at.desc())
        .limit(limit)
    )

    out = []
    for sig, sym in result.all():
        out.append(SignalResponse(
            id=sig.id,
            symbol=sym.ticker,
            signal_type=sig.signal_type,
            confidence=sig.confidence,
            timeframe=sig.timeframe,
            entry_price=sig.entry_price,
            target_price=sig.target_price,
            stop_price=sig.stop_price,
            pattern_detected=sig.pattern_detected,
            indicators=sig.indicators,
            reasoning=sig.reasoning,
            model_version=sig.model_version,
            expires_at=sig.expires_at,
            created_at=sig.created_at,
        ))
    return out


@router.get("/top-ranked", response_model=list[RankedSignalResponse])
async def get_top_ranked_signals(current_user: CurrentUser, db: DB, per_tier: int = 10):
    """
    Top (per_tier * 3) actionable opportunities across the user's watchlist,
    ranked by the signal engine's live confidence score (one row per symbol —
    its most recent BUY/SELL signal). Tiered by rank position, not a fixed
    confidence cutoff: positions 1..per_tier = green, next per_tier =
    light_green, next per_tier = light_yellow. HOLD signals and rows missing
    entry/target/stop are excluded — there's no real entry/exit point to
    show for those. `per_tier` defaults to 10 (Signals page); the Day Trade
    Signal page calls this with per_tier=20.
    """
    per_tier = max(1, min(per_tier, 50))

    result = await db.execute(
        select(Watchlist).where(
            Watchlist.user_id == current_user.id, Watchlist.is_default == True
        )
    )
    wl = result.scalar_one_or_none()
    if not wl:
        return []

    result = await db.execute(
        select(WatchlistItem.symbol_id).where(WatchlistItem.watchlist_id == wl.id)
    )
    symbol_ids = [r[0] for r in result.all()]
    if not symbol_ids:
        return []

    # Latest signal per symbol (not full history — "current best opportunities").
    latest = (
        select(Signal.symbol_id, func.max(Signal.created_at).label("max_created"))
        .where(Signal.symbol_id.in_(symbol_ids))
        .group_by(Signal.symbol_id)
        .subquery()
    )

    result = await db.execute(
        select(Signal, Symbol)
        .join(Symbol, Signal.symbol_id == Symbol.id)
        .join(
            latest,
            (Signal.symbol_id == latest.c.symbol_id) & (Signal.created_at == latest.c.max_created),
        )
        .where(
            Signal.signal_type.in_(["BUY", "SELL"]),
            Signal.entry_price.is_not(None),
        )
        .order_by(Signal.confidence.desc())
        .limit(per_tier * 3)
    )
    rows = result.all()

    out = []
    for i, (sig, sym) in enumerate(rows):
        rank = i + 1
        tier = "green" if rank <= per_tier else "light_green" if rank <= per_tier * 2 else "light_yellow"
        out.append(RankedSignalResponse(
            id=sig.id,
            symbol=sym.ticker,
            signal_type=sig.signal_type,
            confidence=sig.confidence,
            timeframe=sig.timeframe,
            entry_price=sig.entry_price,
            target_price=sig.target_price,
            stop_price=sig.stop_price,
            pattern_detected=sig.pattern_detected,
            indicators=sig.indicators,
            reasoning=sig.reasoning,
            model_version=sig.model_version,
            expires_at=sig.expires_at,
            created_at=sig.created_at,
            rank=rank,
            tier=tier,
            option_type="CALL" if sig.signal_type == "BUY" else "PUT",
        ))
    return out


@router.get("/detail/{ticker}")
async def get_signal_detail(ticker: str, current_user: CurrentUser, db: DB):
    """
    Everything the Day Trade Signal page's click-through view needs for one
    symbol: the latest signal, real bars for the chart, the live options
    chain (if the connected broker supports it), and a strategy
    recommendation derived from the real signal + real regime — not called
    on every 1s list refresh, only when a ticker is actually opened.
    """
    ticker = ticker.upper()

    result = await db.execute(select(Symbol).where(Symbol.ticker == ticker))
    sym = result.scalar_one_or_none()

    latest_signal = None
    if sym:
        result = await db.execute(
            select(Signal)
            .where(Signal.symbol_id == sym.id)
            .order_by(Signal.created_at.desc())
            .limit(1)
        )
        sig = result.scalar_one_or_none()
        if sig:
            latest_signal = {
                "signal_type": sig.signal_type,
                "confidence": sig.confidence,
                "entry_price": sig.entry_price,
                "target_price": sig.target_price,
                "stop_price": sig.stop_price,
                "pattern_detected": sig.pattern_detected,
                "indicators": sig.indicators,
                "reasoning": sig.reasoning,
                "created_at": sig.created_at.isoformat(),
            }

    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.user_id == current_user.id, BrokerConnection.is_active == True
        )
    )
    conn = result.scalars().first()

    bars: list[dict] = []
    options_chain = None
    regime = "sideways"

    if conn:
        adapter = get_adapter(conn.broker_name)
        try:
            bars = adapter.get_bars(conn, ticker, "1Day", 100)
        except Exception:
            bars = []

        if len(bars) >= 30:
            try:
                df = pd.DataFrame([
                    {"open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"], "volume": b["v"]}
                    for b in bars
                ])
                ind = signal_engine.compute_indicators(df)
                regime = signal_engine.detect_regime(df, ind)
            except Exception:
                regime = "sideways"

        if hasattr(adapter, "get_options_chain"):
            try:
                options_chain = adapter.get_options_chain(conn, ticker)
            except Exception:
                options_chain = None

    current_price = bars[-1]["c"] if bars else (latest_signal["entry_price"] if latest_signal else None)

    strategy_recommendation = None
    if latest_signal and current_price:
        rec = opts_svc.recommend(
            signal_type=latest_signal["signal_type"],
            regime=regime,
            iv_rank=None,
            current_price=current_price,
        )
        strategy_recommendation = opts_svc.to_dict(rec)

    return {
        "symbol": ticker,
        "signal": latest_signal,
        "bars": bars,
        "regime": regime,
        "options_chain": options_chain,
        "strategy_recommendation": strategy_recommendation,
        "has_broker_connection": conn is not None,
    }


@router.post("/refresh/{ticker}", response_model=SignalResponse)
async def refresh_signal(ticker: str, current_user: CurrentUser, db: DB):
    """Manually trigger signal generation for a ticker."""
    signal = await signal_engine.generate_signal(db, ticker.upper())
    if not signal:
        raise HTTPException(status_code=422, detail="Not enough candle data — add ticker to watchlist and wait for data to load")

    result = await db.execute(select(Symbol).where(Symbol.ticker == ticker.upper()))
    sym = result.scalar_one()

    return SignalResponse(
        id=signal.id,
        symbol=sym.ticker,
        signal_type=signal.signal_type,
        confidence=signal.confidence,
        timeframe=signal.timeframe,
        entry_price=signal.entry_price,
        target_price=signal.target_price,
        stop_price=signal.stop_price,
        pattern_detected=signal.pattern_detected,
        indicators=signal.indicators,
        reasoning=signal.reasoning,
        model_version=signal.model_version,
        expires_at=signal.expires_at,
        created_at=signal.created_at,
    )


# ── Automation config ──────────────────────────────────────────

@router.get("/automation", response_model=list[AutomationConfigResponse])
async def get_automation_configs(current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(AutomationConfig).where(AutomationConfig.user_id == current_user.id)
    )
    return result.scalars().all()


@router.post("/automation", response_model=AutomationConfigResponse, status_code=201)
async def create_automation_config(body: AutomationConfigRequest, request: Request, current_user: CurrentUser, db: DB):
    # Verify broker connection belongs to user
    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.id == body.broker_connection_id,
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.is_active == True,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Broker connection not found")

    config = AutomationConfig(
        user_id=current_user.id,
        broker_connection_id=body.broker_connection_id,
        is_enabled=body.is_enabled,
        min_confidence=body.min_confidence,
        max_position_size_usd=body.max_position_size_usd,
        max_position_pct=body.max_position_pct,
        stop_loss_pct=body.stop_loss_pct,
        take_profit_pct=body.take_profit_pct,
        max_daily_loss_usd=body.max_daily_loss_usd,
        max_open_positions=body.max_open_positions,
        cooldown_minutes=body.cooldown_minutes,
    )
    db.add(config)
    await db.flush()

    await audit_log(
        db, action="AUTOMATION_CREATED", outcome="success",
        user_id=current_user.id, resource_type="automation_config",
        resource_id=config.id, request=request
    )
    return config


@router.patch("/automation/{config_id}", response_model=AutomationConfigResponse)
async def update_automation_config(
    config_id: uuid.UUID, body: AutomationConfigRequest, request: Request,
    current_user: CurrentUser, db: DB
):
    result = await db.execute(
        select(AutomationConfig).where(
            AutomationConfig.id == config_id,
            AutomationConfig.user_id == current_user.id,
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Automation config not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(config, field, value)

    await audit_log(
        db, action="AUTOMATION_UPDATED", outcome="success",
        user_id=current_user.id, resource_type="automation_config",
        resource_id=config_id, request=request,
        metadata={"is_enabled": config.is_enabled}
    )
    return config


# ── Orders ─────────────────────────────────────────────────────

@router.get("/orders", response_model=list[OrderResponse])
async def get_orders(current_user: CurrentUser, db: DB, limit: int = 100):
    result = await db.execute(
        select(Order)
        .where(Order.user_id == current_user.id)
        .order_by(Order.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


# ── PDT status ─────────────────────────────────────────────────

@router.get("/pdt-status")
async def pdt_status(current_user: CurrentUser, db: DB):
    """
    Returns current day-trade count and PDT limit info for the user's
    active broker connections. Frontend uses this to show a warning banner.
    """
    from app.services.execution import _day_trade_count, PDT_WINDOW_DAYS, PDT_MAX_TRADES, PDT_EQUITY_MIN

    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.is_active == True,
        )
    )
    connections = result.scalars().all()

    statuses = []
    for conn in connections:
        try:
            account = get_adapter(conn.broker_name).get_account(conn)
            equity = float(account["equity"])
            count = await _day_trade_count(db, current_user.id, conn.id)
            statuses.append({
                "connection_id": str(conn.id),
                "display_name": conn.display_name,
                "equity": equity,
                "day_trade_count": count,
                "day_trade_limit": PDT_MAX_TRADES,
                "window_days": PDT_WINDOW_DAYS,
                "pdt_applies": equity < PDT_EQUITY_MIN,
                "at_limit": equity < PDT_EQUITY_MIN and count >= PDT_MAX_TRADES,
                "remaining": max(0, PDT_MAX_TRADES - count) if equity < PDT_EQUITY_MIN else None,
            })
        except Exception:
            pass
    return statuses


# ── Emergency stop ─────────────────────────────────────────────

@router.post("/emergency-stop")
async def emergency_stop(request: Request, current_user: CurrentUser, db: DB):
    """
    Kill switch: disables all automation configs and cancels all open orders
    for the current user. Attempts to cancel orders at the broker as well.
    """
    now = datetime.now(timezone.utc)

    # 1. Disable all automation configs
    result = await db.execute(
        select(AutomationConfig).where(AutomationConfig.user_id == current_user.id)
    )
    configs = result.scalars().all()
    configs_disabled = 0
    for cfg in configs:
        if cfg.is_enabled:
            cfg.is_enabled = False
            configs_disabled += 1

    # 2. Cancel all open orders in DB and attempt broker cancellation
    result = await db.execute(
        select(Order).where(
            Order.user_id == current_user.id,
            Order.status.in_(["pending", "submitted", "partially_filled"]),
        )
    )
    open_orders = result.scalars().all()
    orders_cancelled = 0

    # Gather unique broker connections for batch cancel
    conn_ids: set[uuid.UUID] = {o.broker_connection_id for o in open_orders}
    for conn_id in conn_ids:
        result = await db.execute(
            select(BrokerConnection).where(BrokerConnection.id == conn_id)
        )
        conn = result.scalar_one_or_none()
        if conn and conn.is_active:
            try:
                get_adapter(conn.broker_name).cancel_all_orders(conn)
            except Exception:
                pass  # best-effort — still cancel in DB

    for order in open_orders:
        order.status = "cancelled"
        order.cancelled_at = now
        orders_cancelled += 1

    await audit_log(
        db,
        action="EMERGENCY_STOP",
        outcome="success",
        user_id=current_user.id,
        resource_type="automation",
        metadata={
            "configs_disabled": configs_disabled,
            "orders_cancelled": orders_cancelled,
        },
        request=request,
    )

    notif_svc.notify_emergency_stop(configs_disabled, orders_cancelled)

    return {
        "message": "Emergency stop executed",
        "configs_disabled": configs_disabled,
        "orders_cancelled": orders_cancelled,
    }


# ── Task 9: Options strategy recommendation ────────────────────

from pydantic import BaseModel as _BM  # noqa: E402


class OptionsStrategyRequest(_BM):
    symbol: str
    signal_type: str = "HOLD"
    regime: str = "sideways"
    iv_rank: float | None = None
    current_price: float = 100.0


@router.post("/options-strategy")
async def options_strategy(body: OptionsStrategyRequest, current_user: CurrentUser):
    """
    Given a signal + market regime + IV rank, return the best options strategy.
    Does not place orders — returns recommendation for user review.
    """
    rec = opts_svc.recommend(
        signal_type=body.signal_type.upper(),
        regime=body.regime,
        iv_rank=body.iv_rank,
        current_price=body.current_price,
    )
    return opts_svc.to_dict(rec)
