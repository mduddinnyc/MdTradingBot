import uuid
from datetime import datetime

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
    avg_fill_price: float | None
    stop_price: float | None
    take_profit_price: float | None
    submitted_at: datetime | None
    filled_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}
