"""
Tradier adapter.

Auth model differs from Alpaca/Webull: Tradier uses a single Bearer access
token (no separate secret). We repurpose the existing two-field credential
schema as:

  api_key_enc    → Tradier access token (Bearer)
  api_secret_enc → Tradier account number, e.g. "VA12345678" (sandbox) or
                   a live account number. One token can have multiple
                   accounts; the user picks which one to trade.

is_paper=True  → https://sandbox.tradier.com/v1  (sandbox token + real-time data)
is_paper=False → https://api.tradier.com/v1       (live brokerage token)

Order placement uses form-urlencoded POST (not JSON) per Tradier's API.
Bracket orders use Tradier's native `class=otoco` (one-triggers-one-cancels-other).
"""
from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal

import httpx
from fastapi import HTTPException

from app.core.encryption import decrypt_secret
from app.models.broker import BrokerConnection

_SANDBOX = "https://sandbox.tradier.com/v1"
_LIVE    = "https://api.tradier.com/v1"
_TIMEOUT = 15

_OCC_OPTION_RE = re.compile(r"^[A-Z]{1,6}\d{6}[CP]\d{8}$")


def _is_option_symbol(symbol: str) -> bool:
    """OCC symbols carry a 100x multiplier (1 contract = 100 shares) that
    equity symbols don't — needed wherever we convert Tradier's aggregate
    cost_basis/market_value into a per-share/per-contract price."""
    return bool(_OCC_OPTION_RE.match(symbol))


def _base(paper: bool) -> str:
    return _SANDBOX if paper else _LIVE


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _creds(conn: BrokerConnection) -> tuple[str, str]:
    return decrypt_secret(conn.api_key_enc), decrypt_secret(conn.api_secret_enc)


def _get(base: str, path: str, token: str, params: dict | None = None) -> dict:
    try:
        r = httpx.get(f"{base}{path}", headers=_headers(token), params=params, timeout=_TIMEOUT)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Tradier request error: {exc}")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=f"Tradier: {r.text[:400]}")
    return r.json()


def _post_form(base: str, path: str, token: str, data: dict) -> dict:
    try:
        r = httpx.post(f"{base}{path}", headers=_headers(token), data=data, timeout=_TIMEOUT)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Tradier request error: {exc}")
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=r.status_code, detail=f"Tradier: {r.text[:400]}")
    return r.json()


def _delete(base: str, path: str, token: str) -> dict:
    try:
        r = httpx.delete(f"{base}{path}", headers=_headers(token), timeout=_TIMEOUT)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Tradier request error: {exc}")
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=r.status_code, detail=f"Tradier: {r.text[:400]}")
    return r.json()


def _as_list(value) -> list:
    """Tradier returns a bare dict for single results, the string 'null' for
    empty results, and a list only when there are 2+ items. Normalize all
    three shapes to a list."""
    if value is None or value == "null":
        return []
    if isinstance(value, list):
        return value
    return [value]


# ── Public adapter functions ───────────────────────────────────

def validate_and_get_account_id(api_key: str, api_secret: str, paper: bool) -> str:
    """
    api_key    = Tradier access token
    api_secret = Tradier account number to trade on
    """
    base = _base(paper)
    data = _get(base, "/user/profile", api_key)
    accounts = _as_list((data.get("profile") or {}).get("account"))
    numbers = {a.get("account_number") for a in accounts if isinstance(a, dict)}
    if api_secret not in numbers:
        raise HTTPException(
            status_code=400,
            detail=f"Account number '{api_secret}' not found for this token. Available: {sorted(numbers)}",
        )
    return api_secret


def get_market_clock(conn: BrokerConnection) -> dict:
    """Real current market session state — used to block orders when the
    market isn't open rather than guessing from local wall-clock + a
    hardcoded holiday calendar."""
    api_key, _ = _creds(conn)
    base = _base(conn.is_paper)
    data = _get(base, "/markets/clock", api_key)
    clock = data.get("clock") or {}
    return {
        "state": clock.get("state"),
        "description": clock.get("description"),
        "next_state": clock.get("next_state"),
        "next_change": clock.get("next_change"),
        "date": clock.get("date"),
    }


