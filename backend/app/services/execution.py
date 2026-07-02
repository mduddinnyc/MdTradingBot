"""
Execution engine.
Runs pre-trade validation guardrails then places orders via Alpaca.
Called by the scheduler after each signal is generated.
"""
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log as audit_log
from app.models.automation import AutomationConfig, Order, UserStrategyConfig
from app.models.broker import BrokerConnection
from app.models.signal import Signal
from app.services.broker_adapter import get_adapter

PDT_WINDOW_DAYS = 5   # rolling window FINRA uses
PDT_MAX_TRADES  = 3   # 4th trip triggers PDT violation
PDT_EQUITY_MIN  = 25_000.0  # account equity threshold in USD

log = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    approved: bool
    reason: str
    position_size_usd: float = 0.0


async def _todays_realized_loss(db: AsyncSession, user_id: uuid.UUID, conn_id: uuid.UUID) -> float:
    """
    Approximate daily loss: for each filled sell/buy today (manual or
    automated — PDT/loss limits apply regardless of how the trade was
    placed), use (stop_price - avg_fill_price) * filled_quantity as the
    worst-case loss already risked. Returns negative when positions went
    against us.
    """
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.sum(
            (Order.stop_price - Order.avg_fill_price) * Order.filled_quantity
        )).where(
            Order.user_id == user_id,
            Order.broker_connection_id == conn_id,
            Order.status == "filled",
            Order.filled_at >= today_start,
            Order.stop_price.isnot(None),
            Order.avg_fill_price.isnot(None),
        )
    )
    val = result.scalar_one_or_none()
    return float(val) if val else 0.0


async def _open_position_count(db: AsyncSession, user_id: uuid.UUID, conn_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count()).select_from(Order).where(
            Order.user_id == user_id,
            Order.broker_connection_id == conn_id,
            Order.status.in_(["pending", "submitted", "partially_filled"]),
        )
    )
    return result.scalar_one() or 0


async def _day_trade_count(db: AsyncSession, user_id: uuid.UUID, conn_id: uuid.UUID) -> int:
    """
    Count completed round-trips (buy then same-day sell, or short then cover)
    in the rolling PDT_WINDOW_DAYS window.
    A round-trip = a filled buy order whose ticker also has a filled sell on the same calendar day.
    We approximate by counting pairs of (buy, sell) on the same ticker within the window.
    """
    window_start = datetime.now(timezone.utc) - timedelta(days=PDT_WINDOW_DAYS)
    result = await db.execute(
        select(
            Order.ticker,
            func.date(Order.filled_at).label("trade_date"),
            Order.side,
            func.count().label("cnt"),
        ).where(
            Order.user_id == user_id,
            Order.broker_connection_id == conn_id,
            Order.status == "filled",
            Order.filled_at >= window_start,
        ).group_by(Order.ticker, func.date(Order.filled_at), Order.side)
    )
    rows = result.all()

    # Build (ticker, date) -> sides set
    from collections import defaultdict
    day_sides: dict = defaultdict(set)
    for ticker, trade_date, side, _ in rows:
        day_sides[(ticker, trade_date)].add(side)

    # Each (ticker, date) that has BOTH buy and sell = 1 round trip
    return sum(1 for sides in day_sides.values() if "buy" in sides and "sell" in sides)


async def _last_signal_time(db: AsyncSession, user_id: uuid.UUID, ticker: str, signal_type: str) -> datetime | None:
    result = await db.execute(
        select(Order.created_at).where(
            Order.user_id == user_id,
            Order.ticker == ticker,
            Order.side == ("buy" if signal_type == "BUY" else "sell"),
            Order.is_automated == True,
            Order.status != "rejected",  # rejected orders don't consume cooldown
        ).order_by(Order.created_at.desc()).limit(1)
    )
    return result.scalar_one_or_none()


