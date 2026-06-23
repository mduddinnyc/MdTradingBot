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
from decimal import Decimal

import httpx
from fastapi import HTTPException

from app.core.encryption import decrypt_secret
from app.models.broker import BrokerConnection

_SANDBOX = "https://sandbox.tradier.com/v1"
_LIVE    = "https://api.tradier.com/v1"
_TIMEOUT = 15


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
        avg = cost_basis / qty if qty else 0.0

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

        market_val = qty * current
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


def place_bracket_order(
    conn: BrokerConnection,
    symbol: str,
    qty: Decimal,
    side: str,
    take_profit_price: Decimal,
    stop_loss_price: Decimal,
) -> dict:
    api_key, account_id = _creds(conn)
    base = _base(conn.is_paper)

    exit_side = "sell" if side == "buy" else "buy"

    # Native OTOCO: entry (market) + take-profit (limit) + stop-loss (stop)
    form = {
        "class": "otoco",
        "duration[0]": "day",
        "symbol[0]": symbol,
        "side[0]": side,
        "quantity[0]": str(qty),
        "type[0]": "market",
        "duration[1]": "gtc",
        "symbol[1]": symbol,
        "side[1]": exit_side,
        "quantity[1]": str(qty),
        "type[1]": "limit",
        "price[1]": str(take_profit_price),
        "duration[2]": "gtc",
        "symbol[2]": symbol,
        "side[2]": exit_side,
        "quantity[2]": str(qty),
        "type[2]": "stop",
        "stop[2]": str(stop_loss_price),
    }
    data = _post_form(base, f"/accounts/{account_id}/orders", api_key, form)
    order = data.get("order") or {}
    return {
        "id": str(order.get("id", "")),
        "symbol": symbol,
        "qty": str(qty),
        "side": side,
        "status": str(order.get("status", "pending")).lower(),
        "order_class": "bracket",
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

    return {
        "symbol": symbol,
        "ask_price": float(quote.get("ask", 0) or 0),
        "bid_price": float(quote.get("bid", 0) or 0),
        "ask_size": float(quote.get("asksize", 0) or 0),
        "bid_size": float(quote.get("bidsize", 0) or 0),
        "timestamp": dt.datetime.utcnow().isoformat(),
    }


def get_options_chain(conn: BrokerConnection, symbol: str) -> dict:
    """Returns the chain for the nearest upcoming expiration, with greeks."""
    api_key, _ = _creds(conn)
    base = _base(conn.is_paper)

    exp_data = _get(base, "/markets/options/expirations", api_key, params={"symbol": symbol})
    expirations = _as_list((exp_data.get("expirations") or {}).get("date"))
    if not expirations:
        raise HTTPException(status_code=404, detail=f"No options expirations found for {symbol}")
    nearest = sorted(expirations)[0]

    chain_data = _get(base, "/markets/options/chains", api_key, params={
        "symbol": symbol, "expiration": nearest, "greeks": "true",
    })
    options = _as_list((chain_data.get("options") or {}).get("option"))
    return {"symbol": symbol, "expiration": nearest, "options": options}


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
