"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { brokerApi, signalApi } from "@/lib/api";
import { Layers, TrendingUp, TrendingDown, Minus, Search, ChevronDown, ChevronRight } from "lucide-react";
import { fmtUsd, fmtPct } from "@/lib/utils";

type Leg = {
  type: "call" | "put";
  action: "buy" | "sell";
  delta_target: number;
  strike_hint: number;
  expiry_dte: number;
};

type StrategyRec = {
  strategy: string;
  rationale: string;
  legs: Leg[];
  max_profit_pct: number;
  break_even_hint: string;
  iv_rank: number | null;
  regime: string;
};

const STRATEGY_LABEL: Record<string, string> = {
  csp:              "Cash Secured Put",
  bull_put_spread:  "Bull Put Spread",
  bear_call_spread: "Bear Call Spread",
  iron_condor:      "Iron Condor",
  none:             "No Trade",
};

const REGIME_LABEL: Record<string, string> = {
  trending_bull: "Trending Bull",
  trending_bear: "Trending Bear",
  sideways:      "Sideways / Consolidation",
};

function LegRow({ leg }: { leg: Leg }) {
  const isBuy  = leg.action === "buy";
  const isCall = leg.type === "call";
  return (
    <div className="flex items-center gap-3 text-sm py-2 border-b border-gray-800 last:border-0">
      <span className={`px-2 py-0.5 rounded text-xs font-bold ${isBuy ? "bg-buy/10 text-buy" : "bg-sell/10 text-sell"}`}>
        {leg.action.toUpperCase()}
      </span>
      <span className="font-mono text-gray-200 uppercase">{leg.type}</span>
      <span className="text-gray-400">@ ~<span className="text-white font-mono">${leg.strike_hint.toFixed(2)}</span></span>
      <span className="text-gray-500">{leg.expiry_dte}d expiry</span>
      <span className="ml-auto text-gray-500">Δ {leg.delta_target.toFixed(2)}</span>
    </div>
  );
}

