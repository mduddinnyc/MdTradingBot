import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select, update

from app.core.audit import log as audit_log
from app.core.deps import CurrentUser, DB
from app.core.encryption import decrypt_secret
from app.models.automation import AutomationConfig, OptionsAutomationConfig, Order, Strategy, UserStrategyConfig
from app.models.broker import BrokerConnection
from app.models.market import Symbol, Watchlist, WatchlistItem
from app.models.signal import Signal
from app.schemas.auth import MessageResponse
from app.schemas.signal import (
    AutomationConfigRequest,
    AutomationConfigResponse,
    ManualOptionOrderRequest,
    ManualOrderRequest,
    RiskProfileWizardRequest,
    OptionsAutomationConfigRequest,
    OptionsAutomationConfigResponse,
    OrderResponse,
    PendingOptionOrderResponse,
    RankedSignalResponse,
    SignalResponse,
    StrategyConfigRequest,
    StrategyPerformanceResponse,
    StrategyResponse,
    WatchlistAddRequest,
)
from app.services.day_trade_universe import DAY_TRADE_UNIVERSE
from app.services import execution as exec_svc
from app.services import market_data as md_svc
from app.services import signal_engine
from app.services import notifications as notif_svc
from app.services import options_execution as opt_exec
from app.services import options_strategy as opts_svc
from app.services.broker_adapter import get_adapter

router = APIRouter(prefix="/signals", tags=["signals"])

_ORDER_HISTORY_RANGE_DAYS = {"7d": 7, "30d": 30, "1y": 365}