async def validate(
    db: AsyncSession,
    config: AutomationConfig,
    conn: BrokerConnection,
    signal: Signal,
    ticker: str,
    strategy_config: UserStrategyConfig | None = None,
) -> ValidationResult:
    # 0. Market regime filter — block counter-trend signals
    regime = (signal.indicators or {}).get("regime", "sideways") if signal.indicators else "sideways"
    if regime == "trending_bear" and signal.signal_type == "BUY":
        return ValidationResult(False, f"Regime filter: BUY signal blocked in trending_bear regime")
    if regime == "trending_bull" and signal.signal_type == "SELL":
        return ValidationResult(False, f"Regime filter: SELL signal blocked in trending_bull regime")

    # 1. Confidence threshold
    if signal.confidence < config.min_confidence:
        return ValidationResult(False, f"Confidence {signal.confidence:.2f} < threshold {config.min_confidence:.2f}")

    # 2. Cooldown
    last = await _last_signal_time(db, config.user_id, ticker, signal.signal_type)
    if last:
        cooldown_end = last + timedelta(minutes=config.cooldown_minutes)
        if datetime.now(timezone.utc) < cooldown_end:
            return ValidationResult(False, f"Cooldown active until {cooldown_end.isoformat()}")

    # 3. Daily loss limit
    if config.max_daily_loss_usd:
        daily_loss = await _todays_realized_loss(db, config.user_id, conn.id)
        if daily_loss <= -config.max_daily_loss_usd:
            return ValidationResult(False, f"Daily loss limit ${config.max_daily_loss_usd:.2f} reached")

    # 3b. PDT rule — only applies to margin accounts under $25K
    adapter = get_adapter(conn.broker_name)
    account = adapter.get_account(conn)
    equity = float(account["equity"])
    if equity < PDT_EQUITY_MIN:
        day_trade_count = await _day_trade_count(db, config.user_id, conn.id)
        if day_trade_count >= PDT_MAX_TRADES:
            return ValidationResult(
                False,
                f"PDT limit reached: {day_trade_count} day trades in {PDT_WINDOW_DAYS}-day window "
                f"(account equity ${equity:,.2f} < ${PDT_EQUITY_MIN:,.0f} threshold). "
                "Fund account to $25,000+ to remove this restriction."
            )

    # 4. Max open positions — only gates new entries (BUY), never exits (SELL).
    # A SELL closes an existing long; blocking it would trap us in a position.
    if signal.signal_type == "BUY":
        open_count = await _open_position_count(db, config.user_id, conn.id)
        if open_count >= config.max_open_positions:
            return ValidationResult(False, f"Max open positions ({config.max_open_positions}) reached")

    # 5. Calculate position size from live account (already fetched above for PDT check).
    # A strategy's own allocated capital drives sizing when present, but the
    # account-wide max_position_pct stays an authoritative ceiling — a
    # strategy can ask for less risk, never more than the account allows.
    account_cap = equity * config.max_position_pct
    if config.max_position_size_usd:
        account_cap = min(account_cap, config.max_position_size_usd)

    if strategy_config is not None:
        position_size = min(strategy_config.allocated_capital_usd, account_cap)
    else:
        position_size = account_cap

    if position_size < 1.0:
        return ValidationResult(False, "Position size below $1 minimum")

    return ValidationResult(approved=True, reason="All checks passed", position_size_usd=position_size)


async def execute_signal(
    db: AsyncSession,
    config: AutomationConfig,
    conn: BrokerConnection,
    signal: Signal,
    ticker: str,
    strategy_config: UserStrategyConfig | None = None,
) -> Order:
    """
    Validate + place order for a signal.
    Always creates an Order record (approved or rejected) for audit trail.

    A strategy in mode="manual" stages a pending_approval Order instead of
    placing it immediately — same gate options automation already uses,
    see approve_staged_equity_order() below for the other half.
    """
    validation = await validate(db, config, conn, signal, ticker, strategy_config)

    if not validation.approved:
        order = Order(
            user_id=config.user_id,
            broker_connection_id=conn.id,
            signal_id=signal.id,
            ticker=ticker,
            side="buy" if signal.signal_type == "BUY" else "sell",
            quantity=0,
            status="rejected",
            is_automated=True,
            rejection_reason=validation.reason,
        )
        db.add(order)
        await db.flush()
        log.info("Order rejected for %s: %s", ticker, validation.reason)
        return order

    # Compute qty from position size — whole shares only, Tradier (and
    # equities generally) rejects fractional quantities on plain orders.
    entry_price = signal.entry_price or 1.0
    qty = Decimal(int(validation.position_size_usd / entry_price))
    if qty < 1:
        order = Order(
            user_id=config.user_id,
            broker_connection_id=conn.id,
            signal_id=signal.id,
            ticker=ticker,
            side="buy" if signal.signal_type == "BUY" else "sell",
            quantity=0,
            status="rejected",
            is_automated=True,
            rejection_reason=f"Position size ${validation.position_size_usd:.2f} buys less than 1 share at ${entry_price:.2f}",
        )
        db.add(order)
        await db.flush()
        return order

    # Compute bracket prices
    side = "buy" if signal.signal_type == "BUY" else "sell"
    if side == "buy":
        take_profit = Decimal(str(round(entry_price * (1 + config.take_profit_pct), 2)))
        stop_loss = Decimal(str(round(entry_price * (1 - config.stop_loss_pct), 2)))
    else:
        take_profit = Decimal(str(round(entry_price * (1 - config.take_profit_pct), 2)))
        stop_loss = Decimal(str(round(entry_price * (1 + config.stop_loss_pct), 2)))

    if strategy_config is not None and strategy_config.mode == "manual":
        # Stage it — nothing is sent to the broker until a human approves
        # via approve_staged_equity_order(). Bracket prices are computed
        # now from today's entry_price so Approve can place immediately
        # without re-deriving them (mirrors options automation staging).
        order = Order(
            user_id=config.user_id,
            broker_connection_id=conn.id,
            signal_id=signal.id,
            ticker=ticker,
            order_type="market",
            side=side,
            quantity=float(qty),
            take_profit_price=float(take_profit),
            stop_price=float(stop_loss),
            status="pending_approval",
            is_automated=True,
        )
        db.add(order)
        await db.flush()
        log.info("Strategy order staged for approval: %s %s qty=%s", side.upper(), ticker, qty)
        await audit_log(
            db, action="STRATEGY_ORDER_STAGED", outcome="success", actor_type="automation",
            user_id=config.user_id, resource_type="order", resource_id=order.id,
            metadata={"ticker": ticker, "side": side, "qty": str(qty), "signal_id": str(signal.id)},
        )
        return order

    try:
        adapter = get_adapter(conn.broker_name)
        result = adapter.place_bracket_order(
            conn=conn,
            symbol=ticker,
            qty=qty,
            side=side,
            take_profit_price=take_profit,
            stop_loss_price=stop_loss,
        )
        order = Order(
            user_id=config.user_id,
            broker_connection_id=conn.id,
            signal_id=signal.id,
            broker_order_id=result["id"],
            ticker=ticker,
            order_type="market",
            side=side,
            quantity=float(qty),
            take_profit_price=float(take_profit),
            stop_price=float(stop_loss),
            status="submitted",
            is_automated=True,
            submitted_at=datetime.now(timezone.utc),
        )
        log.info("Bracket order submitted: %s %s qty=%s", side.upper(), ticker, qty)

    except Exception as exc:
        order = Order(
            user_id=config.user_id,
            broker_connection_id=conn.id,
            signal_id=signal.id,
            ticker=ticker,
            side=side,
            quantity=float(qty),
            status="rejected",
            is_automated=True,
            rejection_reason=str(exc),
        )
        log.error("Order placement failed for %s: %s", ticker, exc)

    db.add(order)
    await db.flush()

    await audit_log(
        db,
        action="ORDER_PLACED" if order.status == "submitted" else "ORDER_REJECTED",
        outcome="success" if order.status == "submitted" else "failure",
        actor_type="automation",
        user_id=config.user_id,
        resource_type="order",
        resource_id=order.id,
        metadata={
            "ticker": ticker,
            "side": side,
            "qty": str(qty),
            "signal_id": str(signal.id),
            "reason": order.rejection_reason,
        },
    )
    return order


