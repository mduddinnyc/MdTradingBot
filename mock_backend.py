#!/usr/bin/env python3
"""
Mock trading API — serves realistic fake data so the frontend can be tested
without a real Alpaca account or PostgreSQL.
Mirrors every endpoint that api.ts calls.
"""
from __future__ import annotations
import math, random, uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

random.seed(42)

app = FastAPI(title="TradingAI Mock API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static IDs ─────────────────────────────────────────────────
CONN_ID   = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
USER_ID   = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
AUTO_ID   = "cccccccc-cccc-cccc-cccc-cccccccccccc"
FAKE_JWT  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock.mock"

SYMBOLS = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN"]
BASE_PRICES = {"AAPL": 213.5, "TSLA": 248.7, "NVDA": 134.6, "MSFT": 471.2, "AMZN": 201.3}

# ── Helpers ────────────────────────────────────────────────────

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def ago(hours=0, minutes=0, days=0):
    return (datetime.now(timezone.utc) - timedelta(hours=hours, minutes=minutes, days=days)).isoformat()

def gen_bars(symbol: str, timeframe: str = "1Hour", limit: int = 100):
    base = BASE_PRICES.get(symbol, 150.0)
    bars = []
    delta = timedelta(hours=1) if timeframe == "1Hour" else timedelta(days=1)
    t = datetime.now(timezone.utc) - delta * limit
    price = base * random.uniform(0.88, 0.95)
    for _ in range(limit):
        pct = random.gauss(0.0003, 0.012)
        price = max(price * (1 + pct), 1.0)
        o = round(price, 2)
        c = round(price * (1 + random.gauss(0, 0.004)), 2)
        h = round(max(o, c) * (1 + abs(random.gauss(0, 0.003))), 2)
        l = round(min(o, c) * (1 - abs(random.gauss(0, 0.003))), 2)
        bars.append({"t": t.isoformat(), "o": o, "h": h, "l": l, "c": c,
                     "v": random.randint(500_000, 8_000_000)})
        t += delta
        price = c
    return bars

_bars_cache: dict = {}

def cached_bars(symbol, timeframe="1Hour", limit=100):
    key = (symbol, timeframe)
    if key not in _bars_cache:
        _bars_cache[key] = gen_bars(symbol, timeframe, limit)
    return _bars_cache[key][-limit:]

def gen_signals():
    patterns = ["Bullish Engulfing", "Hammer", "Double Bottom", "Shooting Star",
                "Bearish Engulfing", "Doji", None]
    signal_types_w = [("BUY", 0.45), ("SELL", 0.30), ("HOLD", 0.25)]
    sigs = []
    for sym in SYMBOLS:
        bars  = cached_bars(sym)
        close = bars[-1]["c"]
        sig, _ = random.choices([s for s,_ in signal_types_w],
                                 weights=[w for _,w in signal_types_w])[0], None
        sig = random.choices([s for s,_ in signal_types_w],
                              weights=[w for _,w in signal_types_w])[0]
        conf = round(random.uniform(0.52, 0.94), 4)

        rsi  = round(random.uniform(22, 78), 2)
        macd = round(random.gauss(0, 0.06), 6)
        bb   = round(random.uniform(0.08, 0.92), 4)
        ema  = random.choice([-1.0, 1.0])
        adx  = round(random.uniform(14, 52), 2)
        vol  = round(random.uniform(0.6, 3.2), 2)
        ts   = round(ema * 0.5 + (bb - 0.5) * 0.3, 4)
        ms   = round(((30 - rsi)/30*0.5 if rsi < 30 else -(rsi-70)/30*0.5 if rsi > 70 else (rsi-50)/50*0.2)
                     + math.tanh(macd * 10) * 0.4, 4)

        entry  = round(close, 2)
        target = round(entry * (1.04 if sig == "BUY" else 0.96), 2) if sig != "HOLD" else None
        stop   = round(entry * (0.98 if sig == "BUY" else 1.02), 2) if sig != "HOLD" else None

        sigs.append({
            "id": str(uuid.uuid4()),
            "symbol": sym,
            "signal_type": sig,
            "confidence": conf,
            "timeframe": "1Hour",
            "entry_price": entry,
            "target_price": target,
            "stop_price": stop,
            "pattern_detected": random.choice(patterns),
            "indicators": {
                "rsi": rsi, "macd_hist": macd, "bb_pct": bb,
                "ema_signal": ema, "adx": adx, "volume_ratio": vol,
                "trend_score": ts, "momentum_score": ms,
            },
            "reasoning": (f"Trend={ts:.2f} Momentum={ms:.2f} Pattern={random.choice([p for p in patterns if p]) or 'None'} | "
                          f"RSI={rsi} MACD_hist={macd:.4f} BB%={bb:.2f} | "
                          f"EMA_signal={ema} ADX={adx} VolRatio={vol}"),
            "model_version": "rule-v1",
            "expires_at": ago(hours=-4),
            "created_at": ago(minutes=random.randint(3, 90)),
        })
    return sigs

_signals = gen_signals()

def gen_orders():
    sides    = ["buy", "sell"]
    statuses = ["filled", "filled", "filled", "rejected", "submitted"]
    orders   = []
    for i, sym in enumerate(SYMBOLS * 3):
        price = BASE_PRICES.get(sym, 150.0) * random.uniform(0.94, 1.06)
        side  = random.choice(sides)
        st    = random.choice(statuses)
        qty   = round(random.uniform(1, 25), 2)
        tp    = round(price * (1.04 if side == "buy" else 0.96), 2)
        sl    = round(price * (0.98 if side == "buy" else 1.02), 2)
        hours_ago = random.randint(1, 96)
        orders.append({
            "id": str(uuid.uuid4()),
            "ticker": sym,
            "side": side,
            "quantity": qty,
            "status": st,
            "is_automated": True,
            "rejection_reason": "Cooldown active until next cycle" if st == "rejected" else None,
            "avg_fill_price": round(price, 2) if st == "filled" else None,
            "stop_price": sl,
            "take_profit_price": tp,
            "submitted_at": ago(hours=hours_ago),
            "filled_at": ago(hours=hours_ago - 1) if st == "filled" else None,
            "created_at": ago(hours=hours_ago),
        })
    orders.sort(key=lambda x: x["created_at"], reverse=True)
    return orders

_orders = gen_orders()

# ── Auth endpoints ─────────────────────────────────────────────

@app.post("/api/v1/auth/register")
async def register():
    return {"id": USER_ID, "email": "demo@tradingai.com", "full_name": "Demo User",
            "is_active": True, "is_verified": True, "totp_enabled": False,
            "subscription_tier": "pro", "created_at": ago(days=30)}

@app.post("/api/v1/auth/login")
async def login():
    return {"access_token": FAKE_JWT, "refresh_token": "mock-refresh-token",
            "token_type": "bearer", "requires_2fa": False}

@app.post("/api/v1/auth/refresh")
async def refresh():
    return {"access_token": FAKE_JWT, "refresh_token": "mock-refresh-token",
            "token_type": "bearer", "requires_2fa": False}

@app.post("/api/v1/auth/logout")
async def logout():
    return {"message": "Logged out"}

@app.get("/api/v1/auth/me")
async def me():
    return {"id": USER_ID, "email": "demo@tradingai.com", "full_name": "Demo Trader",
            "is_active": True, "is_verified": True, "totp_enabled": False,
            "subscription_tier": "pro", "created_at": ago(days=30)}

# ── Broker endpoints ───────────────────────────────────────────

@app.post("/api/v1/broker/connect")
async def connect_broker():
    return {
        "id": CONN_ID, "broker_name": "alpaca",
        "display_name": "Alpaca Paper (Mock)", "account_id": "PA3K2XY9MOCK",
        "is_active": True, "is_paper": True,
        "permissions": {"read": True, "trade": True},
        "last_sync_at": ago(minutes=5), "created_at": ago(days=7),
    }

@app.get("/api/v1/broker/connections")
async def list_connections():
    return [{
        "id": CONN_ID, "broker_name": "alpaca",
        "display_name": "Alpaca Paper (Mock)", "account_id": "PA3K2XY9MOCK",
        "is_active": True, "is_paper": True,
        "permissions": {"read": True, "trade": True},
        "last_sync_at": ago(minutes=5), "created_at": ago(days=7),
    }]

@app.get("/api/v1/broker/connections/{conn_id}/account")
async def account(conn_id: str):
    equity     = 103_847.22
    last_eq    = 101_200.00
    cash       = 38_412.50
    long_val   = equity - cash
    return {
        "id": "PA3K2XY9MOCK", "status": "ACTIVE", "currency": "USD",
        "cash": str(cash),
        "portfolio_value": str(equity),
        "buying_power": str(cash * 2),
        "equity": str(equity),
        "last_equity": str(last_eq),
        "long_market_value": str(long_val),
        "short_market_value": "0.00",
        "daytrade_count": 1,
        "pattern_day_trader": False,
        "trading_blocked": False,
        "transfers_blocked": False,
        "is_paper": True,
    }

@app.get("/api/v1/broker/connections/{conn_id}/positions")
async def positions(conn_id: str):
    result = []
    for sym in SYMBOLS:
        qty   = round(random.uniform(5, 40), 0)
        entry = BASE_PRICES[sym] * random.uniform(0.9, 0.98)
        cur   = BASE_PRICES[sym] * random.uniform(0.98, 1.08)
        pl    = (cur - entry) * qty
        result.append({
            "symbol": sym, "qty": str(qty),
            "avg_entry_price": str(round(entry, 2)),
            "current_price": str(round(cur, 2)),
            "market_value": str(round(cur * qty, 2)),
            "unrealized_pl": str(round(pl, 2)),
            "unrealized_plpc": str(round(pl / (entry * qty), 4)),
            "side": "long",
        })
    return result

@app.get("/api/v1/broker/connections/{conn_id}/orders")
async def broker_orders(conn_id: str):
    return _orders[:20]

@app.get("/api/v1/broker/connections/{conn_id}/bars/{symbol}")
async def bars(conn_id: str, symbol: str, timeframe: str = "1Hour", limit: int = 100):
    return cached_bars(symbol.upper(), timeframe, limit)

@app.get("/api/v1/broker/connections/{conn_id}/quote/{symbol}")
async def quote(conn_id: str, symbol: str):
    p = BASE_PRICES.get(symbol.upper(), 100.0) * random.uniform(0.999, 1.001)
    return {"symbol": symbol.upper(), "ask_price": round(p + 0.02, 2),
            "bid_price": round(p - 0.02, 2), "ask_size": 100.0,
            "bid_size": 100.0, "timestamp": now_iso()}

# ── Signal / watchlist endpoints ───────────────────────────────

@app.get("/api/v1/signals/watchlist")
async def watchlist():
    return [{"ticker": s, "name": None, "added_at": ago(days=random.randint(1,14))}
            for s in SYMBOLS]

@app.post("/api/v1/signals/watchlist")
async def add_watchlist():
    return {"message": "Added to watchlist"}

@app.delete("/api/v1/signals/watchlist/{ticker}")
async def del_watchlist(ticker: str):
    return {"message": f"{ticker} removed"}

@app.get("/api/v1/signals/")
async def signals(limit: int = 50):
    return _signals[:limit]

@app.post("/api/v1/signals/refresh/{ticker}")
async def refresh_signal(ticker: str):
    for s in _signals:
        if s["symbol"] == ticker.upper():
            return s
    return _signals[0]

# ── Automation endpoints ───────────────────────────────────────

@app.get("/api/v1/signals/automation")
async def automation_list():
    return [{
        "id": AUTO_ID, "broker_connection_id": CONN_ID,
        "is_enabled": True,
        "min_confidence": 0.62, "max_position_size_usd": 2000.0,
        "max_position_pct": 0.08, "stop_loss_pct": 0.02,
        "take_profit_pct": 0.04, "max_daily_loss_usd": 500.0,
        "max_open_positions": 5, "cooldown_minutes": 60,
        "created_at": ago(days=5),
    }]

@app.post("/api/v1/signals/automation")
async def create_automation(request: Request):
    body = await request.json()
    return {**body, "id": AUTO_ID, "created_at": now_iso()}

@app.patch("/api/v1/signals/automation/{config_id}")
async def update_automation(config_id: str, request: Request):
    body = await request.json()
    return {**body, "id": config_id, "created_at": ago(days=5)}

# ── Orders endpoints ───────────────────────────────────────────

@app.get("/api/v1/signals/orders")
async def signal_orders(limit: int = 100):
    return _orders[:limit]

@app.post("/api/v1/signals/emergency-stop")
async def emergency_stop():
    return {
        "message": "Emergency stop executed",
        "configs_disabled": 1,
        "orders_cancelled": 3,
    }

@app.get("/api/v1/signals/pdt-status")
async def pdt_status():
    return [{
        "connection_id": CONN_ID,
        "display_name": "Alpaca Paper",
        "equity": 18500.0,
        "day_trade_count": 2,
        "day_trade_limit": 3,
        "window_days": 5,
        "pdt_applies": True,
        "at_limit": False,
        "remaining": 1,
    }]

# ── Analysis / Decision Audit endpoints ───────────────────────

def _mock_guardrails(sig_type: str, order: Optional[dict]) -> list[dict]:
    if sig_type == "HOLD" or not order:
        return []
    rejected = order.get("rejection_reason") or ""
    return [
        {"name": "Confidence threshold", "passed": "Confidence" not in rejected,
         "detail": "68.4% confidence — above 62% threshold" if "Confidence" not in rejected else "Below threshold"},
        {"name": "Cooldown period",      "passed": "Cooldown"   not in rejected,
         "detail": "No recent orders for this ticker" if "Cooldown" not in rejected else "Too soon after last order"},
        {"name": "Daily loss limit",     "passed": "Daily loss" not in rejected,
         "detail": "Within $500 daily loss limit"},
        {"name": "Max open positions",   "passed": "Max open"   not in rejected,
         "detail": "3 of 5 positions used"},
        {"name": "Position size",        "passed": "Position"   not in rejected,
         "detail": "$1,840 position — within $2,000 limit"},
    ]

def _mock_steps(sig: dict, order: Optional[dict], guardrails: list[dict]) -> list[dict]:
    ind = sig["indicators"]
    steps = [
        {
            "step": "market_data",
            "status": "ok",
            "summary": f"Fetched candle data for {sig['timeframe']} timeframe",
            "detail": {"timeframe": sig["timeframe"], "model_version": "rule-v1"},
        },
        {
            "step": "indicators",
            "status": "ok",
            "summary": (f"RSI={ind['rsi']:.1f}  MACD={ind['macd_hist']:.4f}  "
                        f"BB%={ind['bb_pct']:.2f}  ADX={ind['adx']:.1f}  "
                        f"VolRatio={ind['volume_ratio']:.2f}"),
            "detail": ind,
        },
        {
            "step": "pattern",
            "status": "ok" if sig["pattern_detected"] else "warning",
            "summary": (f"Pattern detected: {sig['pattern_detected']}"
                        if sig["pattern_detected"] else "No candlestick pattern detected"),
            "detail": {"pattern": sig["pattern_detected"]},
        },
        {
            "step": "fusion",
            "status": "ok",
            "summary": (f"Trend={ind['trend_score']:.2f}  Momentum={ind['momentum_score']:.2f}  "
                        f"→ {sig['signal_type']} ({sig['confidence']*100:.1f}% confidence)"),
            "detail": {
                "signal_type": sig["signal_type"],
                "confidence": sig["confidence"],
                "trend_score": ind["trend_score"],
                "momentum_score": ind["momentum_score"],
                "entry_price": sig["entry_price"],
                "target_price": sig["target_price"],
                "stop_price": sig["stop_price"],
            },
        },
        {
            "step": "guardrails",
            "status": "ok" if all(g["passed"] for g in guardrails) else "blocked",
            "summary": f"{sum(g['passed'] for g in guardrails)}/{len(guardrails)} checks passed" if guardrails else "Not evaluated (HOLD signal)",
            "detail": {"checks": guardrails},
        },
    ]
    if order:
        steps.append({
            "step": "order",
            "status": "ok" if order["status"] in ("submitted", "filled") else "blocked",
            "summary": (
                f"{order['side'].upper()} {order['quantity']} {order['ticker']}"
                + (f" @ ${order['avg_fill_price']:.2f}" if order.get("avg_fill_price") else "")
                + f"  [{order['status'].upper()}]"
                + (f"  Reason: {order['rejection_reason']}" if order.get("rejection_reason") else "")
            ),
            "detail": {
                "side": order["side"],
                "quantity": order["quantity"],
                "status": order["status"],
                "fill_price": order.get("avg_fill_price"),
                "stop_price": order.get("stop_price"),
                "take_profit_price": order.get("take_profit_price"),
                "rejection_reason": order.get("rejection_reason"),
            },
        })
    return steps

def _build_decisions(limit=50, symbol=None):
    """Expand mock signals into full decision objects with steps."""
    decisions = []
    order_iter = iter(_orders)
    for sig in _signals:
        if symbol and sig["symbol"] != symbol.upper():
            continue
        # Grab next available order if signal is BUY/SELL
        order = None
        if sig["signal_type"] != "HOLD":
            try:
                order = next(o for o in _orders if o["ticker"] == sig["symbol"])
            except StopIteration:
                pass
        guardrails = _mock_guardrails(sig["signal_type"], order)
        steps = _mock_steps(sig, order, guardrails)
        decisions.append({
            "id": sig["id"],
            "symbol": sig["symbol"],
            "timeframe": sig["timeframe"],
            "created_at": sig["created_at"],
            "signal_type": sig["signal_type"],
            "confidence": sig["confidence"],
            "entry_price": sig["entry_price"],
            "target_price": sig["target_price"],
            "stop_price": sig["stop_price"],
            "pattern_detected": sig["pattern_detected"],
            "indicators": sig["indicators"],
            "reasoning": sig["reasoning"],
            "guardrails": guardrails,
            "guardrails_passed": all(g["passed"] for g in guardrails),
            "order_id": order["id"] if order else None,
            "order_status": order["status"] if order else None,
            "order_side": order["side"] if order else None,
            "order_qty": order["quantity"] if order else None,
            "order_fill_price": order.get("avg_fill_price") if order else None,
            "rejection_reason": order.get("rejection_reason") if order else None,
            "steps": steps,
        })
        if len(decisions) >= limit:
            break
    return decisions

@app.get("/api/v1/analysis/decisions")
async def analysis_decisions(limit: int = 50, symbol: Optional[str] = None):
    return _build_decisions(limit=limit, symbol=symbol)

@app.get("/api/v1/analysis/decisions/{decision_id}")
async def analysis_decision(decision_id: str):
    for d in _build_decisions(limit=200):
        if d["id"] == decision_id:
            return d
    return JSONResponse(status_code=404, content={"detail": "Not found"})

@app.get("/api/v1/analysis/stats")
async def analysis_stats():
    buy   = sum(1 for s in _signals if s["signal_type"] == "BUY")
    sell  = sum(1 for s in _signals if s["signal_type"] == "SELL")
    hold  = sum(1 for s in _signals if s["signal_type"] == "HOLD")
    filled   = sum(1 for o in _orders if o["status"] == "filled")
    rejected = sum(1 for o in _orders if o["status"] == "rejected")
    submitted = sum(1 for o in _orders if o["status"] == "submitted")
    return {
        "total_signals": len(_signals),
        "buy_signals": buy,
        "sell_signals": sell,
        "hold_signals": hold,
        "orders_placed": filled + submitted,
        "orders_filled": filled,
        "orders_rejected": rejected,
        "win_rate": 0.623,
        "avg_confidence": round(sum(s["confidence"] for s in _signals) / len(_signals), 4),
        "symbols_tracked": len(SYMBOLS),
    }

@app.get("/api/v1/analysis/performance")
async def analysis_performance(symbol: Optional[str] = None):
    points = []
    for o in _orders:
        if symbol and o["ticker"] != symbol.upper():
            continue
        pnl = None
        if o["status"] == "filled" and o.get("avg_fill_price") and o.get("stop_price"):
            if o["side"] == "buy":
                pnl = round((o["avg_fill_price"] - o["stop_price"]) / o["avg_fill_price"] * 100, 2)
            else:
                pnl = round((o["stop_price"] - o["avg_fill_price"]) / o["avg_fill_price"] * 100, 2)
        points.append({
            "date": o["created_at"],
            "symbol": o["ticker"],
            "signal_type": "BUY" if o["side"] == "buy" else "SELL",
            "confidence": 0.72,
            "entry_price": o.get("avg_fill_price"),
            "fill_price": o.get("avg_fill_price"),
            "pnl_pct": pnl,
            "status": o["status"],
        })
    return points

# ── Health ─────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "env": "mock"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