def _parse_broker_date(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


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
async def get_top_ranked_signals(
    current_user: CurrentUser, db: DB, per_tier: int = 10, universe: str = "watchlist"
):
    """
    Top (per_tier * 3) actionable opportunities, ranked by the signal
    engine's live confidence score (one row per symbol — its most recent
    BUY/SELL signal). Tiered by rank position, not a fixed confidence
    cutoff: positions 1..per_tier = green, next per_tier = light_green, next
    per_tier = light_yellow. HOLD signals and rows missing entry/target/stop
    are excluded — there's no real entry/exit point to show for those.

    `universe="watchlist"` (default, Signals page): scoped to the user's own
    watchlist — can be as small as a handful of symbols.
    `universe="daytrade"` (Day Trade Signal page): the user's watchlist PLUS
    a fixed list of ~40 liquid large-caps (DAY_TRADE_UNIVERSE) — a small
    personal watchlist can't produce a real top-20+ pool on its own.
    """
    per_tier = max(1, min(per_tier, 50))

    result = await db.execute(
        select(Watchlist).where(
            Watchlist.user_id == current_user.id, Watchlist.is_default == True
        )
    )
    wl = result.scalar_one_or_none()

    symbol_ids: list[int] = []
    if wl:
        result = await db.execute(
            select(WatchlistItem.symbol_id).where(WatchlistItem.watchlist_id == wl.id)
        )
        symbol_ids = [r[0] for r in result.all()]

    if universe == "daytrade":
        result = await db.execute(
            select(Symbol.id).where(Symbol.ticker.in_(DAY_TRADE_UNIVERSE))
        )
        symbol_ids = list({*symbol_ids, *(r[0] for r in result.all())})

    if not symbol_ids:
        return []

    rows = await signal_engine.get_ranked_signals(db, symbol_ids, limit=per_tier * 3)

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
    quote = None

    if conn:
        adapter = get_adapter(conn.broker_name)
        try:
            bars = adapter.get_bars(conn, ticker, "1Day", 100)
        except Exception:
            bars = []

        if hasattr(adapter, "get_latest_quote"):
            try:
                quote = adapter.get_latest_quote(conn, ticker)
            except Exception:
                quote = None

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
        "quote": quote,
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

# Risk Profile Wizard presets — docs/AUTOPILOT_MODE_DESIGN.md §2.2.
# max_daily_loss_usd is mandatory here (computed below, % of live equity)
# even though it stays nullable on the column for the manual form.
RISK_PROFILE_PRESETS = {
    # Signal engine produces confidence 0.10–0.70 in practice (weighted indicator
    # fusion, abs of raw score). Typical strong BUY/SELL: 0.25–0.55. Old presets
    # (0.75/0.60/0.55) blocked virtually every real signal — corrected here.
    "conservative": {
        "min_confidence": 0.55, "max_position_pct": 0.05,
        "stop_loss_pct": 0.015, "take_profit_pct": 0.03,
        "max_open_positions": 3, "cooldown_minutes": 90, "daily_loss_pct": 0.02,
    },
    "balanced": {
        "min_confidence": 0.35, "max_position_pct": 0.10,
        "stop_loss_pct": 0.02, "take_profit_pct": 0.04,
        "max_open_positions": 5, "cooldown_minutes": 60, "daily_loss_pct": 0.03,
    },
    "aggressive": {
        "min_confidence": 0.20, "max_position_pct": 0.15,
        "stop_loss_pct": 0.03, "take_profit_pct": 0.06,
        "max_open_positions": 8, "cooldown_minutes": 30, "daily_loss_pct": 0.05,
    },
}


@router.post("/automation/wizard", response_model=AutomationConfigResponse, status_code=201)
async def apply_risk_profile_wizard(body: RiskProfileWizardRequest, request: Request, current_user: CurrentUser, db: DB):
    """
    The 3-tap path: risk appetite -> capital -> universe. Always sets
    max_daily_loss_usd (the doc's Critical gap — today's manual form
    leaves it optional). Re-running this replaces the user's existing
    config for this connection rather than creating a second one.
    """
    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.id == body.broker_connection_id,
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.is_active == True,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Broker connection not found")

    adapter = get_adapter(conn.broker_name)
    account = adapter.get_account(conn)
    equity = float(account["equity"])
    if equity <= 0:
        raise HTTPException(status_code=400, detail="Account equity must be positive to size an automation profile")

    preset = RISK_PROFILE_PRESETS[body.risk_profile]
    capital_usd = body.capital_value if body.capital_mode == "dollar" else equity * body.capital_value / 100
    capital_usd = min(capital_usd, equity)

    if body.universe == "day_trade_scan":
        result = await db.execute(
            select(Watchlist).where(Watchlist.user_id == current_user.id, Watchlist.is_default == True)
        )
        wl = result.scalar_one_or_none()
        if not wl:
            wl = Watchlist(user_id=current_user.id, name="Default", is_default=True)
            db.add(wl)
            await db.flush()
        result = await db.execute(select(WatchlistItem.symbol_id).where(WatchlistItem.watchlist_id == wl.id))
        existing_symbol_ids = {row[0] for row in result.all()}
        for ticker in DAY_TRADE_UNIVERSE:
            symbol = await md_svc.get_or_create_symbol(db, ticker)
            if symbol.id not in existing_symbol_ids:
                db.add(WatchlistItem(watchlist_id=wl.id, symbol_id=symbol.id))
                existing_symbol_ids.add(symbol.id)

    result = await db.execute(
        select(AutomationConfig).where(
            AutomationConfig.user_id == current_user.id,
            AutomationConfig.broker_connection_id == conn.id,
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        config = AutomationConfig(user_id=current_user.id, broker_connection_id=conn.id)
        db.add(config)

    config.is_enabled = body.is_enabled
    config.min_confidence = preset["min_confidence"]
    config.max_position_pct = preset["max_position_pct"]
    config.max_position_size_usd = round(capital_usd / preset["max_open_positions"], 2)
    config.stop_loss_pct = preset["stop_loss_pct"]
    config.take_profit_pct = preset["take_profit_pct"]
    config.max_open_positions = preset["max_open_positions"]
    config.cooldown_minutes = preset["cooldown_minutes"]
    config.max_daily_loss_usd = round(equity * preset["daily_loss_pct"], 2)
    await db.flush()

    await audit_log(
        db, action="AUTOMATION_WIZARD_APPLIED", outcome="success",
        user_id=current_user.id, resource_type="automation_config", resource_id=config.id, request=request,
        metadata={"risk_profile": body.risk_profile, "universe": body.universe, "capital_usd": capital_usd, "equity": equity},
    )
    return config


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


# ── Options automation (paper-trading only, single-leg calls/puts) ──

@router.get("/options-automation", response_model=list[OptionsAutomationConfigResponse])
async def get_options_automation_configs(current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(OptionsAutomationConfig).where(OptionsAutomationConfig.user_id == current_user.id)
    )
    return result.scalars().all()


@router.post("/options-automation", response_model=OptionsAutomationConfigResponse, status_code=201)
async def create_options_automation_config(
    body: OptionsAutomationConfigRequest, request: Request, current_user: CurrentUser, db: DB
):
    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.id == body.broker_connection_id,
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.is_active == True,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Broker connection not found")

    config = OptionsAutomationConfig(
        user_id=current_user.id,
        broker_connection_id=body.broker_connection_id,
        is_enabled=body.is_enabled,
        require_manual_approval=body.require_manual_approval,
        budget_usd=body.budget_usd,
        min_confidence=body.min_confidence,
        max_contracts_per_trade=body.max_contracts_per_trade,
        max_open_positions=body.max_open_positions,
        target_dte_min=body.target_dte_min,
        target_dte_max=body.target_dte_max,
        profit_target_pct=body.profit_target_pct,
        stop_loss_pct=body.stop_loss_pct,
    )
    db.add(config)
    await db.flush()

    await audit_log(
        db, action="OPTIONS_AUTOMATION_CREATED", outcome="success",
        user_id=current_user.id, resource_type="options_automation_config",
        resource_id=config.id, request=request,
    )
    return config


@router.patch("/options-automation/{config_id}", response_model=OptionsAutomationConfigResponse)
async def update_options_automation_config(
    config_id: uuid.UUID, body: OptionsAutomationConfigRequest, request: Request,
    current_user: CurrentUser, db: DB,
):
    result = await db.execute(
        select(OptionsAutomationConfig).where(
            OptionsAutomationConfig.id == config_id,
            OptionsAutomationConfig.user_id == current_user.id,
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Options automation config not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(config, field, value)

    await audit_log(
        db, action="OPTIONS_AUTOMATION_UPDATED", outcome="success",
        user_id=current_user.id, resource_type="options_automation_config",
        resource_id=config_id, request=request,
        metadata={"is_enabled": config.is_enabled},
    )
    return config


@router.post("/options-automation/manual", response_model=PendingOptionOrderResponse, status_code=201)
async def stage_manual_option_order(body: ManualOptionOrderRequest, request: Request, current_user: CurrentUser, db: DB):
    """
    User picked a real contract off the chain themselves (order ticket) —
    stages it exactly like an automation-found candidate, same
    pending_approval gate, same /approve and /reject endpoints. Premium is
    always read fresh from a live quote here, never trusted from the
    client, same as every other price in this app.
    """
    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.id == body.broker_connection_id,
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.is_active == True,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Broker connection not found")

    adapter = get_adapter(conn.broker_name)
    if not hasattr(adapter, "get_latest_quote"):
        raise HTTPException(status_code=501, detail=f"{conn.broker_name} does not support options trading yet")

    try:
        quote = adapter.get_latest_quote(conn, body.option_symbol)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not get a live price for {body.option_symbol}: {exc}")

    premium = quote.get("ask_price") if body.side == "buy" else quote.get("bid_price")
    if not premium:
        raise HTTPException(status_code=400, detail=f"No live {'ask' if body.side == 'buy' else 'bid'} price available for {body.option_symbol}")

    if body.side == "sell":
        try:
            positions = adapter.get_positions(conn)
            held = next((float(p["qty"]) for p in positions if p.get("symbol") == body.option_symbol), 0.0)
        except Exception:
            held = None
        if held is not None and body.quantity > held:
            raise HTTPException(
                status_code=400,
                detail=f"You hold {held:g} contracts of {body.option_symbol} — cannot sell {body.quantity}",
            )
    else:
        spent = await opt_exec.get_spent_budget(db, current_user.id)
        result = await db.execute(
            select(OptionsAutomationConfig).where(OptionsAutomationConfig.user_id == current_user.id)
        )
        config = result.scalar_one_or_none()
        budget = config.budget_usd if config else 10_000.0
        cost = premium * body.quantity * 100
        if spent + cost > budget:
            raise HTTPException(
                status_code=400,
                detail=f"This would cost ~${cost:,.2f}; only ${budget - spent:,.2f} of your options budget remains",
            )

    order = Order(
        user_id=current_user.id,
        broker_connection_id=conn.id,
        ticker=body.ticker,
        side=body.side,
        quantity=body.quantity,
        status="pending_approval",
        is_automated=False,
        asset_type="option",
        option_symbol=body.option_symbol,
        strike_price=body.strike_price,
        expiration_date=body.expiration_date,
        option_right=body.option_right,
        premium_paid=float(premium),
    )
    db.add(order)
    await db.flush()

    await audit_log(
        db, action="OPTIONS_MANUAL_ORDER_STAGED", outcome="success",
        user_id=current_user.id, resource_type="order", resource_id=order.id, request=request,
        metadata={"ticker": order.ticker, "option_symbol": order.option_symbol, "side": order.side},
    )
    return order


@router.get("/options-automation/pending", response_model=list[PendingOptionOrderResponse])
async def get_pending_option_orders(current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(Order).where(
            Order.user_id == current_user.id,
            Order.asset_type == "option",
            Order.status == "pending_approval",
        ).order_by(Order.created_at.desc())
    )
    return result.scalars().all()


@router.post("/options-automation/approve-all", response_model=list[PendingOptionOrderResponse])
async def approve_all_pending_option_orders(request: Request, current_user: CurrentUser, db: DB):
    """
    Approves every pending_approval option order for the user, oldest first.
    Each one still goes through approve_staged_order's own budget re-check —
    approving five at once doesn't skip the cap, it just means the 3rd or
    4th in line may get correctly cancelled once the earlier approvals in
    this same batch have used up the budget. One order's failure doesn't
    stop the rest from being attempted.
    """
    result = await db.execute(
        select(Order).where(
            Order.user_id == current_user.id,
            Order.asset_type == "option",
            Order.status == "pending_approval",
        ).order_by(Order.created_at.asc())
    )
    orders = result.scalars().all()

    touched = []
    for order in orders:
        result = await db.execute(
            select(BrokerConnection).where(BrokerConnection.id == order.broker_connection_id)
        )
        conn = result.scalar_one_or_none()
        if not conn or not conn.is_active:
            order.status = "cancelled"
            order.rejection_reason = "Broker connection is no longer active"
            await db.flush()
            touched.append(order)
            continue
        try:
            order = await opt_exec.approve_staged_order(db, conn, order)
        except Exception as exc:
            order.status = "cancelled"
            order.rejection_reason = str(exc)
            await db.flush()
        touched.append(order)

    await audit_log(
        db, action="OPTIONS_ORDER_APPROVE_ALL", outcome="success",
        user_id=current_user.id, resource_type="order", request=request,
        metadata={
            "attempted": len(touched),
            "submitted": sum(1 for o in touched if o.status in ("submitted", "filled")),
            "cancelled": sum(1 for o in touched if o.status == "cancelled"),
        },
    )
    return touched


@router.post("/options-automation/{order_id}/approve", response_model=PendingOptionOrderResponse)
async def approve_pending_option_order(order_id: uuid.UUID, request: Request, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(Order).where(Order.id == order_id, Order.user_id == current_user.id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Order is not pending approval (status={order.status})")

    result = await db.execute(
        select(BrokerConnection).where(BrokerConnection.id == order.broker_connection_id)
    )
    conn = result.scalar_one_or_none()
    if not conn or not conn.is_active:
        raise HTTPException(status_code=400, detail="Broker connection is no longer active")

    order = await opt_exec.approve_staged_order(db, conn, order)

    await audit_log(
        db, action="OPTIONS_ORDER_APPROVED", outcome="success" if order.status in ("submitted", "filled") else "blocked",
        user_id=current_user.id, resource_type="order", resource_id=order.id, request=request,
        metadata={"ticker": order.ticker, "option_symbol": order.option_symbol, "status": order.status},
    )
    return order


@router.post("/options-automation/{order_id}/reject", response_model=PendingOptionOrderResponse)
async def reject_pending_option_order(order_id: uuid.UUID, request: Request, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(Order).where(Order.id == order_id, Order.user_id == current_user.id)
    )
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Order is not pending approval (status={order.status})")

    order.status = "cancelled"
    order.cancelled_at = datetime.now(timezone.utc)
    order.rejection_reason = "Rejected by user"
    await db.flush()

    await audit_log(
        db, action="OPTIONS_ORDER_REJECTED", outcome="success",
        user_id=current_user.id, resource_type="order", resource_id=order.id, request=request,
    )
    return order


# ── Orders ─────────────────────────────────────────────────────

async def _get_realized_pnl_map(db: DB, user_id: uuid.UUID, orders: list[Order], since: datetime | None) -> dict[uuid.UUID, dict]:
    """
    Matches orders against the broker's own closed-position ledger to find
    realized exit/P&L. Never estimated locally — only what the broker's
    own gain/loss history confirms. Greedy nearest-date match per symbol,
    shared by /orders and the strategy performance endpoints so the two
    can never disagree on what counts as a real, closed trade.
    """
    if not orders:
        return {}
    result = await db.execute(
        select(BrokerConnection).where(BrokerConnection.user_id == user_id, BrokerConnection.is_active == True)
    )
    conn = result.scalars().first()
    if not conn:
        return {}
    adapter = get_adapter(conn.broker_name)
    if not hasattr(adapter, "get_gain_loss"):
        return {}

    try:
        closed = adapter.get_gain_loss(conn, start=since.strftime("%Y-%m-%d") if since else None)
    except Exception:
        closed = []

    unmatched = list(closed)
    pnl_map: dict[uuid.UUID, dict] = {}
    for order in orders:
        symbol = order.option_symbol if order.asset_type == "option" else order.ticker
        open_ref = (order.filled_at or order.submitted_at or order.created_at).replace(tzinfo=None)
        candidates = [c for c in unmatched if c["symbol"] == symbol and c.get("open_date")]
        if not candidates:
            continue
        best = min(candidates, key=lambda c: abs((_parse_broker_date(c["open_date"]).replace(tzinfo=None) - open_ref).days))
        pnl_map[order.id] = {
            "exit_price": best["exit_price"],
            "closed_at": _parse_broker_date(best["close_date"]),
            "pnl_usd": best["gain_loss"],
            "pnl_pct": best["gain_loss_pct"],
        }
        unmatched.remove(best)
    return pnl_map


@router.get("/orders", response_model=list[OrderResponse])
async def get_orders(current_user: CurrentUser, db: DB, limit: int = 100, period: str = "all"):
    """
    Order audit log, optionally enriched with realized entry/exit/P&L for
    orders the broker's own closed-position ledger confirms were closed.
    We don't track closing fills ourselves yet, so exit/P&L stay null for
    anything that ledger doesn't corroborate — never estimated locally.
    """
    query = select(Order).where(Order.user_id == current_user.id)
    since = None
    if period == "today":
        since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        query = query.where(Order.created_at >= since)
    elif period in _ORDER_HISTORY_RANGE_DAYS:
        since = datetime.now(timezone.utc) - timedelta(days=_ORDER_HISTORY_RANGE_DAYS[period])
        query = query.where(Order.created_at >= since)

    result = await db.execute(query.order_by(Order.created_at.desc()).limit(limit))
    orders = result.scalars().all()
    responses = [OrderResponse.model_validate(o) for o in orders]

    pnl_map = await _get_realized_pnl_map(db, current_user.id, orders, since)
    for resp, order in zip(responses, orders):
        info = pnl_map.get(order.id)
        if info:
            resp.exit_price = info["exit_price"]
            resp.closed_at = info["closed_at"]
            resp.pnl_usd = info["pnl_usd"]
            resp.pnl_pct = info["pnl_pct"]

    signal_ids = [o.signal_id for o in orders if o.signal_id]
    if signal_ids:
        result = await db.execute(
            select(Signal.id, Strategy.name)
            .join(Strategy, Signal.strategy_id == Strategy.id)
            .where(Signal.id.in_(signal_ids))
        )
        strategy_by_signal = dict(result.all())
        for resp, order in zip(responses, orders):
            if order.signal_id in strategy_by_signal:
                resp.strategy_name = strategy_by_signal[order.signal_id]

    return responses


# ── Strategies ─────────────────────────────────────────────────

@router.get("/strategies", response_model=list[StrategyResponse])
async def get_strategies(current_user: CurrentUser, db: DB):
    result = await db.execute(select(Strategy).order_by(Strategy.key))
    strategies = result.scalars().all()

    result = await db.execute(
        select(BrokerConnection).where(BrokerConnection.user_id == current_user.id, BrokerConnection.is_active == True)
    )
    conn = result.scalars().first()

    config_by_strategy: dict[uuid.UUID, UserStrategyConfig] = {}
    if conn:
        result = await db.execute(
            select(UserStrategyConfig).where(
                UserStrategyConfig.user_id == current_user.id,
                UserStrategyConfig.broker_connection_id == conn.id,
            )
        )
        config_by_strategy = {c.strategy_id: c for c in result.scalars().all()}

    # Real win-rate/P&L per strategy from this user's own closed orders, all-time.
    result = await db.execute(
        select(Order, Signal.strategy_id)
        .join(Signal, Order.signal_id == Signal.id)
        .where(Order.user_id == current_user.id, Signal.strategy_id.is_not(None))
    )
    rows = result.all()
    orders_by_strategy: dict[uuid.UUID, list[Order]] = {}
    for order, strategy_id in rows:
        orders_by_strategy.setdefault(strategy_id, []).append(order)

    all_orders = [o for o, _ in rows]
    pnl_map = await _get_realized_pnl_map(db, current_user.id, all_orders, since=None)

    out = []
    for strat in strategies:
        cfg = config_by_strategy.get(strat.id)
        strat_orders = orders_by_strategy.get(strat.id, [])
        closed_pnls = [pnl_map[o.id]["pnl_usd"] for o in strat_orders if o.id in pnl_map]

        out.append(StrategyResponse(
            id=strat.id, key=strat.key, name=strat.name, description=strat.description,
            w_trend=strat.w_trend, w_momentum=strat.w_momentum, w_pattern=strat.w_pattern,
            allowed_regimes=strat.allowed_regimes, min_volume_ratio=strat.min_volume_ratio,
            is_enabled=cfg.is_enabled if cfg else False,
            mode=cfg.mode if cfg else "manual",
            allocated_capital_usd=cfg.allocated_capital_usd if cfg else 1000.0,
            expires_at=cfg.expires_at if cfg else None,
            total_trades=len(closed_pnls),
            wins=sum(1 for p in closed_pnls if p > 0),
            win_rate=(sum(1 for p in closed_pnls if p > 0) / len(closed_pnls)) if closed_pnls else None,
            total_pnl_usd=sum(closed_pnls) if closed_pnls else None,
        ))
    return out


@router.put("/strategies/{strategy_id}/config", response_model=StrategyResponse)
async def update_strategy_config(strategy_id: uuid.UUID, body: StrategyConfigRequest, request: Request, current_user: CurrentUser, db: DB):
    result = await db.execute(select(Strategy).where(Strategy.id == strategy_id))
    strat = result.scalar_one_or_none()
    if not strat:
        raise HTTPException(status_code=404, detail="Strategy not found")

    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.id == body.broker_connection_id,
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.is_active == True,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Broker connection not found")

    result = await db.execute(
        select(UserStrategyConfig).where(
            UserStrategyConfig.user_id == current_user.id,
            UserStrategyConfig.broker_connection_id == conn.id,
            UserStrategyConfig.strategy_id == strategy_id,
        )
    )
    cfg = result.scalar_one_or_none()
    if cfg:
        cfg.is_enabled = body.is_enabled
        cfg.mode = body.mode
        cfg.allocated_capital_usd = body.allocated_capital_usd
        cfg.expires_at = body.expires_at
    else:
        cfg = UserStrategyConfig(
            user_id=current_user.id, broker_connection_id=conn.id, strategy_id=strategy_id,
            is_enabled=body.is_enabled, mode=body.mode, allocated_capital_usd=body.allocated_capital_usd,
            expires_at=body.expires_at,
        )
        db.add(cfg)
    await db.flush()

    await audit_log(
        db, action="STRATEGY_CONFIG_UPDATED", outcome="success",
        user_id=current_user.id, resource_type="strategy", resource_id=strategy_id, request=request,
        metadata={"key": strat.key, "is_enabled": body.is_enabled, "mode": body.mode,
                  "allocated_capital_usd": body.allocated_capital_usd, "expires_at": str(body.expires_at)},
    )

    return StrategyResponse(
        id=strat.id, key=strat.key, name=strat.name, description=strat.description,
        w_trend=strat.w_trend, w_momentum=strat.w_momentum, w_pattern=strat.w_pattern,
        allowed_regimes=strat.allowed_regimes, min_volume_ratio=strat.min_volume_ratio,
        is_enabled=cfg.is_enabled, mode=cfg.mode, allocated_capital_usd=cfg.allocated_capital_usd,
        expires_at=cfg.expires_at,
        total_trades=0, wins=0, win_rate=None, total_pnl_usd=None,
    )


@router.get("/strategies/performance", response_model=list[StrategyPerformanceResponse])
async def get_strategy_performance(current_user: CurrentUser, db: DB, period: str = "7d"):
    """Daily/weekly/monthly comparison: which strategy is actually making money for this user, from real closed trades only."""
    since = None
    if period == "today":
        since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    elif period in _ORDER_HISTORY_RANGE_DAYS:
        since = datetime.now(timezone.utc) - timedelta(days=_ORDER_HISTORY_RANGE_DAYS[period])

    query = (
        select(Order, Signal.strategy_id, Strategy.key, Strategy.name)
        .join(Signal, Order.signal_id == Signal.id)
        .join(Strategy, Signal.strategy_id == Strategy.id)
        .where(Order.user_id == current_user.id)
    )
    if since:
        query = query.where(Order.created_at >= since)
    result = await db.execute(query)
    rows = result.all()

    grouped: dict[uuid.UUID, dict] = {}
    for order, strategy_id, key, name in rows:
        grouped.setdefault(strategy_id, {"key": key, "name": name, "orders": []})["orders"].append(order)

    all_orders = [o for o, _, _, _ in rows]
    pnl_map = await _get_realized_pnl_map(db, current_user.id, all_orders, since)

    out = []
    for strategy_id, info in grouped.items():
        closed = [(o, pnl_map[o.id]) for o in info["orders"] if o.id in pnl_map]
        pnls = [p["pnl_usd"] for _, p in closed]
        pcts = [p["pnl_pct"] for _, p in closed if p["pnl_pct"] is not None]
        out.append(StrategyPerformanceResponse(
            strategy_id=strategy_id, strategy_key=info["key"], strategy_name=info["name"],
            trades=len(closed),
            wins=sum(1 for p in pnls if p > 0),
            win_rate=(sum(1 for p in pnls if p > 0) / len(pnls)) if pnls else None,
            total_pnl_usd=sum(pnls) if pnls else None,
            avg_pnl_pct=(sum(pcts) / len(pcts)) if pcts else None,
        ))

    out.sort(key=lambda r: (r.total_pnl_usd if r.total_pnl_usd is not None else float("-inf")), reverse=True)
    return out


@router.post("/orders/{order_id}/approve", response_model=OrderResponse)
async def approve_order(order_id: uuid.UUID, request: Request, current_user: CurrentUser, db: DB):
    """Unified approve for any pending_approval order — dispatches by
    asset_type since options and equity strategy orders place through
    different broker calls but share the same Approve button on the
    Orders page."""
    result = await db.execute(select(Order).where(Order.id == order_id, Order.user_id == current_user.id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Order is not pending approval (status={order.status})")

    result = await db.execute(select(BrokerConnection).where(BrokerConnection.id == order.broker_connection_id))
    conn = result.scalar_one_or_none()
    if not conn or not conn.is_active:
        raise HTTPException(status_code=400, detail="Broker connection is no longer active")

    if order.asset_type == "option":
        order = await opt_exec.approve_staged_order(db, conn, order)
    else:
        order = await exec_svc.approve_staged_equity_order(db, conn, order)

    await audit_log(
        db, action="ORDER_APPROVED", outcome="success" if order.status in ("submitted", "filled") else "blocked",
        user_id=current_user.id, resource_type="order", resource_id=order.id, request=request,
        metadata={"ticker": order.ticker, "asset_type": order.asset_type, "status": order.status},
    )
    return order


@router.post("/orders/{order_id}/reject", response_model=OrderResponse)
async def reject_order(order_id: uuid.UUID, request: Request, current_user: CurrentUser, db: DB):
    result = await db.execute(select(Order).where(Order.id == order_id, Order.user_id == current_user.id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Order is not pending approval (status={order.status})")

    if order.asset_type == "option":
        order.status = "cancelled"
        order.cancelled_at = datetime.now(timezone.utc)
        order.rejection_reason = "Rejected by user"
        await db.flush()
    else:
        order = await exec_svc.reject_staged_equity_order(db, order)

    await audit_log(
        db, action="ORDER_REJECTED", outcome="success",
        user_id=current_user.id, resource_type="order", resource_id=order.id, request=request,
    )
    return order


@router.post("/orders/manual", response_model=OrderResponse, status_code=201)
async def place_manual_order(body: ManualOrderRequest, request: Request, current_user: CurrentUser, db: DB):
    """
    User-initiated equity order placed directly through the order ticket —
    not gated by AutomationConfig rules (confidence thresholds, cooldowns,
    regime filters), since those are automated-strategy concerns, not
    relevant to a trade the user is consciously placing themselves.
    """
    result = await db.execute(
        select(BrokerConnection).where(
            BrokerConnection.id == body.broker_connection_id,
            BrokerConnection.user_id == current_user.id,
            BrokerConnection.is_active == True,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Broker connection not found")

    adapter = get_adapter(conn.broker_name)
    if not hasattr(adapter, "place_order"):
        raise HTTPException(status_code=501, detail=f"{conn.broker_name} does not support manual order placement yet")

    # Standard pre-trade checks — same things a real brokerage validates
    # before accepting an order, not just whatever Tradier itself enforces.
    if body.quantity != int(body.quantity):
        raise HTTPException(status_code=400, detail="Quantity must be a whole number of shares")

    if hasattr(adapter, "get_market_clock"):
        try:
            clock = adapter.get_market_clock(conn)
        except Exception:
            clock = None
        if clock and clock.get("state") != "open":
            why = clock.get("description") or f"next change at {clock.get('next_change')}"
            raise HTTPException(status_code=400, detail=f"Market is {clock.get('state', 'closed')} — {why}")

    ref_price = body.limit_price
    if ref_price is None and hasattr(adapter, "get_latest_quote"):
        try:
            quote = adapter.get_latest_quote(conn, body.ticker)
            ref_price = quote.get("last") or quote.get("ask_price") or None
        except Exception:
            ref_price = None

    if body.side == "buy":
        try:
            account = adapter.get_account(conn)
            buying_power = float(account.get("buying_power") or 0)
        except Exception:
            buying_power = None
        if ref_price and buying_power is not None:
            est_cost = ref_price * body.quantity
            if est_cost > buying_power:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient buying power: order costs ~${est_cost:,.2f}, ${buying_power:,.2f} available",
                )
    else:
        try:
            positions = adapter.get_positions(conn)
            held = next((float(p["qty"]) for p in positions if p.get("symbol") == body.ticker), 0.0)
        except Exception:
            held = None
        if held is not None and body.quantity > held:
            raise HTTPException(
                status_code=400,
                detail=f"You hold {held:g} shares of {body.ticker} — cannot sell {body.quantity:g}",
            )

    if ref_price:
        if body.stop_loss_price is not None:
            if body.side == "buy" and body.stop_loss_price >= ref_price:
                raise HTTPException(status_code=400, detail="Stop-loss must be below the entry price on a buy")
            if body.side == "sell" and body.stop_loss_price <= ref_price:
                raise HTTPException(status_code=400, detail="Stop-loss must be above the entry price on a sell")
        if body.take_profit_price is not None:
            if body.side == "buy" and body.take_profit_price <= ref_price:
                raise HTTPException(status_code=400, detail="Take-profit must be above the entry price on a buy")
            if body.side == "sell" and body.take_profit_price >= ref_price:
                raise HTTPException(status_code=400, detail="Take-profit must be below the entry price on a sell")

    res = adapter.place_order(
        conn, body.ticker, Decimal(str(body.quantity)), body.side,
        order_type=body.order_type,
        limit_price=Decimal(str(body.limit_price)) if body.limit_price is not None else None,
        take_profit_price=Decimal(str(body.take_profit_price)) if body.take_profit_price is not None else None,
        stop_loss_price=Decimal(str(body.stop_loss_price)) if body.stop_loss_price is not None else None,
    )

    order = Order(
        user_id=current_user.id,
        broker_connection_id=conn.id,
        ticker=body.ticker,
        order_type=body.order_type,
        side=body.side,
        quantity=body.quantity,
        limit_price=body.limit_price,
        take_profit_price=body.take_profit_price,
        stop_price=body.stop_loss_price,
        broker_order_id=res.get("id") or None,
        status=res.get("status") or "submitted",
        is_automated=False,
        asset_type="equity",
        submitted_at=datetime.now(timezone.utc),
    )

    # Tradier paper market orders often fill within the same request cycle —
    # reflect that immediately instead of leaving the order stuck at
    # "submitted" when it's actually already filled (same pattern used for
    # option orders in options_execution.py::approve_staged_order). A single
    # immediate check sometimes races ahead of Tradier registering the fill,
    # so retry briefly rather than give up after one look.
    if hasattr(adapter, "get_orders") and order.broker_order_id:
        for attempt in range(3):
            if attempt:
                await asyncio.sleep(0.4)
            try:
                matches = [o for o in adapter.get_orders(conn, status="all", limit=50) if str(o.get("id")) == str(order.broker_order_id)]
            except Exception:
                break
            if not matches:
                continue
            live = matches[0]
            if live.get("status") == "filled":
                order.status = "filled"
                order.filled_quantity = float(live.get("filled_qty") or body.quantity)
                order.avg_fill_price = float(live.get("filled_avg_price") or 0) or None
                order.filled_at = datetime.now(timezone.utc)
                break
            if live.get("status") in ("rejected", "canceled", "expired"):
                order.status = live["status"]
                order.rejection_reason = live.get("reason_description") or order.rejection_reason
                break

    db.add(order)
    await db.flush()

    await audit_log(
        db, action="MANUAL_ORDER_PLACED", outcome="success" if order.status in ("submitted", "filled") else "blocked",
        user_id=current_user.id, resource_type="order", resource_id=order.id, request=request,
        metadata={"ticker": order.ticker, "side": order.side, "status": order.status},
    )
    return order


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


# ── Automation diagnostic status ───────────────────────────────

@router.get("/automation/status")
async def get_automation_status(current_user: CurrentUser, db: DB):
    """
    Diagnostic: tells the UI exactly why automation is or isn't trading.
    Returns config state, today's order counts by status, and the top
    rejection reasons so users can self-diagnose without guessing.
    """
    result = await db.execute(
        select(AutomationConfig).where(AutomationConfig.user_id == current_user.id)
    )
    config = result.scalars().first()

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(Order).where(
            Order.user_id == current_user.id,
            Order.is_automated == True,
            Order.created_at >= today_start,
        ).order_by(Order.created_at.desc()).limit(100)
    )
    today_orders = result.scalars().all()

    by_status: dict[str, int] = {}
    for o in today_orders:
        by_status[o.status] = by_status.get(o.status, 0) + 1

    reason_counts: dict[str, int] = {}
    for o in today_orders:
        if o.status == "rejected" and o.rejection_reason:
            reason_counts[o.rejection_reason] = reason_counts.get(o.rejection_reason, 0) + 1

    top_reasons = sorted(reason_counts.items(), key=lambda x: -x[1])[:5]

    return {
        "config": {
            "id": str(config.id) if config else None,
            "broker_connection_id": str(config.broker_connection_id) if config else None,
            "is_enabled": config.is_enabled if config else False,
            "min_confidence": config.min_confidence if config else None,
            "max_daily_loss_usd": config.max_daily_loss_usd if config else None,
            "max_open_positions": config.max_open_positions if config else None,
            "cooldown_minutes": config.cooldown_minutes if config else None,
        },
        "today": {
            "submitted": by_status.get("submitted", 0),
            "filled": by_status.get("filled", 0),
            "rejected": by_status.get("rejected", 0),
            "pending_approval": by_status.get("pending_approval", 0),
            "total": len(today_orders),
        },
        "top_rejection_reasons": [{"reason": r, "count": c} for r, c in top_reasons],
        "recent_activity": [
            {
                "ticker": o.ticker,
                "side": o.side,
                "status": o.status,
                "rejection_reason": o.rejection_reason,
                "created_at": o.created_at.isoformat(),
            }
            for o in today_orders[:10]
        ],
    }


# ── Emergency stop ─────────────────────────────────────────────

@router.post("/emergency-stop")
async def emergency_stop(request: Request, current_user: CurrentUser, db: DB):
    """
    Kill switch: disables all automation configs and cancels all open orders
    for the current user. Attempts to cancel orders at the broker as well.
    """
    now = datetime.now(timezone.utc)

    # 1. Disable all automation configs (equity + options)
    result = await db.execute(
        select(AutomationConfig).where(AutomationConfig.user_id == current_user.id)
    )
    configs = result.scalars().all()
    configs_disabled = 0
    for cfg in configs:
        if cfg.is_enabled:
            cfg.is_enabled = False
            configs_disabled += 1

    result = await db.execute(
        select(OptionsAutomationConfig).where(OptionsAutomationConfig.user_id == current_user.id)
    )
    for cfg in result.scalars().all():
        if cfg.is_enabled:
            cfg.is_enabled = False
            configs_disabled += 1

    # 2. Cancel all open orders in DB and attempt broker cancellation.
    # pending_approval orders were never sent to the broker — cancelling
    # them here just stops them from being approved later.
    result = await db.execute(
        select(Order).where(
            Order.user_id == current_user.id,
            Order.status.in_(["pending", "submitted", "partially_filled", "pending_approval"]),
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
