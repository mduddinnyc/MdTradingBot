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
from app.models.automation import AutomationConfig
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

                for item, sym in items:
                    ticker = sym.ticker
                    signal = await signal_engine.generate_signal(db, ticker, timeframe)
                    if not signal:
                        continue

                    # Check if this user has automation enabled
                    result = await db.execute(
                        select(AutomationConfig).where(
                            AutomationConfig.user_id == conn.user_id,
                            AutomationConfig.broker_connection_id == conn.id,
                            AutomationConfig.is_enabled == True,
                        )
                    )
                    config = result.scalar_one_or_none()

                    if config and signal.signal_type in ("BUY", "SELL"):
                        await exec_svc.execute_signal(db, config, conn, signal, ticker)

            await db.commit()
            log.info("Signal cycle complete — timeframe=%s", timeframe)

        except Exception as exc:
            await db.rollback()
            log.error("Signal cycle failed: %s", exc, exc_info=True)


def start_scheduler() -> None:
    # 5-minute intraday signals (day trading)
    scheduler.add_job(
        run_signal_cycle,
        trigger="cron",
        minute="*/5",           # every 5 minutes during market hours
        hour="9-15",
        day_of_week="mon-fri",
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
        args=["1Day"],
        id="daily_signals",
        replace_existing=True,
        max_instances=1,
    )

    scheduler.start()
    log.info("Scheduler started — jobs: %s", [j.id for j in scheduler.get_jobs()])


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
