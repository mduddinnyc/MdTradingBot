"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { brokerApi } from "@/lib/api";
import { FlaskConical, TrendingUp, TrendingDown, BarChart2 } from "lucide-react";

type BacktestResult = {
  symbol: string;
  total_return_pct: number;
  annualised_return_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  win_rate_pct: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  trades: Array<{
    timestamp: string;
    side: string;
    entry_price: number;
    exit_price: number;
    qty: number;
    pnl: number;
    reason: string;
  }>;
  equity_curve: Array<{ t: string; equity: number }>;
};

function MetricCard({ label, value, color = "text-white", sub }: {
  label: string; value: string; color?: string; sub?: string;
}) {
  return (
    <div className="card">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function BacktestPage() {
  const [symbol, setSymbol]     = useState("AAPL");
  const [capital, setCapital]   = useState("10000");
  const [slPct, setSlPct]       = useState("2");
  const [tpPct, setTpPct]       = useState("4");
  const [posPct, setPosPct]     = useState("10");
  const [timeframe, setTf]      = useState("1Day");
  const [result, setResult]     = useState<BacktestResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const conn = connections[0];

  const runBacktest = async () => {
    if (!conn) { setError("Connect a broker account first."); return; }
    setLoading(true);
    setError("");
    setResult(null);

    try {
      // Fetch bars from broker
      const bars = await brokerApi.bars(conn.id, symbol, timeframe, 500);
      if (!bars.length) { setError("No bar data returned for this symbol."); return; }

      // Run backtest via API
      const token = localStorage.getItem("at") || "";
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/analysis/backtest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            symbol,
            bars,
            initial_capital: Number(capital),
            stop_loss_pct: Number(slPct) / 100,
            take_profit_pct: Number(tpPct) / 100,
            position_size_pct: Number(posPct) / 100,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        setError(err.detail || "Backtest failed");
        return;
      }
      setResult(await res.json());
    } catch (e: any) {
      setError(e.message || "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  const positive = (n: number) => n >= 0;

  // Simple SVG equity curve
  const EquityCurve = ({ data }: { data: BacktestResult["equity_curve"] }) => {
    if (data.length < 2) return null;
    const vals = data.map(d => d.equity);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const W = 800, H = 160;
    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - ((d.equity - min) / (max - min || 1)) * H;
      return `${x},${y}`;
    }).join(" ");

    const firstVal = vals[0];
    const lastVal  = vals[vals.length - 1];
    const color    = lastVal >= firstVal ? "#22c55e" : "#ef4444";

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
      </svg>
    );
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand/20 flex items-center justify-center">
          <FlaskConical size={18} className="text-brand" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Backtesting</h1>
          <p className="text-sm text-gray-400">Simulate the EMA9/21 crossover strategy on historical data</p>
        </div>
      </div>

      {/* Config */}
      <div className="card space-y-4">
        <h2 className="font-semibold">Parameters</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Symbol</label>
            <input className="input uppercase" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className="label">Timeframe</label>
            <select className="input" value={timeframe} onChange={e => setTf(e.target.value)}>
              <option value="1Hour">1 Hour</option>
              <option value="1Day">1 Day</option>
            </select>
          </div>
          <div>
            <label className="label">Starting Capital ($)</label>
            <input className="input" type="number" value={capital} onChange={e => setCapital(e.target.value)} />
          </div>
          <div>
            <label className="label">Stop Loss (%)</label>
            <input className="input" type="number" step="0.1" value={slPct} onChange={e => setSlPct(e.target.value)} />
          </div>
          <div>
            <label className="label">Take Profit (%)</label>
            <input className="input" type="number" step="0.1" value={tpPct} onChange={e => setTpPct(e.target.value)} />
          </div>
          <div>
            <label className="label">Position Size (% capital)</label>
            <input className="input" type="number" step="1" value={posPct} onChange={e => setPosPct(e.target.value)} />
          </div>
        </div>

        {!conn && (
          <p className="text-hold text-sm">Connect a broker account in Watchlist to load bar data.</p>
        )}
        {error && <p className="text-sell text-sm">{error}</p>}

        <button
          className="btn-primary flex items-center gap-2"
          onClick={runBacktest}
          disabled={loading || !conn}
        >
          <BarChart2 size={14} />
          {loading ? "Running…" : "Run Backtest"}
        </button>
      </div>

      {/* Results */}
      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="Total Return"
              value={`${positive(result.total_return_pct) ? "+" : ""}${result.total_return_pct.toFixed(2)}%`}
              color={positive(result.total_return_pct) ? "text-buy" : "text-sell"}
            />
            <MetricCard
              label="Annual Return"
              value={`${positive(result.annualised_return_pct) ? "+" : ""}${result.annualised_return_pct.toFixed(2)}%`}
              color={positive(result.annualised_return_pct) ? "text-buy" : "text-sell"}
            />
            <MetricCard
              label="Sharpe Ratio"
              value={result.sharpe_ratio.toFixed(2)}
              color={result.sharpe_ratio >= 1 ? "text-buy" : result.sharpe_ratio >= 0 ? "text-hold" : "text-sell"}
            />
            <MetricCard
              label="Max Drawdown"
              value={`-${result.max_drawdown_pct.toFixed(2)}%`}
              color="text-sell"
            />
            <MetricCard
              label="Win Rate"
              value={`${result.win_rate_pct.toFixed(1)}%`}
              color={result.win_rate_pct >= 50 ? "text-buy" : "text-sell"}
              sub={`${result.winning_trades}W / ${result.losing_trades}L`}
            />
            <MetricCard
              label="Total Trades"
              value={String(result.total_trades)}
            />
          </div>

          {/* Equity curve */}
          <div className="card">
            <h2 className="font-semibold mb-3">Equity Curve</h2>
            <EquityCurve data={result.equity_curve} />
          </div>

          {/* Trade log */}
          {result.trades.length > 0 && (
            <div className="card">
              <h2 className="font-semibold mb-3">Trade Log</h2>
              <div className="overflow-auto max-h-72">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 text-left border-b border-gray-800">
                      <th className="pb-2">Time</th>
                      <th className="pb-2">Side</th>
                      <th className="pb-2">Entry</th>
                      <th className="pb-2">Exit</th>
                      <th className="pb-2">P&L</th>
                      <th className="pb-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {result.trades.filter(t => t.side === "sell").map((t, i) => (
                      <tr key={i} className="hover:bg-gray-800/30">
                        <td className="py-1.5 text-gray-500">{String(t.timestamp).slice(0, 16)}</td>
                        <td className="py-1.5">
                          <span className={t.pnl >= 0 ? "text-buy" : "text-sell"}>
                            {t.pnl >= 0 ? <TrendingUp size={12} className="inline" /> : <TrendingDown size={12} className="inline" />}
                          </span>
                        </td>
                        <td className="py-1.5 font-mono">${t.entry_price.toFixed(2)}</td>
                        <td className="py-1.5 font-mono">${t.exit_price.toFixed(2)}</td>
                        <td className={`py-1.5 font-mono font-semibold ${t.pnl >= 0 ? "text-buy" : "text-sell"}`}>
                          {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                        </td>
                        <td className="py-1.5 text-gray-500">{t.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