async def approve_staged_equity_order(db: AsyncSession, conn: BrokerConnection, order: Order) -> Order:
    """
    Places the real paper order for a strategy's pending_approval equity
    Order, using the bracket prices already computed at staging time.
    Mirrors options_execution.approve_staged_order's shape so the Orders
    page can drive both asset types through one Approve button.
    """
    if order.status != "pending_approval":
        raise ValueError(f"Order {order.id} is not pending approval (status={order.status})")

    adapter = get_adapter(conn.broker_name)
    try:
        result = adapter.place_bracket_order(
            conn=conn,
            symbol=order.ticker,
            qty=Decimal(str(order.quantity)),
            side=order.side,
            take_profit_price=Decimal(str(order.take_profit_price)),
            stop_loss_price=Decimal(str(order.stop_price)),
        )
        order.broker_order_id = result["id"]
        order.status = "submitted"
        order.submitted_at = datetime.now(timezone.utc)

        if hasattr(adapter, "get_orders"):
            for o in adapter.get_orders(conn, status="all", limit=50):
                if str(o.get("id")) == str(order.broker_order_id) and o.get("status") == "filled":
                    order.status = "filled"
                    order.filled_quantity = float(o.get("filled_qty") or order.quantity)
                    order.avg_fill_price = float(o["filled_avg_price"]) if o.get("filled_avg_price") else None
                    order.filled_at = datetime.now(timezone.utc)
                    break
    except Exception as exc:
        order.status = "rejected"
        order.rejection_reason = str(exc)
        log.error("Staged order approval failed for %s: %s", order.ticker, exc)

    await db.flush()
    await audit_log(
        db,
        action="ORDER_PLACED" if order.status in ("submitted", "filled") else "ORDER_REJECTED",
        outcome="success" if order.status in ("submitted", "filled") else "failure",
        actor_type="user",
        user_id=order.user_id,
        resource_type="order",
        resource_id=order.id,
        metadata={"ticker": order.ticker, "side": order.side, "reason": order.rejection_reason},
    )
    return order


async def reject_staged_equity_order(db: AsyncSession, order: Order) -> Order:
    if order.status != "pending_approval":
        raise ValueError(f"Order {order.id} is not pending approval (status={order.status})")
    order.status = "cancelled"
    order.cancelled_at = datetime.now(timezone.utc)
    await db.flush()
    await audit_log(
        db, action="ORDER_REJECTED", outcome="success", actor_type="user",
        user_id=order.user_id, resource_type="order", resource_id=order.id,
        metadata={"ticker": order.ticker, "side": order.side},
    )
    return order
