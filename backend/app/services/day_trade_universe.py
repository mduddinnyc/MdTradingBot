"""
Fixed scan universe for the Day Trade Signal page — large/liquid names
spanning sectors, independent of any single user's personal watchlist.
A 10-symbol watchlist can never produce a real top-20; this list exists
so there's an actual pool to rank from. Confidence scores are whatever
the real rule-based signal engine computes — nothing here inflates them.
"""

DAY_TRADE_UNIVERSE: list[str] = [
    # Mega-cap tech
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "ORCL", "ADBE",
    # Semis
    "AMD", "INTC", "QCOM", "TXN", "AMAT", "MU", "ASML",
    # Growth / momentum favorites
    "NFLX", "CRM", "PYPL", "SHOP", "UBER", "ABNB", "COIN", "PLTR", "SOFI", "SNAP",
    "PINS", "ROKU", "SQ", "RBLX",
    # Financials
    "JPM", "BAC", "GS", "V", "MA",
    # Other large caps
    "DIS", "BA", "XOM", "CVX",
    # Index ETFs
    "SPY", "QQQ", "IWM", "DIA",
]
