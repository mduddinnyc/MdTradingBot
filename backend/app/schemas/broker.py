import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator


_SUPPORTED_BROKERS = {"alpaca", "ibkr", "tastytrade", "webull", "tradier"}


class BrokerConnectRequest(BaseModel):
    broker_name: str = "alpaca"
    api_key: str
    api_secret: str
    is_paper: bool = True
    display_name: str | None = None

    @field_validator("broker_name")
    @classmethod
    def valid_broker(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in _SUPPORTED_BROKERS:
            raise ValueError(f"Unsupported broker '{v}'. Choose from: {sorted(_SUPPORTED_BROKERS)}")
        return v

    @field_validator("api_key", "api_secret")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Cannot be empty")
        return v.strip()


class BrokerConnectionResponse(BaseModel):
    id: uuid.UUID
    broker_name: str
    display_name: str | None
    account_id: str | None
    is_active: bool
    is_paper: bool
    permissions: dict
    last_sync_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AccountResponse(BaseModel):
    id: str
    status: str
    currency: str
    cash: str
    portfolio_value: str
    buying_power: str
    equity: str
    last_equity: str
    long_market_value: str
    short_market_value: str
    daytrade_count: int
    pattern_day_trader: bool
    trading_blocked: bool
    transfers_blocked: bool
    is_paper: bool
