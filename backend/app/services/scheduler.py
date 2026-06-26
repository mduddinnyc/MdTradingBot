"""
APScheduler job runner.
Runs every hour (and every day) to:
  1. Fetch new candles for all watchlisted symbols
  2. Generate signals for each symbol
  3. If user has automation enabled, execute trades
"""
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.automation import AutomationConfig, OptionsAutomationConfig, Strategy, UserStrategyConfig
from app.models.broker import BrokerConnection
from app.models.market import Symbol, Watchlist, WatchlistItem
from app.services import execution as exec_svc
from app.services import market_data as md_svc
from app.services import signal_engine

log = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")


async def run_signal_cycle(timeframe: str = "1Hour") -> None:
    """
    Main cycle:
    1. For each active broker connection, refresh candles for that user's watchlist.
    2. Generate signal for each symbol.
    3. If automation enabled, execute via execution engine.
    """
    log.info("Signal cycle starting — timeframe=%s", timeframe)

    async with AsyncSessionLocal() as db:
        try:
            # Get all active broker connections
            result = await db.execute(
                select(BrokerConnection).where(BrokerConnection.is_active == True)
            )
            connections = result.scalars().all()

            processed_symbols: set[str] = set()

            for conn in connections:
                # Refresh market data for this user's watchlist
                counts = await md_svc.refresh_all_watchlisted_symbols(db, conn, timeframe)
                log.info("Refreshed bars for user %s: %s", conn.user_id, counts)

                # Generate signals for each symbol
                result = await db.execute(
                    select(Watchlist).where(
                        Watchlist.user_id == conn.user_id,
                        Watchlist.is_default == True,
                    )
                )
                wl = result.scalar_one_or_none()
                if not wl:
                    continue

                result = await db.execute(
                    select(WatchlistItem, Symbol)
                    .join(Symbol, WatchlistItem.symbol_id == Symbol.id)
                    .where(WatchlistItem.watchlist_id == wl.id)
                )
                items = result.all()

                # Automation (account-wide safety rail) must be on before
                # anything below fires — strategies only refine what
                # happens within that gate, they never bypass it.
                result = await db.execute(
                    select(AutomationConfig).where(
                        AutomationConfig.user_id == conn.user_id,
                        AutomationConfig.broker_connection_id == conn.id,
                        AutomationConfig.is_enabled == True,
                    )
                )
                config = result.scalar_one_or_none()
                if not config:
                    continue

                result = await db.execute(
                    select(UserStrategyConfig, Strategy)
                    .join(Strategy, UserStrategyConfig.strategy_id == Strategy.id)
                    .where(
                        UserStrategyConfig.user_id == conn.user_id,
                        UserStrategyConfig.broker_connection_id == conn.id,
                        UserStrategyConfig.is_enabled == True,
                    )
                )
                enabled_strategies = result.all()

                for item, sym in items:
                    ticker = sym.ticker

                    if enabled_strategies:
                        for usc, strat in enabled_strategies:
                            signal = await signal_engine.generate_signal(db, ticker, timeframe, strategy=strat)
                            if signal and signal.signal_type in ("BUY", "SELL"):
                                await exec_svc.execute_signal(db, config, conn, signal, ticker, strategy_config=usc)
                    else:
                        # No strategies configured yet — today's exact
                        # legacy behavior, unchanged.
                        signal = await signal_engine.generate_signal(db, ticker, timeframe)
                        if signal and signal.signal_type in ("BUY", "SELL"):
                            await exec_svc.execute_signal(db, config, conn, signal, ticker)

            await db.commit()
            log.info("Signal cycle complete — timeframe=%s", timeframe)

        except Exception as exc:
            await db.rollback()
            log.error("Signal cycle failed: %s", exc, exc_info=True)


async def run_day_trade_universe_cycle(timeframe: str = "1Day") -> None:
    """
    Refreshes bars + signals for the fixed DAY_TRADE_UNIVERSE list (~40
    liquid large-caps), independent of any one user's watchlist. Market
    data/signals aren't user-scoped in this schema, so any single active
    broker connection is enough to fetch real bars for the whole list —
    powers the Day Trade Signal page's broader scan pool.
    """
    from app.services.day_trade_universe import DAY_TRADE_UNIVERSE

    log.info("Day-trade universe cycle starting — %d symbols", len(DAY_TRADE_UNIVERSE))

    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(
                select(BrokerConnection).where(BrokerConnection.is_active == True).limit(1)
            )
            conn = result.scalar_one_or_none()
            if not conn:
                log.info("Day-trade universe cycle skipped — no active broker connection")
                return

            for ticker in DAY_TRADE_UNIVERSE:
                try:
                    await md_svc.fetch_and_store_bars(db, conn, ticker, timeframe)
                    await signal_engine.generate_signal(db, ticker, timeframe)
                except Exception as exc:
                    log.warning("Day-trade universe: %s failed: %s", ticker, exc)

            await db.commit()
            log.info("Day-trade universe cycle complete")
        except Exception as exc:
            await db.rollback()
            log.error("Day-trade universe cycle failed: %s", exc, exc_info=True)


