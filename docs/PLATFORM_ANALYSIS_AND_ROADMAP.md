# Trading Platform — Competitive Analysis & Improvement Roadmap

*Prepared 2026-06-24*

## 1. Executive summary

The platform has a genuinely solid engineering core: a typed multi-broker abstraction (5 brokers behind one `Protocol`), JWT auth with TOTP 2FA and refresh-token rotation, encrypted broker credentials, append-only audit logging, and a rule-based signal engine that fuses seven technical indicators, six candlestick patterns, and three-regime detection into a single confidence score. Equity automation is genuinely automatic, gated by real guardrails (confidence threshold, position sizing, stop-loss/take-profit, PDT compliance, daily loss cap, cooldown, emergency kill switch). Options automation is intentionally one step behind: paper-only, single-leg, and gated by a mandatory manual-approval step.

Against the commercial "AI copilot that auto-trades" category — represented here by Trade Ideas/Holly AI, Composer, 3Commas, and SaintQuant — the gap isn't code quality, it's product surface area: one hardcoded strategy instead of a strategy marketplace or no-code builder, no portfolio-level risk management, no live (real-money) options, no mobile app, and a near-absent automated test suite (4 auth-only pytest files, an empty Playwright scaffold, no CI pipeline). Note on "TradinAI": no distinct, identifiable product under that exact name turned up in research — per your direction this analysis treats it as shorthand for the broader AI auto-trading-copilot category rather than a single named competitor.

Section 5 lays out a phased roadmap. Section 6 specifies the two-agent system you asked for: a requirements agent that keeps a backlog current, and a validation agent that tests every build automatically and like a real user before it merges.

## 2. What we have today

### 2.1 Backend

| Layer | Tech | Notes |
|---|---|---|
| API framework | FastAPI 0.111, Uvicorn | 5 routers under `/api/v1`: auth, broker, signals, analysis, ws |
| Database | PostgreSQL, SQLAlchemy 2.0 (async), Alembic | 8 migrations tracked, schema mirrors model changes |
| Auth | python-jose (JWT HS256), bcrypt (12 rounds), pyotp (TOTP) | Refresh tokens SHA256-hashed + rotated, raw token never persisted |
| Secrets | cryptography (Fernet) | Broker API keys encrypted at rest; TOTP secret currently XOR-encoded, not Fernet — flagged below |
| Scheduling | APScheduler | Signal jobs every 5/15/60 min + daily during market hours; options scan every 15 min |
| Brokers | alpaca-py, ib_insync, vendored Webull SDK, Tradier REST, Tastytrade (scaffold) | One `BrokerAdapter` Protocol; Tradier has the most complete options chain support |

### 2.2 Frontend

Next.js 14 / React 18 / TypeScript, TanStack React Query, Zod, react-hook-form, axios, lightweight-charts for candles. 10 pages: dashboard, signals, day-trade scanner, options, automation, orders, watchlist, analysis, backtest, connections. Real-time updates over a single WebSocket (signal/order/account/ping messages, auto-reconnect). No mobile app.

### 2.3 Data model

Core tables: `users`, `user_sessions`, `audit_logs`, `broker_connections`, `symbols`/`candles`, `signals`, `watchlists`, `automation_configs`, `options_automation_configs`, `orders` (with options-specific columns: real OCC `option_symbol`, strike, expiration, right, premium). Schema evolution is tracked migration-by-migration (0001–0008), each mirroring a model change in the same commit per `CONTRIBUTING.md`.

### 2.4 Trading logic (the "brain")

`signal_engine.py` computes RSI(14), MACD(12/26/9), Bollinger %B(20,2σ), EMA trend, ADX(14), 20-bar volume ratio, and VWAP bias, then fuses them: `raw = 0.40·trend + 0.35·momentum + 0.25·pattern`, with BUY above +0.15, SELL below −0.15, else HOLD. Pattern detection covers Hammer/Shooting Star, Doji, Engulfing, and Double Top/Bottom. Regime detection (`trending_bull` / `trending_bear` / `sideways`) feeds a counter-trend block in execution. Entry/target/stop use real pivot-point and swing-cluster support/resistance when available.

### 2.5 Automation & guardrails

**Equity** — fully automatic once a signal clears: `min_confidence` (0.60 default), position sizing (% of equity capped by a $ amount), stop-loss/take-profit %, optional daily loss cap, cooldown, max open positions, PDT enforcement, regime-based counter-trend blocking, and a global emergency-stop endpoint that disables all configs and cancels open orders.

**Options** — paper-only, single-leg long calls/puts only. Every order is staged with a real OCC symbol and a computed cost, then held at `status="pending_approval"` until a human approves it (budget is re-checked at approval time since prices move). This manual gate is a deliberate safety choice, not an oversight.

### 2.6 Testing & CI