def get_account(conn: BrokerConnection) -> dict:
    api_key, account_id = _creds(conn)
    base = _base(conn.is_paper)
    data = _get(base, f"/accounts/{account_id}/balances", api_key)
    bal = data.get("balances") or {}

    margin = bal.get("margin") or {}
    cash_block = bal.get("cash") or {}
    buying_power = margin.get("stock_buying_power") or cash_block.get("cash_available") or bal.get("total_cash", 0)

    equity = float(bal.get("total_equity", 0))
    return {
        "id": account_id,
        "status": "ACTIVE",
        "currency": "USD",
        "cash": str(bal.get("total_cash", 0)),
        "portfolio_value": str(equity),
        "buying_power": str(buying_power),
        "equity": str(equity),
        "last_equity": str(equity),
        "long_market_value": str(bal.get("long_market_value", 0)),
        "short_market_value": str(bal.get("short_market_value", 0)),
        "daytrade_count": 0,  # Tradier doesn't expose this; PDT tracked internally
        "pattern_day_trader": bal.get("account_type") == "pdt",
        "trading_blocked": False,
        "transfers_blocked": False,
        "is_paper": conn.is_paper,
    }


def get_positions(conn: BrokerConnection) -> list[dict]:
    api_key, account_id = _creds(conn)
    base = _base(conn.is_paper)
    data = _get(base, f"/accounts/{account_id}/positions", api_key)
    positions = _as_list((data.get("positions") or {}).get("position") if isinstance(data.get("positions"), dict) else None)

    result = []
    for p in positions:
        symbol = p.get("symbol", "")
        qty = float(p.get("quantity", 0))
        cost_basis = float(p.get("cost_basis", 0))
        multiplier = 100 if _is_option_symbol(symbol) else 1
        avg = cost_basis / (qty * multiplier) if qty else 0.0

        # Tradier positions don't include live price — fetch quote
        current = avg
        try:
            q = _get(base, "/markets/quotes", api_key, params={"symbols": symbol})
            quote = (q.get("quotes") or {}).get("quote")
            if isinstance(quote, list):
                quote = quote[0] if quote else {}
            if quote:
                current = float(quote.get("last") or avg)
        except HTTPException:
            pass

        market_val = qty * current * multiplier
        pl = market_val - cost_basis
        result.append({
            "symbol": symbol,
            "qty": str(qty),
            "avg_entry_price": str(avg),
            "current_price": str(current),
            "market_value": str(market_val),
            "unrealized_pl": str(pl),
            "unrealized_plpc": str(pl / cost_basis if cost_basis else 0),
            "side": "long" if qty > 0 else "short",
        })
    return result


def get_gain_loss(conn: BrokerConnection, start: str | None = None, end: str | None = None) -> list[dict]:
    """
    Realized P&L for closed positions, straight from Tradier's own
    cost-basis ledger — the only honest source of exit prices and
    profit/loss since we don't track closing fills ourselves yet.
    Entry/exit are normalized to per-share (equity) or per-contract
    (option) price; Tradier's cost/proceeds are aggregate dollar totals.
    `gain_loss_pct` is a 0-1 fraction (matches this app's confidence/pct
    convention), not Tradier's raw whole-number percent.
    """
    api_key, account_id = _creds(conn)
    base = _base(conn.is_paper)
    params: dict = {}
    if start:
        params["start"] = start
    if end:
        params["end"] = end
    data = _get(base, f"/accounts/{account_id}/gainloss", api_key, params=params)
    gl = data.get("gainloss")
    if not isinstance(gl, dict):
        return []

    result = []
    for r in _as_list(gl.get("closed_position")):
        symbol = r.get("symbol", "")
        qty = abs(float(r.get("quantity", 0) or 0))
        denom = qty * (100 if _is_option_symbol(symbol) else 1)
        cost = float(r.get("cost", 0) or 0)
        proceeds = float(r.get("proceeds", 0) or 0)
        result.append({
            "symbol": symbol,
            "quantity": qty,
            "open_date": r.get("open_date"),
            "close_date": r.get("close_date"),
            "entry_price": round(cost / denom, 4) if denom else None,
            "exit_price": round(proceeds / denom, 4) if denom else None,
            "gain_loss": round(float(r.get("gain_loss", 0) or 0), 2),
            "gain_loss_pct": round(float(r.get("gain_loss_percent", 0) or 0) / 100, 4),
            "term": r.get("term"),
        })
    return result


