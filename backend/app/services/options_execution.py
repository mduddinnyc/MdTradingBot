"""
Paper-trading-only options automation. Single-leg long calls/puts, staged
for manual approval by default (OptionsAutomationConfig.require_manual_approval)
— see the plan this was built against for why: this is genuinely new,
never-before-tested execution code (Tradier's options order endpoint),
so a human checks the first real paper trades before any auto-fire mode
gets built on top of it.

Nothing in here ever fabricates a price or a contract symbol — every
strike/expiry/premium comes from a live get_options_chain() call, and the
option_symbol stored on the Order is always the real OCC symbol the broker
returned, never hand-constructed.
"""
from __future__ import annotations

import datetime as dt
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation import Order, OptionsAutomationConfig
from app.models.broker import BrokerConnection
from app.models.market import Symbol, Watchlist, WatchlistItem
from app.services import signal_engine
from app.services.broker_adapter import get_adapter
from app.services.day_trade_universe import DAY_TRADE_UNIVERSE

log = logging.getLogger(__name__)


async def get_spent_budget(db: AsyncSession, user_id: uuid.UUID) -> float:
    """Premium currently committed to open (filled, not yet closed) option
    positions — what counts against OptionsAutomationConfig.budget_usd."""
    result = await db.execute(
        select(Order).where(
            Order.user_id == user_id,
            Order.asset_type == "option",
            Order.status.in_(["filled", "submitted"]),
            Order.closing_order_id.is_(None),
        )
    )
    open_orders = result.scalars().all()
    return sum((o.premium_paid or 0) * (o.filled_quantity or o.quantity) * 100 for o in open_orders)


async def _open_option_tickers(db: AsyncSession, user_id: uuid.UUID) -> set[str]:
    result = await db.execute(
        select(Order.ticker).where(
            Order.user_id == user_id,
            Order.asset_type == "option",
            Order.status.in_(["filled", "pending_approval", "submitted"]),
            Order.closing_order_id.is_(None),
        )
    )
    return {r[0] for r in result.all()}


async def find_eligible_candidate(
    db: AsyncSession, config: OptionsAutomationConfig
):
    """
    Best (highest-confidence) BUY/SELL signal that clears
    config.min_confidence, isn't already held, and wouldn't exceed
    max_open_positions. Returns (Signal, Symbol) or None — same shape
    signal_engine.get_ranked_signals already returns.
    """
    open_count = len(await _open_option_tickers(db, config.user_id))
    if open_count >= config.max_open_positions:
        log.info("Options automation: max_open_positions reached (%d)", config.max_open_positions)
        return None

    result = await db.execute(
        select(Watchlist).where(Watchlist.user_id == config.user_id, Watchlist.is_default == True)
    )
    wl = result.scalar_one_or_none()
    symbol_ids: list[int] = []
    if wl:
        result = await db.execute(select(WatchlistItem.symbol_id).where(WatchlistItem.watchlist_id == wl.id))
        symbol_ids = [r[0] for r in result.all()]
    result = await db.execute(select(Symbol.id).where(Symbol.ticker.in_(DAY_TRADE_UNIVERSE)))
    symbol_ids = list({*symbol_ids, *(r[0] for r in result.all())})
    if not symbol_ids:
        return None

    rows = await signal_engine.get_ranked_signals(
        db, symbol_ids, limit=50, min_confidence=config.min_confidence
    )
    already_held = await _open_option_tickers(db, config.user_id)
    for sig, sym in rows:
        if sym.ticker not in already_held:
            return sig, sym
    return None


def _pick_contract(chain: dict, right: str, underlying_price: float) -> dict | None:
    """Closest-to-the-money contract of the given right with a real quoted bid/ask."""
    candidates = [
        o for o in chain.get("options", [])
        if o.get("option_type") == right and o.get("bid") and o.get("ask")
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda o: abs(float(o["strike"]) - underlying_price))