4 backend pytest files, all auth-focused (register, login, password policy, password reset). No tests for signal generation, broker integration, automation guardrails, or WebSocket flows. Playwright is installed and scripted in `package.json` (`npm run test:e2e`) but no spec files exist yet. No GitHub Actions or other CI pipeline — `CONTRIBUTING.md` requires `pytest tests/ -v`, `npm run test:e2e`, and `npx tsc --noEmit` to pass before merge, but nothing currently enforces this automatically.

## 3. The competitive landscape

A useful distinction surfaced in research: advisory **copilots** (e.g. Trade Copilot, Jenova/TradingView AI Chart Copilot) are explicitly read-only and never place trades. True auto-execution lives in **bot/autopilot platforms**, and an emerging "agentic brokerage" trend (e.g. Horizon.Trade, MetaTrader 5's generative-AI CoPilot for EA building) goes further — plain-English strategy in, live deployment out.

| Platform | What it actually automates | Notable detail |
|---|---|---|
| **Trade Ideas / Holly AI** | Holly re-optimizes 60+ pre-built strategies nightly and produces 5–25 daily signals with entry/stop/target; "Brokerage+" offers one-click execution to IBKR/TradeStation/E*TRADE with pre-set risk params (still a user click per trade, though a new "Money Machine" layer is rolling out toward fuller automation) | $84–228/mo tiers |
| **Composer** | Visual no-code "Symphony" logic-tree builder + natural-language AI builder; Trading Pass subscription enables fully automatic daily-close rebalancing across stocks/ETFs/crypto/options with no manual step; public API to create/fund/pause symphonies programmatically; sub-second backtests vs. S&P 500 | $20B+ processed volume, 3,000+ community symphonies, $32–40/mo for live automation |
| **3Commas** | Crypto-only DCA/Grid/Options bot templates, 20+ exchange integrations (Binance, Coinbase, Kraken, Bybit, OKX...), fully automatic 24/7 execution via Read+Trade (Withdraw-disabled) API keys, built-in backtesting, late-2025 AI Assistant for bot-setting tuning | Subscription tiers |
| **SaintQuant** | No-code, 10+ AI-driven bots (DCA/Grid/Swing) across 8 exchanges, fully hands-off from deposit to return | ~1.2% reported avg. daily ROI claim, $99/10-day starter plan, 150K+ users since 2021 |

## 4. Side-by-side comparison matrix

| Dimension | Our platform | Trade Ideas / Holly AI | Composer | 3Commas / SaintQuant |
|---|---|---|---|---|
| Architecture | Self-hosted FastAPI + Postgres + Next.js; open, typed multi-broker abstraction (5 brokers) | Proprietary desktop/cloud scanner; broker link limited to IBKR/TradeStation/E*TRADE | Vertically integrated — own brokerage, no third-party broker needed | Cloud SaaS connecting via exchange API keys (crypto-only) |
| Frontend / UX | Functional 10-page Next.js dashboard, no mobile | Dense pro scanner UI + mobile companion | Polished consumer web app + visual logic-tree builder | Consumer dashboard + mobile apps, no-code bot templates |
| API & extensibility | Internal REST + WS, single-tenant, not public | None public | Public REST API to manage symphonies programmatically | Public API + exchange API passthrough |
| Strategy engine | One hardcoded rule-based engine (indicators + patterns + regime, weighted score) | 60+ pre-built strategies, nightly re-tuned | No-code logic trees + AI builder + 3,000+ community strategies | Template bots (DCA/Grid/Swing), AI-assisted tuning, no custom logic |
| Automation depth | Equities fully automatic (guardrail-gated); options staged + manual approval, paper only | Semi-auto — one-click execute from a signal | Fully automatic with Trading Pass, no manual step | Fully automatic 24/7, no approval step |
| Risk management | Per-trade confidence/sizing/stop/take-profit, optional daily loss cap, PDT check, kill switch, fully audited | Win-rate/RR strategy filters, user-set sizing | Allocation/rebalancing rules; no explicit stop-loss concept | Risk knobs per bot template (safety orders, take-profit %) |
| Asset coverage | Equities (5 brokers) + options (paper, single-leg, full chain on 1 broker) | Equities, futures, some options | Stocks, ETFs, crypto, options | Crypto only |
| Backtesting | EMA9/21 crossover proxy on manually supplied bars — not the live signal engine | Nightly backtest across 60+ proprietary strategies | Sub-second backtest of the actual symphony vs. S&P 500 | Backtest from listing date for the actual bot |
| Testing / CI maturity | 4 auth-only pytest files, empty Playwright scaffold, no CI | Opaque (closed product) | Opaque (closed product) | Opaque (closed product) |
| Pricing | Self-hosted, no billing | $84–228/mo | Free to build/backtest, $32–40/mo for live automation | Subscription tiers / time-boxed managed contracts |

## 5. Gap analysis (prioritized)

**Critical**
- No portfolio-level risk management — daily loss cap is optional/nullable, no correlation or Greeks-based hedging, no account-wide circuit breaker beyond the manual emergency-stop.
- Near-zero automated test coverage outside auth, and no CI pipeline enforcing the checks `CONTRIBUTING.md` already requires.
- TOTP secret encryption uses XOR, not Fernet/AES-256-GCM — a real security gap given 2FA secrets are high-value.

**High**
- Single hardcoded strategy — no no-code builder, no pluggable strategy framework, no ML-assisted scoring.
- Options trading is paper-only and single-leg — cannot compete with platforms offering live multi-leg spreads.
- Backtesting doesn't exercise the actual signal engine (it's an EMA9/21 proxy), so backtest results don't validate production behavior.