async def run_options_automation_scan() -> None:
    """
    For each user with options automation enabled: finds the best eligible
    candidate and stages it (status="pending_approval"). Never places a real
    order itself — that only happens when a human approves it via
    POST /signals/options-automation/{id}/approve. Run this after
    run_day_trade_universe_cycle in the schedule so fresh signals exist to
    rank.
    """
    from app.services import options_execution as opt_exec

    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(
                select(OptionsAutomationConfig).where(OptionsAutomationConfig.is_enabled == True)
            )
            configs = result.scalars().all()
            if not configs:
                return

            log.info("Options automation scan starting — %d enabled config(s)", len(configs))
            for config in configs:
                result = await db.execute(
                    select(BrokerConnection).where(BrokerConnection.id == config.broker_connection_id)
                )
                conn = result.scalar_one_or_none()
                if not conn or not conn.is_active:
                    continue

                candidate = await opt_exec.find_eligible_candidate(db, config)
                if not candidate:
                    continue
                sig, sym = candidate
                await opt_exec.stage_option_trade(db, config, conn, sig, sym)

            await db.commit()
            log.info("Options automation scan complete")
        except Exception as exc:
            await db.rollback()
            log.error("Options automation scan failed: %s", exc, exc_info=True)


def start_scheduler() -> None:
    # 5-minute intraday signals (day trading) — 9am-3:59pm ET covers the
    # 9:30-16:00 ET session with margin on both ends. Must pin timezone
    # explicitly: the scheduler itself runs in UTC, so without this the
    # "9-15" hours fire at 5am-11:59am ET instead — missing the entire
    # afternoon of the trading day.
    scheduler.add_job(
        run_signal_cycle,
        trigger="cron",
        minute="*/5",
        hour="9-15",
        day_of_week="mon-fri",
        timezone="America/New_York",
        args=["5Min"],
        id="5min_signals",
        replace_existing=True,
        max_instances=1,
    )

    # 15-minute intraday signals
    scheduler.add_job(
        run_signal_cycle,
        trigger="cron",
        minute="*/15",
        hour="9-15",
        day_of_week="mon-fri",
        timezone="America/New_York",
        args=["15Min"],
        id="15min_signals",
        replace_existing=True,
        max_instances=1,
    )

    # Hourly candle + signal run
    scheduler.add_job(
        run_signal_cycle,
        trigger="cron",
        minute=5,               # 5 min past each hour to let candle fully close
        args=["1Hour"],
        id="hourly_signals",
        replace_existing=True,
        max_instances=1,
    )

    # Daily candle + signal run
    scheduler.add_job(
        run_signal_cycle,
        trigger="cron",
        hour=16,
        minute=15,              # 15 min after US market close (4pm ET)
        timezone="America/New_York",
        args=["1Day"],
        id="daily_signals",
        replace_existing=True,
        max_instances=1,
    )

    # Day Trade Signal page's broader fixed-universe scan
    scheduler.add_job(
        run_day_trade_universe_cycle,
        trigger="cron",
        minute="*/15",
        hour="9-15",
        day_of_week="mon-fri",
        timezone="America/New_York",
        args=["1Day"],
        id="day_trade_universe_15min",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.add_job(
        run_day_trade_universe_cycle,
        trigger="cron",
        hour=16,
        minute=20,
        timezone="America/New_York",
        args=["1Day"],
        id="day_trade_universe_daily",
        replace_existing=True,
        max_instances=1,
    )

    # Stages (never auto-places) paper options trades — 5 min after each
    # universe refresh above, so it has fresh signals to rank.
    scheduler.add_job(
        run_options_automation_scan,
        trigger="cron",
        minute="5,20,35,50",
        hour="9-15",
        day_of_week="mon-fri",
        timezone="America/New_York",
        id="options_automation_scan",
        replace_existing=True,
        max_instances=1,
    )

    scheduler.start()
    log.info("Scheduler started — jobs: %s", [j.id for j in scheduler.get_jobs()])


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
