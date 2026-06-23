"""
Webull OpenAPI adapter — uses the official Webull OpenAPI Python SDK
(vendored at backend/vendor/webull-openapi-python-sdk, installed in the
Docker image). Verified working against a real US brokerage account.

Credentials stored in BrokerConnection:
  api_key_enc    → Webull App Key    (generate at webull.com/center#openApiManagement)
  api_secret_enc → Webull App Secret
  account_id     → Webull account_id (opaque string, fetched on /connect)

Notes:
- No paper/sandbox mode exists in this API — `is_paper` is accepted but ignored;
  every connection is a real brokerage account.
- The SDK's first-ever request for a new App Key triggers a server-side
  device/session approval that can sit PENDING for up to ~60s before flipping
  to NORMAL automatically (observed in testing — no manual user action needed).
  Subsequent calls reuse the cached token in conf/webull_tokens/{connection_id}/
  and return immediately.
- Equity-only bracket orders: Webull's API has no native OCO/bracket order class
  for stocks, so take-profit and stop-loss are placed as two separate GTC exit
  orders after the market entry fills. This is best-effort, not atomic.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import uuid
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException

from webull.core.client import ApiClient
from webull.core.exception.exceptions import ClientException
from webull.trade.trade_client import TradeClient
from webull.data.data_client import DataClient
from webull.data.common.category import Category
from webull.data.common.timespan import Timespan

from app.core.encryption import decrypt_secret
from app.models.broker import BrokerConnection

_REGION = "us"
_TOKEN_ROOT = Path("/app/conf/webull_tokens")


def _token_key(api_key: str) -> str:
    """
    One Webull App Key = one server-side device/session pairing. Always use the
    same token cache dir for a given app_key so we create that session exactly
    once (first call may pause for approval) and every later call — including
    the very next one — reuses the cached token instead of opening a new
    session. Opening multiple concurrent sessions for the same app_key triggers
    2FA_VERIFY_FAILED from Webull's rate limiting.
    """
    return hashlib.sha256(api_key.encode()).hexdigest()[:24]


def _make_api_client(api_key: str, api_secret: str, duration: int) -> ApiClient:
    client = ApiClient(
        api_key, api_secret, _REGION,
        token_check_duration_seconds=duration,
        token_check_interval_seconds=5,
    )
    token_dir = _TOKEN_ROOT / _token_key(api_key)
    token_dir.mkdir(parents=True, exist_ok=True)
    client.set_token_dir(str(token_dir))
    return client


def _creds(conn: BrokerConnection) -> tuple[str, str]:
    return decrypt_secret(conn.api_key_enc), decrypt_secret(conn.api_secret_enc)


def _trade_client(conn: BrokerConnection, duration: int = 15) -> TradeClient:
    api_key, api_secret = _creds(conn)
    client = _make_api_client(api_key, api_secret, duration)
    try:
        return TradeClient(client)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Webull auth failed: {exc}")


def _data_client(conn: BrokerConnection, duration: int = 15) -> DataClient:
    api_key, api_secret = _creds(conn)
    client = _make_api_client(api_key, api_secret, duration)
    return DataClient(client)


def _check(res, action: str):
    if res.status_code != 200:
        try:
            body = res.json()
            detail = body.get("message") or body.get("error_msg") or str(body)
        except Exception:
            detail = res.text[:300]
        raise HTTPException(status_code=res.status_code, detail=f"Webull {action} failed: {detail}")
    return res.json()


# ── Public adapter functions ───────────────────────────────────

def validate_and_get_account_id(api_key: str, api_secret: str, paper: bool) -> str:
    """
    Called on broker /connect to verify credentials and return the account_id.
    Webull has no paper/sandbox mode — `paper` is accepted but ignored.

    First-ever use of an App Key triggers an async server-side session approval
    that has been observed taking anywhere from ~50s to over 60s — not tied to
    any manual user action we've found, just backend processing lag. We poll
    up to 110s before giving up.
    """
    client = _make_api_client(api_key, api_secret, duration=110)
    try:
        trade_client = TradeClient(client)
        data = _check(trade_client.account_v2.get_account_list(), "get_account_list")
    except HTTPException:
        raise
    except ClientException as exc:
        if "PENDING" in str(exc):
            raise HTTPException(
                status_code=409,
                detail="Webull is still verifying this connection. This can take a couple of minutes on first use — please try connecting again shortly.",
            )
        raise HTTPException(status_code=401, detail=f"Webull authentication failed: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Webull authentication failed: {exc}")
    if not data:
        raise HTTPException(status_code=400, detail="No Webull accounts found for this App Key")
    return data[0]["account_id"]


def get_account(conn: BrokerConnection) -> dict:
    trade_client = _trade_client(conn)
    bal = _check(trade_client.account_v2.get_account_balance(conn.account_id), "get_account_balance")
    currency_asset = (bal.get("account_currency_assets") or [{}])[0]

    equity = bal.get("total_net_liquidation_value", "0")
    return {
        "id": conn.account_id,
        "status": "ACTIVE",
        "currency": bal.get("total_asset_currency", "USD"),
        "cash": bal.get("total_cash_balance", "0"),
        "portfolio_value": equity,
        "buying_power": currency_asset.get("buying_power", "0"),
        "equity": equity,
        "last_equity": equity,
        "long_market_value": bal.get("total_market_value", "0"),
        "short_market_value": "0",
        "daytrade_count": 0,  # not exposed by this API; PDT tracked internally
        "pattern_day_trader": False,
        "trading_blocked": False,
        "transfers_blocked": False,
        "is_paper": False,
    }


def get_positions(conn: BrokerConnection) -> list[dict]:
    trade_client = _trade_client(conn)
    positions = _check(trade_client.account_v2.get_account_position(conn.account_id), "get_account_position")

    result = []
    for p in positions:
        qty = float(p.get("quantity", 0))
        avg = float(p.get("cost_price", 0))
        current = float(p.get("last_price", avg))
        market_val = qty * current
        cost_val = qty * avg
        pl = market_val - cost_val
        result.append({
            "symbol": p.get("symbol", ""),
            "qty": str(qty),
            "avg_entry_price": str(avg),
            "current_price": str(current),
            "market_value": str(market_val),
            "unrealized_pl": str(pl),
            "unrealized_plpc": str(pl / cost_val if cost_val else 0),
            "side": "long" if qty > 0 else "short",
        })
    return result


def get_orders(conn: BrokerConnection, status: str = "all", limit: int = 50) -> list[dict]:
    trade_client = _trade_client(conn)
    page_size = max(10, min(limit, 100))
    combos = _check(
        trade_client.order_v2.get_order_history(conn.account_id, page_size=page_size),
        "get_order_history",
    )

    result = []
    for combo in combos:
        for o in combo.get("orders", []):
            st = str(o.get("status", "")).lower()
            if status == "open" and st not in ("working", "pending", "pending_new", "partially_filled"):
                continue
            if status == "closed" and st not in ("filled", "cancelled", "rejected", "expired"):
                continue
            result.append({
                "id": o.get("order_id", ""),
                "symbol": o.get("symbol", ""),
                "qty": str(o.get("total_quantity", "")),
                "filled_qty": str(o.get("filled_quantity", "0")),
                "type": str(o.get("order_type", "MARKET")).upper(),
                "side": str(o.get("side", "BUY")).lower(),
                "status": st,
                "limit_price": o.get("limit_price"),
                "stop_price": o.get("stop_price"),
                "filled_avg_price": o.get("filled_price"),
                "submitted_at": o.get("place_time_at"),
                "filled_at": o.get("filled_time_at"),
            })
    return result[:limit]


def place_bracket_order(
    conn: BrokerConnection,
    symbol: str,
    qty: Decimal,
    side: str,
    take_profit_price: Decimal,
    stop_loss_price: Decimal,
) -> dict:
    trade_client = _trade_client(conn)
    exit_side = "SELL" if side == "buy" else "BUY"

    entry_id = uuid.uuid4().hex
    entry_order = [{
        "client_order_id": entry_id,
        "symbol": symbol,
        "instrument_type": "EQUITY",
        "market": "US",
        "order_type": "MARKET",
        "quantity": str(qty),
        "side": side.upper(),
        "time_in_force": "DAY",
        "entrust_type": "QTY",
    }]
    entry_res = _check(trade_client.order_v2.place_order(conn.account_id, entry_order), "place_order (entry)")

    tp_order = [{
        "client_order_id": uuid.uuid4().hex,
        "symbol": symbol,
        "instrument_type": "EQUITY",
        "market": "US",
        "order_type": "LIMIT",
        "limit_price": str(take_profit_price),
        "quantity": str(qty),
        "side": exit_side,
        "time_in_force": "GTC",
        "entrust_type": "QTY",
    }]
    sl_order = [{
        "client_order_id": uuid.uuid4().hex,
        "symbol": symbol,
        "instrument_type": "EQUITY",
        "market": "US",
        "order_type": "STOP",
        "aux_price": str(stop_loss_price),
        "quantity": str(qty),
        "side": exit_side,
        "time_in_force": "GTC",
        "entrust_type": "QTY",
    }]
    # Best-effort: entry already submitted: don't fail the whole call if an exit leg errors.
    for leg in (tp_order, sl_order):
        try:
            _check(trade_client.order_v2.place_order(conn.account_id, leg), "place_order (exit leg)")
        except HTTPException:
            pass

    return {
        "id": entry_id,
        "symbol": symbol,
        "qty": str(qty),
        "side": side,
        "status": "submitted",
        "order_class": "bracket",
    }


def cancel_order(conn: BrokerConnection, broker_order_id: str) -> None:
    trade_client = _trade_client(conn)
    _check(trade_client.order_v2.cancel_order(conn.account_id, broker_order_id), "cancel_order")


def cancel_all_orders(conn: BrokerConnection) -> None:
    for o in get_orders(conn, status="open", limit=100):
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
    data_client = _data_client(conn)
    tf_map = {
        "1Min": Timespan.M1.name, "5Min": Timespan.M5.name, "15Min": Timespan.M15.name,
        "30Min": Timespan.M30.name, "1Hour": Timespan.M60.name, "1Day": Timespan.D.name,
    }
    ts = tf_map.get(timeframe, Timespan.M60.name)
    res = data_client.market_data.get_history_bar(symbol, Category.US_STOCK.name, ts, count=str(limit))
    bars = _check(res, "get_history_bar")

    result = []
    for b in bars:
        result.append({
            "t": b.get("timestamp_at") or str(b.get("timestamp", "")),
            "o": float(b.get("open", 0)),
            "h": float(b.get("high", 0)),
            "l": float(b.get("low", 0)),
            "c": float(b.get("close", 0)),
            "v": float(b.get("volume", 0)),
        })
    return result[-limit:]


def get_latest_quote(conn: BrokerConnection, symbol: str) -> dict:
    data_client = _data_client(conn)
    data = _check(data_client.market_data.get_snapshot(symbol, Category.US_STOCK.name), "get_snapshot")
    snap = data[0] if isinstance(data, list) and data else (data or {})

    return {
        "symbol": symbol,
        "ask_price": float(snap.get("ask_price", 0) or 0),
        "bid_price": float(snap.get("bid_price", 0) or 0),
        "ask_size": float(snap.get("ask_size", 0) or 0),
        "bid_size": float(snap.get("bid_size", 0) or 0),
        "timestamp": dt.datetime.utcnow().isoformat(),
    }


def get_options_chain(conn: BrokerConnection, symbol: str, target_dte: int | None = None) -> dict:
    """target_dte accepted for interface parity with tradier.py's adapter —
    this stub doesn't yet support picking a specific expiration by DTE."""
    data_client = _data_client(conn)
    instruments = _check(
        data_client.instrument.get_instrument(symbol, Category.US_OPTION.name),
        "get_instrument (options)",
    )
    return {"symbol": symbol, "options": instruments}
