"""
Alpaca broker adapter.
Wraps alpaca-py SDK calls into clean async-friendly methods.
All methods raise HTTPException on broker errors so routers stay clean.
"""
from decimal import Decimal

from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, OrderType, TimeInForce
from alpaca.trading.requests import MarketOrderRequest, LimitOrderRequest, StopLimitOrderRequest
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest, StockLatestQuoteRequest
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
from fastapi import HTTPException

from app.core.encryption import decrypt_secret
from app.models.broker import BrokerConnection

import datetime as dt


def _client(conn: BrokerConnection) -> TradingClient:
    api_key = decrypt_secret(conn.api_key_enc)
    api_secret = decrypt_secret(conn.api_secret_enc)
    return TradingClient(api_key=api_key, secret_key=api_secret, paper=conn.is_paper)


def _data_client(conn: BrokerConnection) -> StockHistoricalDataClient:
    api_key = decrypt_secret(conn.api_key_enc)
    api_secret = decrypt_secret(conn.api_secret_enc)
    return StockHistoricalDataClient(api_key=api_key, secret_key=api_secret)


def validate_and_get_account_id(api_key: str, api_secret: str, paper: bool) -> str:
    """Validate credentials by calling Alpaca. Returns account ID."""
    try:
        client = TradingClient(api_key=api_key, secret_key=api_secret, paper=paper)
        account = client.get_account()
        return str(account.id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Alpaca authentication failed: {exc}")


def get_account(conn: BrokerConnection) -> dict:
    try:
        account = _client(conn).get_account()
        return {
            "id": str(account.id),
            "status": str(account.status),
            "currency": account.currency,
            "cash": str(account.cash),
            "portfolio_value": str(account.portfolio_value),
            "buying_power": str(account.buying_power),
            "equity": str(account.equity),
            "last_equity": str(account.last_equity),
            "long_market_value": str(account.long_market_value),
            "short_market_value": str(account.short_market_value),
            "daytrade_count": account.daytrade_count,
            "pattern_day_trader": account.pattern_day_trader,
            "trading_blocked": account.trading_blocked,
            "transfers_blocked": account.transfers_blocked,
            "is_paper": conn.is_paper,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {exc}")


def get_positions(conn: BrokerConnection) -> list[dict]:
    try:
        positions = _client(conn).get_all_positions()
        return [
            {
                "symbol": p.symbol,
                "qty": str(p.qty),
                "avg_entry_price": str(p.avg_entry_price),
                "current_price": str(p.current_price),
                "market_value": str(p.market_value),
                "unrealized_pl": str(p.unrealized_pl),
                "unrealized_plpc": str(p.unrealized_plpc),
                "side": str(p.side),
            }
            for p in positions
        ]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {exc}")


def get_orders(conn: BrokerConnection, status: str = "all", limit: int = 50) -> list[dict]:
    try:
        from alpaca.trading.requests import GetOrdersRequest
        from alpaca.trading.enums import QueryOrderStatus
        req = GetOrdersRequest(status=QueryOrderStatus(status), limit=limit)
        orders = _client(conn).get_orders(filter=req)
        return [
            {
                "id": str(o.id),
                "symbol": o.symbol,
                "qty": str(o.qty),
                "filled_qty": str(o.filled_qty),
                "type": str(o.type),
                "side": str(o.side),
                "status": str(o.status),
                "limit_price": str(o.limit_price) if o.limit_price else None,
                "stop_price": str(o.stop_price) if o.stop_price else None,
                "filled_avg_price": str(o.filled_avg_price) if o.filled_avg_price else None,
                "submitted_at": o.submitted_at.isoformat() if o.submitted_at else None,
                "filled_at": o.filled_at.isoformat() if o.filled_at else None,
            }
            for o in orders
        ]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {exc}")


def place_market_order(
    conn: BrokerConnection,
    symbol: str,
    qty: Decimal,
    side: str,
) -> dict:
    try:
        req = MarketOrderRequest(
            symbol=symbol,
            qty=float(qty),
            side=OrderSide(side),
            time_in_force=TimeInForce.DAY,
        )
        order = _client(conn).submit_order(req)
        return {
            "id": str(order.id),
            "symbol": order.symbol,
            "qty": str(order.qty),
            "side": str(order.side),
            "type": str(order.type),
            "status": str(order.status),
            "submitted_at": order.submitted_at.isoformat() if order.submitted_at else None,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Order placement failed: {exc}")


def place_bracket_order(
    conn: BrokerConnection,
    symbol: str,
    qty: Decimal,
    side: str,
    take_profit_price: Decimal,
    stop_loss_price: Decimal,
) -> dict:
    """Bracket order = entry + auto take-profit + auto stop-loss."""
    try:
        from alpaca.trading.requests import MarketOrderRequest, TakeProfitRequest, StopLossRequest
        req = MarketOrderRequest(
            symbol=symbol,
            qty=float(qty),
            side=OrderSide(side),
            time_in_force=TimeInForce.DAY,
            order_class="bracket",
            take_profit=TakeProfitRequest(limit_price=float(take_profit_price)),
            stop_loss=StopLossRequest(stop_price=float(stop_loss_price)),
        )
        order = _client(conn).submit_order(req)
        return {
            "id": str(order.id),
            "symbol": order.symbol,
            "qty": str(order.qty),
            "side": str(order.side),
            "status": str(order.status),
            "order_class": "bracket",
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Bracket order failed: {exc}")


def cancel_order(conn: BrokerConnection, broker_order_id: str) -> None:
    try:
        import uuid as _uuid
        _client(conn).cancel_order_by_id(_uuid.UUID(broker_order_id))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Cancel failed: {exc}")


def cancel_all_orders(conn: BrokerConnection) -> None:
    try:
        _client(conn).cancel_orders()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Cancel all failed: {exc}")


def get_bars(
    conn: BrokerConnection,
    symbol: str,
    timeframe: str = "1Hour",
    limit: int = 100,
) -> list[dict]:
    """Fetch OHLCV bars. timeframe: '1Min','5Min','15Min','1Hour','1Day'."""
    tf_map = {
        "1Min": TimeFrame(1, TimeFrameUnit.Minute),
        "5Min": TimeFrame(5, TimeFrameUnit.Minute),
        "15Min": TimeFrame(15, TimeFrameUnit.Minute),
        "1Hour": TimeFrame(1, TimeFrameUnit.Hour),
        "1Day": TimeFrame(1, TimeFrameUnit.Day),
    }
    tf = tf_map.get(timeframe, TimeFrame(1, TimeFrameUnit.Hour))
    end = dt.datetime.utcnow()
    start = end - dt.timedelta(days=30 if timeframe == "1Day" else 3)

    try:
        req = StockBarsRequest(symbol_or_symbols=symbol, timeframe=tf, start=start, end=end, limit=limit)
        bars = _data_client(conn).get_stock_bars(req)[symbol]
        return [
            {
                "t": b.timestamp.isoformat(),
                "o": float(b.open),
                "h": float(b.high),
                "l": float(b.low),
                "c": float(b.close),
                "v": float(b.volume),
            }
            for b in bars
        ]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Bar fetch failed: {exc}")


def get_latest_quote(conn: BrokerConnection, symbol: str) -> dict:
    try:
        req = StockLatestQuoteRequest(symbol_or_symbols=symbol)
        quote = _data_client(conn).get_stock_latest_quote(req)[symbol]
        return {
            "symbol": symbol,
            "ask_price": float(quote.ask_price),
            "bid_price": float(quote.bid_price),
            "ask_size": float(quote.ask_size),
            "bid_size": float(quote.bid_size),
            "timestamp": quote.timestamp.isoformat(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Quote fetch failed: {exc}")
