"""
Broker adapter protocol.
Every broker service (alpaca, ibkr, tastytrade …) must implement these
functions. The execution engine and API routers import from this module to
resolve the right adapter at runtime based on BrokerConnection.broker_name.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Protocol

from app.models.broker import BrokerConnection


class BrokerAdapter(Protocol):
    """Structural protocol — no base class needed, duck-typed at call sites."""

    def validate_and_get_account_id(self, api_key: str, api_secret: str, paper: bool) -> str: ...

    def get_account(self, conn: BrokerConnection) -> dict: ...

    def get_positions(self, conn: BrokerConnection) -> list[dict]: ...

    def get_orders(self, conn: BrokerConnection, status: str, limit: int) -> list[dict]: ...

    def place_bracket_order(
        self,
        conn: BrokerConnection,
        symbol: str,
        qty: Decimal,
        side: str,
        take_profit_price: Decimal,
        stop_loss_price: Decimal,
    ) -> dict: ...

    def cancel_order(self, conn: BrokerConnection, broker_order_id: str) -> None: ...

    def cancel_all_orders(self, conn: BrokerConnection) -> None: ...

    def get_bars(self, conn: BrokerConnection, symbol: str, timeframe: str, limit: int) -> list[dict]: ...

    def get_latest_quote(self, conn: BrokerConnection, symbol: str) -> dict: ...


# ── Registry ───────────────────────────────────────────────────

def get_adapter(broker_name: str):
    """
    Return the module that implements the broker adapter for broker_name.
    Raises ValueError for unknown brokers.
    Import is deferred so optional dependencies (ib_insync, tastytrade)
    are only loaded when that broker is actually used.
    """
    if broker_name == "alpaca":
        from app.services import alpaca as _mod
        return _mod
    if broker_name == "ibkr":
        from app.services import ibkr as _mod
        return _mod
    if broker_name == "tastytrade":
        from app.services import tastytrade as _mod
        return _mod
    if broker_name == "webull":
        from app.services import webull as _mod
        return _mod
    if broker_name == "tradier":
        from app.services import tradier as _mod
        return _mod
    raise ValueError(f"Unknown broker: {broker_name!r}")