async def stage_option_trade(
    db: AsyncSession,
    config: OptionsAutomationConfig,
    conn: BrokerConnection,
    sig,
    sym: Symbol,
) -> Order | None:
    """
    Builds a pending_approval Order from a real options chain. Does NOT
    place anything with the broker — that only happens in
    approve_staged_order, once a human signs off.
    """
    right = "call" if sig.signal_type == "BUY" else "put"
    adapter = get_adapter(conn.broker_name)
    if not hasattr(adapter, "get_options_chain"):
        log.warning("Options automation: %s has no options chain support", conn.broker_name)
        return None

    target_dte = (config.target_dte_min + config.target_dte_max) // 2
    chain = adapter.get_options_chain(conn, sym.ticker, target_dte=target_dte)

    contract = _pick_contract(chain, right, sig.entry_price)
    if not contract:
        log.info("Options automation: no liquid %s contract found for %s", right, sym.ticker)
        return None

    premium = float(contract["ask"])  # buying — pay the ask
    qty = min(config.max_contracts_per_trade, 1)  # one contract per trade, safer default
    cost = premium * qty * 100

    spent = await get_spent_budget(db, config.user_id)
    if spent + cost > config.budget_usd:
        log.info(
            "Options automation: %s would exceed budget ($%.2f spent + $%.2f > $%.2f cap)",
            sym.ticker, spent, cost, config.budget_usd,
        )
        return None

    order = Order(
        id=uuid.uuid4(),
        user_id=config.user_id,
        broker_connection_id=conn.id,
        signal_id=sig.id,
        ticker=sym.ticker,
        order_type="market",
        side="buy",
        quantity=qty,
        status="pending_approval",
        is_automated=True,
        asset_type="option",
        option_symbol=contract["symbol"],
        strike_price=float(contract["strike"]),
        expiration_date=dt.date.fromisoformat(chain["expiration"]),
        option_right=right,
        premium_paid=premium,
    )
    db.add(order)
    await db.flush()
    log.info(
        "Options automation: staged %s %s %s @ $%.2f (confidence=%.2f)",
        sym.ticker, right, contract["symbol"], premium, sig.confidence,
    )
    return order


async def approve_staged_order(db: AsyncSession, conn: BrokerConnection, order: Order) -> Order:
    """
    Places the real paper order with the broker. Buy (opening) orders get
    a fresh budget re-check (prices move between staging and approval);
    sell (closing) orders skip it — closing a position frees budget, it
    doesn't consume more.
    """
    if order.status != "pending_approval":
        raise ValueError(f"Order {order.id} is not pending approval (status={order.status})")

    is_buy = order.side == "buy"

    if is_buy:
        spent = await get_spent_budget(db, order.user_id)
        cost = (order.premium_paid or 0) * order.quantity * 100
        result = await db.execute(
            select(OptionsAutomationConfig).where(OptionsAutomationConfig.user_id == order.user_id)
        )
        config = result.scalar_one_or_none()
        budget = config.budget_usd if config else 10_000.0
        if spent + cost > budget:
            order.status = "cancelled"
            order.rejection_reason = "Budget cap exceeded between staging and approval"
            await db.flush()
            return order

    adapter = get_adapter(conn.broker_name)
    broker_side = "buy_to_open" if is_buy else "sell_to_close"
    res = adapter.place_option_order(
        conn, order.ticker, order.option_symbol, broker_side, int(order.quantity), order_type="market",
    )
    order.broker_order_id = res.get("id")
    order.status = "submitted"
    order.submitted_at = dt.datetime.now(dt.timezone.utc)

    # Sandbox market orders often fill within the same request cycle — check
    # once so the Orders page doesn't show a stale "submitted" for a contract
    # that's actually already filled (budget tracking already treats the two
    # the same either way, see get_spent_budget).
    if order.broker_order_id and hasattr(adapter, "get_orders"):
        for o in adapter.get_orders(conn, status="all", limit=50):
            if str(o.get("id")) == str(order.broker_order_id) and o.get("status") == "filled":
                order.status = "filled"
                order.filled_quantity = float(o.get("filled_qty") or order.quantity)
                order.avg_fill_price = float(o["filled_avg_price"]) if o.get("filled_avg_price") else None
                order.filled_at = dt.datetime.now(dt.timezone.utc)
                break

    if not is_buy and order.status in ("submitted", "filled"):
        # Link to the oldest still-open buy for this exact contract so
        # get_spent_budget stops counting it once this close goes through.
        result = await db.execute(
            select(Order).where(
                Order.user_id == order.user_id,
                Order.option_symbol == order.option_symbol,
                Order.side == "buy",
                Order.status.in_(["filled", "submitted"]),
                Order.closing_order_id.is_(None),
            ).order_by(Order.created_at.asc()).limit(1)
        )
        opening = result.scalar_one_or_none()
        if opening:
            opening.closing_order_id = order.id

    await db.flush()
    return order