export default function OptionsPage() {
  const [symbol, setSymbol]       = useState("AAPL");
  const [signal, setSignal]       = useState("BUY");
  const [regime, setRegime]       = useState("trending_bull");
  const [ivRank, setIvRank]       = useState<string>("55");
  const [price, setPrice]         = useState<string>("150");
  const [rec, setRec]             = useState<StrategyRec | null>(null);
  const [chainOpen, setChainOpen] = useState(false);

  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const conn = connections[0];

  const { data: ivData } = useQuery({
    queryKey: ["iv-rank", symbol],
    queryFn: () => fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/analysis/iv-rank/${symbol}`, {
      headers: { Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("at") : ""}` },
    }).then(r => r.json()),
    enabled: !!symbol,
    staleTime: 60_000,
  });

  const { data: chain, isFetching: chainLoading } = useQuery({
    queryKey: ["options-chain", conn?.id, symbol],
    queryFn: () => brokerApi.options(conn.id, symbol),
    enabled: !!conn && chainOpen,
  });

  const stratMut = useMutation({
    mutationFn: () =>
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/signals/options-strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          signal_type: signal,
          regime,
          iv_rank: ivRank ? Number(ivRank) : null,
          current_price: Number(price),
        }),
      }).then(r => r.json()),
    onSuccess: (data) => setRec(data),
  });

  const ivDisplay = ivData?.iv_rank != null
    ? `${ivData.iv_rank.toFixed(1)} rank · ${ivData.iv_pct?.toFixed(1)} pct`
    : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand/20 flex items-center justify-center">
          <Layers size={18} className="text-brand" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Options Strategy</h1>
          <p className="text-sm text-gray-400">IV rank + regime → best options trade recommendation</p>
        </div>
      </div>

      {/* Input form */}
      <div className="card space-y-4">
        <h2 className="font-semibold">Strategy Parameters</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Symbol</label>
            <div className="flex gap-2">
              <input
                className="input flex-1 uppercase"
                value={symbol}
                onChange={e => setSymbol(e.target.value.toUpperCase())}
                placeholder="AAPL"
              />
            </div>
            {ivDisplay && <p className="text-xs text-brand mt-1">{ivDisplay}</p>}
          </div>
          <div>
            <label className="label">Current Price ($)</label>
            <input
              className="input"
              type="number"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="150.00"
            />
          </div>
          <div>
            <label className="label">IV Rank (0–100)</label>
            <input
              className="input"
              type="number"
              min="0"
              max="100"
              value={ivRank}
              onChange={e => setIvRank(e.target.value)}
              placeholder="55"
            />
            <p className="text-xs text-gray-500 mt-1">High IV rank (&gt;50) = rich premium</p>
          </div>
          <div>
            <label className="label">Signal Bias</label>
            <select className="input" value={signal} onChange={e => setSignal(e.target.value)}>
              <option value="BUY">Bullish (BUY)</option>
              <option value="SELL">Bearish (SELL)</option>
              <option value="HOLD">Neutral (HOLD)</option>
            </select>
          </div>
          <div>
            <label className="label">Market Regime</label>
            <select className="input" value={regime} onChange={e => setRegime(e.target.value)}>
              <option value="trending_bull">Trending Bull</option>
              <option value="trending_bear">Trending Bear</option>
              <option value="sideways">Sideways</option>
            </select>
          </div>
        </div>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={() => stratMut.mutate()}
          disabled={stratMut.isPending}
        >
          <Search size={14} />
          {stratMut.isPending ? "Analyzing…" : "Get Strategy Recommendation"}
        </button>
      </div>

      {/* Recommendation */}
      {rec && (
        <div className={`card space-y-4 ${rec.strategy === "none" ? "border-gray-700" : "border-brand/30 bg-brand/5"}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-lg text-brand">
                {STRATEGY_LABEL[rec.strategy] ?? rec.strategy}
              </h2>
              <p className="text-sm text-gray-400">{REGIME_LABEL[rec.regime] ?? rec.regime}</p>
            </div>
            {rec.iv_rank != null && (
              <div className="text-right">
                <div className="text-2xl font-bold text-white">{rec.iv_rank.toFixed(0)}</div>
                <div className="text-xs text-gray-400">IV Rank</div>
              </div>
            )}
          </div>

          <p className="text-sm text-gray-300">{rec.rationale}</p>

          {rec.legs.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Trade Legs</h3>
              {rec.legs.map((leg, i) => <LegRow key={i} leg={leg} />)}
            </div>
          )}

          {rec.legs.length > 0 && (
            <div className="flex gap-6 text-sm pt-2 border-t border-gray-800">
              <div>
                <span className="text-gray-400">Max profit: </span>
                <span className="text-buy font-semibold">{rec.max_profit_pct}% of capital at risk</span>
              </div>
              <div>
                <span className="text-gray-400">Break-even: </span>
                <span className="text-white font-mono">{rec.break_even_hint}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live options chain (requires broker connection) */}
      {conn && (
        <div className="card">
          <button
            className="w-full flex items-center justify-between"
            onClick={() => setChainOpen(v => !v)}
          >
            <h2 className="font-semibold">Live Options Chain — {symbol}</h2>
            {chainOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {chainOpen && (
            <div className="mt-4">
              {chainLoading ? (
                <p className="text-gray-400 text-sm">Loading chain from {conn.display_name}…</p>
              ) : chain ? (
                <pre className="text-xs text-gray-400 overflow-auto max-h-96 bg-gray-900 p-3 rounded-lg">
                  {JSON.stringify(chain, null, 2)}
                </pre>
              ) : (
                <p className="text-gray-500 text-sm">No chain data returned. Webull options API may require additional permissions.</p>
              )}
            </div>
          )}
        </div>
      )}

      {!conn && (
        <div className="card text-center py-8 text-gray-400 text-sm">
          Connect a broker account in Watchlist to load the live options chain.
        </div>
      )}
    </div>
  );
}
