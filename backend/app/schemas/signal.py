import uuid
from datetime import date, datetime

from pydantic import BaseModel, field_validator


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


class RiskProfileWizardRequest(BaseModel):
    """
    The 3-tap wizard from docs/AUTOPILOT_MODE_DESIGN.md §2.1. Resolves to
    the same AutomationConfig fields the manual form sets — no schema
    redesign, just a guided path that always sets max_daily_loss_usd
    (mandatory here; optional/nullable on the manual form).
    """
    broker_connection_id: uuid.UUID
    risk_profile: str
    capital_mode: str
    capital_value: float
    universe: str
    is_enabled: bool = True

    @field_validator("risk_profile")
    @classmethod
    def valid_profile(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in ("conservative", "balanced", "aggressive"):
            raise ValueError("risk_profile must be 'conservative', 'balanced', or 'aggressive'")
        return v

    @field_validator("capital_mode")
    @classmethod
    def valid_capital_mode(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in ("dollar", "percent"):
            raise ValueError("capital_mode must be 'dollar' or 'percent'")
        return v

    @field_validator("universe")
    @classmethod
    def valid_universe(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in ("watchlist", "day_trade_scan"):
            raise ValueError("universe must be 'watchlist' or 'day_trade_scan'")
        return v

    @field_validator("capital_value")
    @classmethod
    def positive_capital(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("capital_value must be positive")
        return v


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
    max_trades_per_day: int | None = None


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
    max_trades_per_day: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ManualOrderRequest(BaseModel):
    broker_connection_id: uuid.UUID
    ticker: str
    side: str
    quantity: float
    order_type: str = "market"
    limit_price: float | None = None
    take_profit_price: float | None = None
    stop_loss_price: float | None = None

    @field_validator("ticker")
    @classmethod
    def upper_ticker(cls, v: str) -> str:
        return v.upper().strip()

    @field_validator("side")
    @classmethod
    def valid_side(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in ("buy", "sell"):
            raise ValueError("side must be 'buy' or 'sell'")
        return v

    @field_validator("order_type")
    @classmethod
    def valid_order_type(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in ("market", "limit"):
            raise ValueError("order_type must be 'market' or 'limit'")
        return v

    @field_validator("quantity")
    @classmethod
    def positive_quantity(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("quantity must be positive")
        return v


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

    # Which strategy's signal produced this order, if any — null for
    # manually-placed orders and for automated orders predating strategies.
    strategy_name: str | None = None

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


class ManualOptionOrderRequest(BaseModel):
    """
    A user-picked contract from the real chain — option_symbol must be the
    exact OCC symbol the chain endpoint returned, never hand-typed. Side
    'buy' opens a new long call/put; 'sell' closes one already held (no
    naked writing — this platform never has, by design).
    """
    broker_connection_id: uuid.UUID
    ticker: str
    option_symbol: str
    option_right: str
    strike_price: float
    expiration_date: date
    side: str
    quantity: int = 1

    @field_validator("ticker", "option_symbol")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper().strip()

    @field_validator("option_right")
    @classmethod
    def valid_right(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in ("call", "put"):
            raise ValueError("option_right must be 'call' or 'put'")
        return v

    @field_validator("side")
    @classmethod
    def valid_side(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in ("buy", "sell"):
            raise ValueError("side must be 'buy' or 'sell'")
        return v

    @field_validator("quantity")
    @classmethod
    def positive_quantity(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("quantity must be positive")
        return v


class StrategyResponse(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    description: str
    w_trend: float
    w_momentum: float
    w_pattern: float
    allowed_regimes: list[str] | None
    min_volume_ratio: float | None

    # This user's config for this strategy — defaults when none saved yet.
    is_enabled: bool
    mode: str
    allocated_capital_usd: float
    expires_at: datetime | None = None

    # Real performance from this user's own closed orders, all-time.
    # Never fabricated: null/zero until there's actual trade history.
    total_trades: int
    wins: int
    win_rate: float | None = None
    total_pnl_usd: float | None = None

    model_config = {"from_attributes": True}


class StrategyConfigRequest(BaseModel):
    broker_connection_id: uuid.UUID
    is_enabled: bool = False
    mode: str = "manual"
    allocated_capital_usd: float = 1000.0
    expires_at: datetime | None = None

    @field_validator("mode")
    @classmethod
    def valid_mode(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in ("auto", "manual"):
            raise ValueError("mode must be 'auto' or 'manual'")
        return v

    @field_validator("allocated_capital_usd")
    @classmethod
    def positive_capital(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("allocated_capital_usd must be positive")
        return v


class StrategyPerformanceResponse(BaseModel):
    strategy_id: uuid.UUID
    strategy_key: str
    strategy_name: str
    trades: int
    wins: int
    win_rate: float | None = None
    total_pnl_usd: float | None = None
    avg_pnl_pct: float | None = None
