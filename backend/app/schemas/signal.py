import uuid
from datetime import date, datetime

from pydantic import BaseModel


class SignalResponse(BaseModel):
    id: uuid.UUID
    symbol: str
    signal_type: str
    confidence: float
    timeframe: str
    entry_price: float | None
    target_price: float | None
    stop_price: float | None
    pattern_detected: str | None
    indicators: dict
    reasoning: str | None
    model_version: str
    expires_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RankedSignalResponse(SignalResponse):
    rank: int           # 1-based position in the ranked list
    tier: str           # "green" | "light_green" | "light_yellow"
    option_type: str    # "CALL" | "PUT" — derived from signal_type (BUY->CALL, SELL->PUT)


class WatchlistAddRequest(BaseModel):
    ticker: str

    def model_post_init(self, __context):
        self.ticker = self.ticker.upper().strip()


class AutomationConfigRequest(BaseModel):
    broker_connection_id: uuid.UUID
    is_enabled: bool = False
    min_confidence: float = 0.60
    max_position_size_usd: float | None = None
    max_position_pct: float = 0.10
    stop_loss_pct: float = 0.02
    take_profit_pct: float = 0.04
    max_daily_loss_usd: float | None = None
    max_open_positions: int = 5
    cooldown_minutes: int = 60


class AutomationConfigResponse(BaseModel):
    id: uuid.UUID
    broker_connection_id: uuid.UUID
    is_enabled: bool
    min_confidence: float
    max_position_size_usd: float | None
    max_position_pct: float
    stop_loss_pct: float
    take_profit_pct: float
    max_daily_loss_usd: float | None
    max_open_positions: int
    cooldown_minutes: int
    created_at: datetime

    model_config = {"from_attributes": True}


class OrderResponse(BaseModel):
    id: uuid.UUID
    ticker: str
    side: str
    quantity: float
    status: str
    is_automated: bool
    rejection_reason: str | None
    asset_type: str
    option_right: str | None
    avg_fill_price: float | None
    stop_price: float | None
    take_profit_price: float | None
    submitted_at: datetime | None
    filled_at: datetime | None
    created_at: datetime

    # Realized P&L — populated only when Tradier's own closed-position
    # ledger has a matching exit. Never fabricated: stays null until a
    # real closing fill is found. See get_orders() in api/signals.py.
    exit_price: float | None = None
    closed_at: datetime | None = None
    pnl_usd: float | None = None
    pnl_pct: float | None = None

    model_config = {"from_attributes": True}


class OptionsAutomationConfigRequest(BaseModel):
    broker_connection_id: uuid.UUID
    is_enabled: bool = False
    require_manual_approval: bool = True
    budget_usd: float = 10_000.0
    min_confidence: float = 0.40
    max_contracts_per_trade: int = 1
    max_open_positions: int = 5
    target_dte_min: int = 7
    target_dte_max: int = 21
    profit_target_pct: float = 0.50
    stop_loss_pct: float = 0.30


class OptionsAutomationConfigResponse(BaseModel):
    id: uuid.UUID
    broker_connection_id: uuid.UUID
    is_enabled: bool
    require_manual_approval: bool
    budget_usd: float
    min_confidence: float
    max_contracts_per_trade: int
    max_open_positions: int
    target_dte_min: int
    target_dte_max: int
    profit_target_pct: float
    stop_loss_pct: float
    created_at: datetime

    model_config = {"from_attributes": True}


class PendingOptionOrderResponse(BaseModel):
    id: uuid.UUID
    ticker: str
    option_symbol: str | None
    option_right: str | None
    strike_price: float | None
    expiration_date: date | None
    quantity: float
    premium_paid: float | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