def get_orders(conn: BrokerConnection, status: str = "all", limit: int = 50) -> list[dict]:
    api_key, account_id = _creds(conn)
    base = _base(conn.is_paper)
    data = _get(base, f"/accounts/{account_id}/orders", api_key, params={"includeTags": "false"})
    orders = _as_list((data.get("orders") or {}).get("order") if isinstance(data.get("orders"), dict) else None)

    result = []
    for o in orders[:limit]:
        st = str(o.get("status", "")).lower()
        if status == "open" and st not in ("open", "pending", "partially_filled"):
            continue
        if status == "closed" and st not in ("filled", "canceled", "rejected", "expired"):
            continue
        result.append({
            "id": str(o.get("id", "")),
            "symbol": o.get("symbol", ""),
            "qty": str(o.get("quantity", "")),
            "filled_qty": str(o.get("exec_quantity", "0")),
            "type": str(o.get("type", "market")).upper(),
            "side": str(o.get("side", "buy")).lower(),
            "status": st,
            "limit_price": str(o["price"]) if o.get("price") else None,
            "stop_price": str(o["stop_price"]) if o.get("stop_price") else None,
            "filled_avg_price": str(o["avg_fill_price"]) if o.get("avg_fill_price") else None,
            "submitted_at": o.get("create_date"),
            "filled_at": o.get("transaction_date"),
        })
    return result


def place_order(
    conn: BrokerConnection,
    symbol: str,
    qty: Decimal,
    side: str,
    order_type: str = "market",
    limit_price: Decimal | None = None,
    take_profit_price: Decimal | None = None,
    stop_loss_price: Decimal | None = None,
) -> dict:
    """
    Single equity order, optionally bracketed with a take-profit and/or
    stop-loss exit leg. Tradier order `class` follows from what's supplied:
    neither TP/SL -> plain `equity` order; exactly one -> `oto` (2 legs);
    both -> `otoco` (3 legs — the shape the automated path has always used,
    via the place_bracket_order wrapper below).
    """
    api_key, account_id = _creds(conn)
    base = _base(conn.is_paper)
    exit_side = "sell" if side == "buy" else "buy"

    # Tradier rejects more than 2 decimal places on price/stop fields —
    # percent-derived brackets (e.g. entry * 0.9) routinely produce more.
    cents = Decimal("0.01")
    if limit_price is not None:
        limit_price = limit_price.quantize(cents)
    if take_profit_price is not None:
        take_profit_price = take_profit_price.quantize(cents)
    if stop_loss_price is not None:
        stop_loss_price = stop_loss_price.quantize(cents)

    if take_profit_price is None and stop_loss_price is None:
        # Plain single-leg order — Tradier rejects indexed leg[N] params
        # ("legs are not allowed for this order class") unless class is
        # oto/otoco/multileg/combo, so this must use flat (unindexed) keys.
        form = {
            "class": "equity",
            "symbol": symbol,
            "side": side,
            "quantity": str(qty),
            "type": order_type,
            "duration": "day",
        }
        if order_type == "limit" and limit_price is not None:
            form["price"] = str(limit_price)
        data = _post_form(base, f"/accounts/{account_id}/orders", api_key, form)
        order = data.get("order") or {}
        return {
            "id": str(order.get("id", "")),
            "symbol": symbol,
            "qty": str(qty),
            "side": side,
            "status": str(order.get("status", "pending")).lower(),
            "order_class": "equity",
        }

    entry_type = order_type
    entry_price = limit_price
    if entry_type == "market":
        # Tradier rejects a market order as the first leg of an oto/otoco
        # order ("OtoFirstLegIsMarketNotAllowed") — any bracket forces a
        # real price. Use a marketable limit at the current quote, which
        # fills just as immediately in practice for a liquid symbol.
        entry_type = "limit"
        if entry_price is None:
            q = get_latest_quote(conn, symbol)
            entry_price = Decimal(str(q.get("last") or q["ask_price"])).quantize(cents)

    entry = {
        "duration[0]": "day",
        "symbol[0]": symbol,
        "side[0]": side,
        "quantity[0]": str(qty),
        "type[0]": entry_type,
        "price[0]": str(entry_price),
    }

    if take_profit_price is not None and stop_loss_price is not None:
        form = {
            "class": "otoco",
            **entry,
            "duration[1]": "gtc", "symbol[1]": symbol, "side[1]": exit_side,
            "quantity[1]": str(qty), "type[1]": "limit", "price[1]": str(take_profit_price),
            "duration[2]": "gtc", "symbol[2]": symbol, "side[2]": exit_side,
            "quantity[2]": str(qty), "type[2]": "stop", "stop[2]": str(stop_loss_price),
        }
    else:
        exit_leg = (
            {"type[1]": "limit", "price[1]": str(take_profit_price)}
            if take_profit_price is not None
            else {"type[1]": "stop", "stop[1]": str(stop_loss_price)}
        )
        form = {
            "class": "oto",
            **entry,
            "duration[1]": "gtc", "symbol[1]": symbol, "side[1]": exit_side,
            "quantity[1]": str(qty),
            **exit_leg,
        }

    data = _post_form(base, f"/accounts/{account_id}/orders", api_key, form)
    order = data.get("order") or {}
    return {
        "id": str(order.get("id", "")),
        "symbol": symbol,
        "qty": str(qty),
        "side": side,
        "status": str(order.get("status", "pending")).lower(),
        "order_class": form["class"],
    }