**Medium**
- No mobile app or PWA.
- No structured logging, metrics, or error tracking (Sentry-class tooling absent).
- Notification system is a stub — no email/SMS/push/webhook alerts.
- OAuth login scaffolded but not wired; no API rate limiting.

## 6. Improvement roadmap

**Phase 1 — Foundation (0–6 weeks).** Stand up CI (`pytest`, `npm run test:e2e`, `tsc --noEmit` as required checks); upgrade TOTP secret encryption to Fernet; add structured logging + error tracking; add API rate limiting; expand pytest coverage to the signal engine, execution guardrails, and broker adapters.

**Phase 2 — Parity (6–14 weeks).** Build a portfolio-level risk engine (account-wide drawdown limits, correlation-aware sizing); extend options automation to live (real-money) multi-leg spreads behind the same manual-approval pattern already proven for single-leg; rebuild backtesting to run the actual `signal_engine` against historical candles with slippage/commission modeling; ship a real notification system (email/SMS/webhook).

**Phase 3 — Differentiation (14–26 weeks).** Pluggable strategy framework (start with a config-driven indicator-weight builder, grow toward a no-code logic-tree editor); ML-assisted signal scoring as an optional layer on top of the existing rule engine; mobile app or PWA; compliance/tax-reporting exports; multi-user/team features.

## 7. The requirements + validation agent loop

### 7.1 Why

`CONTRIBUTING.md` already defines the right bar — tests pass, `tsc --noEmit` is clean, migrations are verified, manual UI exercise happens — but nothing enforces it automatically, and there's no standing process for deciding *what* to build next. Two agents close both gaps without replacing the existing workflow; they wrap it.

### 7.2 Agent A — Requirements agent

- **Inputs:** this gap analysis, `audit_logs`/`analysis` stats (which guardrails block trades most often, which signals get manually overridden), periodic competitor research, the open backlog.
- **Output:** a prioritized backlog (`docs/BACKLOG.md` or issues) where each item has explicit Given/When/Then acceptance criteria and a roadmap-phase tag.
- **Cadence:** scheduled weekly run.

### 7.3 Agent B — Validation agent

Triggered per feature branch, before merge:

1. **Static** — lint, `tsc --noEmit`, Alembic migration check, `pytest` unit suite.
2. **Automated functional** — Playwright e2e suite (the currently-empty scaffold gets filled in) run against the Docker Compose stack.
3. **User-journey pass** — a scripted persona walks the live app the way a real user would: register → enable 2FA → connect a paper broker → add a watchlist symbol → trigger a signal → configure automation guardrails → verify a deliberately-bad config is rejected → trigger emergency-stop → confirm an audit-log entry exists for every step. This catches integration and UX breakage that narrow unit assertions miss.
4. **Acceptance check** — compare results against Agent A's criteria line by line.
5. **Report** — pass/fail with screenshots and log excerpts attached to the PR.
6. **On failure** — auto-file the gap back into Agent A's backlog with repro steps, closing the loop.

### 7.4 Where this plugs in

Concretely: add `.github/workflows/ci.yml` (currently absent) wiring steps 1–2 above as required checks. The two agents are scheduled/triggered jobs around that pipeline — they formalize and automate the review process `CONTRIBUTING.md` already describes, rather than replacing it.

## 8. Next steps

Start with Phase 1: it's the lowest-risk, highest-leverage work (CI + test coverage + the TOTP fix), and it's the prerequisite for the validation agent in Section 7.3 to mean anything. Everything in Phase 2 and 3 assumes that safety net exists first.

## Sources

- Trade Ideas / Holly AI: https://www.trade-ideas.com/ti-ai-virtual-trade-assistant/ , https://daytradingtoolkit.com/trading-tools-tutorials/trade-ideas-holly-ai-explained/
- Composer: https://www.composer.trade/ , https://api.composer.trade/docs/index.html , https://alpaca.markets/blog/how-composer-is-redefining-algorithmic-trading-with-their-no-code-platform/
- 3Commas: https://3commas.io/ai-trading-bot , https://help.3commas.io/en/articles/4430555-all-about-3commas-features-tools-history-and-benefits
- SaintQuant: https://www.saintquant.com/ , https://coinfomania.com/ai-crypto-trading-bots-reviewed-saintquant-pionex-and-3commas-comparing-automation-approaches-in-2026/
- Copilot vs. autopilot distinction: https://tradecopilot.app/ , https://www.jenova.ai/en/resources/ai-stock-trading-copilot
