"""
Interactive Brokers adapter using ib_insync.
Implements the same interface as services/alpaca.py so the adapter registry
in broker_adapter.py can swap it in transparently.

Requirements:
  pip install ib_insync

Runtime requirement:
  IB Gateway or TWS must be running and accepting API connections.
  The connection credentials stored in BrokerConnection are:
    api_key_enc   → IB Gateway host (default: "127.0.0.1")
    api_secret_enc → IB Gateway port (default: "7497" paper / "7496" live)
  account_id is the IB account string (e.g. "DU1234567" for paper).

The adapter opens a NEW IB connection per call (stateless, short-lived).
For high-frequency use, refactor to a connection pool.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from fastapi import HTTPException

from app.core.encryption import decrypt_secret
from app.models.broker import BrokerConnection

_IB_AVAILABLE = False
try:
    from ib_insync import IB, Stock, MarketOrder, BracketOrder, util
    _IB_AVAILABLE = True
except ImportError:
    pass


def _not_installed():
    raise HTTPException(
        status_code=501,
        detail="ib_insync is not installed. Run: pip install ib_insync",
    )


def _connect(conn: BrokerConnection) -> "IB":
    if not _IB_AVAILABLE:
        _not_installed()
    host = decrypt_secret(conn.api_key_enc)    # repurposed field: stores host
    port_str = decrypt_secret(conn.api_secret_enc)  # repurposed field: stores port
    host = host or "127.0.0.1"
    port = int(port_str) if port_str and port_str.isdigit() else (7497 if conn.is_paper else 7496)
    ib = IB()
    try:
        ib.connect(host, port, clientId=1, timeout=10, readonly=False)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IB Gateway connection failed: {exc}")
    return ib


def validate_and_get_account_id(api_key: str, api_secret: str, paper: bool) -> str:
    """
    api_key   = IB Gateway host (e.g. "127.0.0.1")
    api_secret = IB Gateway port (e.g. "7497")
    Returns the IB account string.
    """
    if not _IB_AVAILABLE:
        _not_installed()
    host = api_key or "127.0.0.1"
    port = int(api_secret) if api_secret and api_secret.isdigit() else (7497 if paper else 7496)
    ib = IB()
    try:
        ib.connect(host, port, clientId=99, timeout=10, readonly=True)
        accounts = ib.managedAccounts()
        ib.disconnect()
        if not accounts:
            raise HTTPException(status_code=400, detail="No IB accounts found")
        return accounts[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"IB Gateway authentication failed: {exc}")


def get_account(conn: BrokerConnection) -> dict:
    ib = _connect(conn)
    try:
        summary = {v.tag: v.value for v in ib.accountSummary(conn.account_id)}
        return {
            "id": conn.account_id,
            "status": "ACTIVE",
            "currency": summary.get("Currency", "USD"),
            "cash": summary.get("CashBalance", "0"),
            "portfolio_value": summary.get("NetLiquidation", "0"),
            "buying_power": summary.get("BuyingPower", "0"),
            "equity": summary.get("NetLiquidation", "0"),
            "last_equity": summary.get("NetLiquidation", "0"),
            "long_market_value": summary.get("StockMarketValue", "0"),
            "short_market_value": "0",
            "daytrade_count": int(summary.get("DayTradesRemaining", 3)),
            "pattern_day_trader": False,
            "trading_blocked": False,
            "transfers_blocked": False,
            "is_paper": conn.is_paper,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IB account fetch failed: {exc}")
    finally:
        ib.disconnect()


def get_positions(conn: BrokerConnection) -> list[dict]:
    ib = _connect(conn)
    try:
        positions = ib.positions(conn.account_id)
        return [
            {
                "symbol": p.contract.symbol,
                "qty": str(p.position),
                "avg_entry_price": str(p.avgCost),
                "current_price": str(p.avgCost),   # live price requires separate reqMktData call
                "market_value": str(float(p.position) * float(p.avgCost)),
                "unrealized_pl": "0",
                "unrealized_plpc": "0",
                "side": "long" if p.position > 0 else "short",
            }
            for p in positions
        ]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IB positions fetch failed: {exc}")
    finally:
        ib.disconnect()


def get_orders(conn: BrokerConnection, status: str = "all", limit: int = 50) -> list[dict]:
    ib = _connect(conn)
    try:
        trades = ib.trades()
        result = []
        for t in trades[:limit]:
            o = t.order
            s = t.orderStatus
            result.append({
                "id": str(o.orderId),
                "symbol": t.contract.symbol,
                "qty": str(o.totalQuantity),
                "filled_qty": str(s.filled),
                "type": o.orderType,
                "side": o.action.lower(),
                "status": s.status.lower(),
                "limit_price": str(o.lmtPrice) if o.lmtPrice else None,
                "stop_price": str(o.auxPrice) if o.auxPrice else None,
                "filled_avg_price": str(s.avgFillPrice) if s.avgFillPrice else None,
                "submitted_at": None,
                "filled_at": None,
            })
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IB orders fetch failed: {exc}")
    finally:
        ib.disconnect()


def place_bracket_order(
    conn: BrokerConnection,
    symbol: str,
    qty: Decimal,
    side: str,
    take_profit_price: Decimal,
    stop_loss_price: Decimal,
) -> dict:
    ib = _connect(conn)
    try:
        contract = Stock(symbol, "SMART", "USD")
        ib.qualifyContracts(contract)

        action = "BUY" if side == "buy" else "SELL"
        bracket = ib.bracketOrder(
            action=action,
            quantity=float(qty),
            limitPrice=float(qty),          # market entry — use limitPrice=0 trick
            takeProfitPrice=float(take_profit_price),
            stopLossPrice=float(stop_loss_price),
        )
        # Override to market entry
        bracket[0].orderType = "MKT"
        bracket[0].lmtPrice  = 0

        trades = [ib.placeOrder(contract, o) for o in bracket]
        ib.sleep(1)
        parent = trades[0]
        return {
            "id": str(parent.order.orderId),
            "symbol": symbol,
            "qty": str(qty),
            "side": side,
            "status": parent.orderStatus.status.lower(),
            "order_class": "bracket",
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IB bracket order failed: {exc}")
    finally:
        ib.disconnect()


def cancel_order(conn: BrokerConnection, broker_order_id: str) -> None:
    ib = _connect(conn)
    try:
        for trade in ib.trades():
            if str(trade.order.orderId) == broker_order_id:
                ib.cancelOrder(trade.order)
                break
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IB cancel failed: {exc}")
    finally:
        ib.disconnect()


def cancel_all_orders(conn: BrokerConnection) -> None:
    ib = _connect(conn)
    try:
        ib.reqGlobalCancel()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IB cancel all failed: {exc}")
    finally:
        ib.disconnect()


def get_bars(
    conn: BrokerConnection,
    symbol: str,
    timeframe: str = "1Hour",
    limit: int = 100,
) -> list[dict]:
    ib = _connect(conn)
    try:
        contract = Stock(symbol, "SMART", "USD")
        ib.qualifyContracts(contract)

        bar_size_map = {
            "1Min":  "1 min",
            "5Min":  "5 mins",
            "15Min": "15 mins",
            "1Hour": "1 hour",
            "1Day":  "1 day",
        }
        bar_size = bar_size_map.get(timeframe, "1 hour")

        # Duration to cover `limit` bars
        duration_map = {
            "1Min":  f"{max(1, limit // 390 + 1)} D",
            "5Min":  f"{max(1, limit // 78 + 1)} D",
            "15Min": f"{max(1, limit // 26 + 1)} D",
            "1Hour": f"{max(1, limit // 7 + 1)} D",
            "1Day":  f"{max(1, limit // 252 + 1)} Y",
        }
        duration = duration_map.get(timeframe, "5 D")

        bars = ib.reqHistoricalData(
            contract,
            endDateTime="",
            durationStr=duration,
            barSizeSetting=bar_size,
            whatToShow="TRADES",
            useRTH=True,
            formatDate=1,
        )
        return [
            {
                "t": b.date.isoformat() if hasattr(b.date, "isoformat") else str(b.date),
                "o": float(b.open),
                "h": float(b.high),
                "l": float(b.low),
                "c": float(b.close),
                "v": float(b.volume),
            }
            for b in bars[-limit:]
        ]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IB bars fetch failed: {exc}")
    finally:
        ib.disconnect()


def get_latest_quote(conn: BrokerConnection, symbol: str) -> dict:
    ib = _connect(conn)
    try:
        contract = Stock(symbol, "SMART", "USD")
        ib.qualifyContracts(contract)
        ticker = ib.reqMktData(contract, "", False, False)
        ib.sleep(2)
        return {
            "symbol": symbol,
            "ask_price": float(ticker.ask) if ticker.ask else 0.0,
            "bid_price": float(ticker.bid) if ticker.bid else 0.0,
            "ask_size":  float(ticker.askSize) if ticker.askSize else 0.0,
            "bid_size":  float(ticker.bidSize) if ticker.bidSize else 0.0,
            "timestamp": dt.datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"IB quote fetch failed: {exc}")
    finally:
        ib.disconnect()