def place_bracket_order(
    conn: BrokerConnection,
    symbol: str,
    qty: Decimal,
    side: str,
    take_profit_price: Decimal,
    stop_loss_price: Decimal,
) -> dict:
    return place_order(
        conn, symbol, qty, side,
        take_profit_price=take_profit_price, stop_loss_price=stop_loss_price,
    )


def place_option_order(
    conn: BrokerConnection,
    underlying_symbol: str,
    option_symbol: str,
    side: str,
    qty: int,
    order_type: str = "market",
    limit_price: Decimal | None = None,
) -> dict:
    """
    Single-leg options order. `option_symbol` must be the real OCC symbol
    from get_options_chain()'s response — never construct this string by
    hand. `side` is one of buy_to_open/sell_to_close/buy_to_close/sell_to_open.
    """
    api_key, account_id = _creds(conn)
    base = _base(conn.is_paper)

    form = {
        "class": "option",
        "symbol": underlying_symbol,
        "option_symbol": option_symbol,
        "side": side,
        "quantity": str(qty),
        "type": order_type,
        "duration": "day",
    }
    if order_type == "limit" and limit_price is not None:
        form["price"] = str(limit_price)

    data = _post_form(base, f"/accounts/{account_id}/orders", api_key, form)
    order = data.get("order") or {}
    return {
        "id": str(order.get("id", "")),
        "option_symbol": option_symbol,
        "qty": qty,
        "side": side,
        "status": str(order.get("status", "pending")).lower(),
    }


def cancel_order(conn: BrokerConnection, broker_order_id: str) -> None:
    api_key, account_id = _creds(conn)
    base = _base(conn.is_paper)
    _delete(base, f"/accounts/{account_id}/orders/{broker_order_id}", api_key)


def cancel_all_orders(conn: BrokerConnection) -> None:
    """Tradier has no bulk-cancel endpoint — cancel each open order individually."""
    open_orders = get_orders(conn, status="open", limit=200)
    for o in open_orders:
        try:
            cancel_order(conn, o["id"])
        except HTTPException:
            continue


def get_bars(
    conn: BrokerConnection,
    symbol: str,
    timeframe: str = "1Hour",
    limit: int = 100,
) -> list[dict]:
    api_key, _ = _creds(conn)
    base = _base(conn.is_paper)
    now = dt.datetime.utcnow()

    if timeframe == "1Day":
        start = (now - dt.timedelta(days=int(limit * 1.6) + 5)).strftime("%Y-%m-%d")
        end = now.strftime("%Y-%m-%d")
        data = _get(base, "/markets/history", api_key, params={
            "symbol": symbol, "interval": "daily", "start": start, "end": end,
        })
        days = _as_list((data.get("history") or {}).get("day"))
        return [_bar_from_history(d) for d in days[-limit:]]

    interval_map = {"1Min": "1min", "5Min": "5min", "15Min": "15min", "1Hour": "15min"}
    interval = interval_map.get(timeframe, "5min")
    lookback_days = 5 if timeframe in ("1Min", "5Min") else 10
    start = (now - dt.timedelta(days=lookback_days)).strftime("%Y-%m-%d %H:%M")
    end = now.strftime("%Y-%m-%d %H:%M")

    data = _get(base, "/markets/timesales", api_key, params={
        "symbol": symbol, "interval": interval, "start": start, "end": end,
    })
    series = _as_list((data.get("series") or {}).get("data"))
    bars = [_bar_from_timesale(d) for d in series]

    if timeframe == "1Hour":
        bars = _resample_hourly(bars)

    return bars[-limit:]


def get_latest_quote(conn: BrokerConnection, symbol: str) -> dict:
    api_key, _ = _creds(conn)
    base = _base(conn.is_paper)
    data = _get(base, "/markets/quotes", api_key, params={"symbols": symbol})
    quote = (data.get("quotes") or {}).get("quote")
    if isinstance(quote, list):
        quote = quote[0] if quote else {}
    quote = quote or {}

    def f(key: str) -> float | None:
        v = quote.get(key)
        return float(v) if v is not None else None

    return {
        "symbol": symbol,
        "description": quote.get("description"),
        "ask_price": f("ask") or 0.0,
        "bid_price": f("bid") or 0.0,
        "ask_size": f("asksize") or 0.0,
        "bid_size": f("bidsize") or 0.0,
        "last": f("last"),
        "change": f("change"),
        "change_percentage": f("change_percentage"),
        "open": f("open"),
        "high": f("high"),
        "low": f("low"),
        "prevclose": f("prevclose"),
        "volume": f("volume"),
        "average_volume": f("average_volume"),
        "week_52_high": f("week_52_high"),
        "week_52_low": f("week_52_low"),
        "timestamp": dt.datetime.utcnow().isoformat(),
    }


def get_options_chain(conn: BrokerConnection, symbol: str, target_dte: int | None = None) -> dict:
    """
    Returns one expiration's chain, with greeks. Default (target_dte=None)
    picks the nearest upcoming expiration — that's often only 0-2 days out,
    fine for a quick look at the Options page. Pass target_dte to pick the
    expiration closest to today+target_dte instead — needed for anything
    that actually wants to hold the contract a while (e.g. the options
    automation staging logic, which targets 7-21 DTE, not tomorrow).
    """
    api_key, _ = _creds(conn)
    base = _base(conn.is_paper)

    exp_data = _get(base, "/markets/options/expirations", api_key, params={"symbol": symbol})
    expirations = _as_list((exp_data.get("expirations") or {}).get("date"))
    if not expirations:
        raise HTTPException(status_code=404, detail=f"No options expirations found for {symbol}")

    if target_dte is None:
        chosen = sorted(expirations)[0]
    else:
        today = dt.date.today()
        chosen = min(
            expirations,
            key=lambda d: abs((dt.date.fromisoformat(d) - today).days - target_dte),
        )

    chain_data = _get(base, "/markets/options/chains", api_key, params={
        "symbol": symbol, "expiration": chosen, "greeks": "true",
    })
    options = _as_list((chain_data.get("options") or {}).get("option"))
    return {"symbol": symbol, "expiration": chosen, "options": options}


# ── Internal helpers ───────────────────────────────────────────

def _bar_from_history(d: dict) -> dict:
    return {
        "t": d.get("date", ""),
        "o": float(d.get("open", 0)),
        "h": float(d.get("high", 0)),
        "l": float(d.get("low", 0)),
        "c": float(d.get("close", 0)),
        "v": float(d.get("volume", 0)),
    }


def _bar_from_timesale(d: dict) -> dict:
    return {
        "t": d.get("time", ""),
        "o": float(d.get("open", 0)),
        "h": float(d.get("high", 0)),
        "l": float(d.get("low", 0)),
        "c": float(d.get("close", 0)),
        "v": float(d.get("volume", 0)),
    }


def _resample_hourly(bars: list[dict]) -> list[dict]:
    """Tradier timesales has no native 1Hour interval — bucket 15min bars into 4s."""
    out = []
    for i in range(0, len(bars), 4):
        chunk = bars[i:i + 4]
        if not chunk:
            continue
        out.append({
            "t": chunk[0]["t"],
            "o": chunk[0]["o"],
            "h": max(b["h"] for b in chunk),
            "l": min(b["l"] for b in chunk),
            "c": chunk[-1]["c"],
            "v": sum(b["v"] for b in chunk),
        })
    return out
