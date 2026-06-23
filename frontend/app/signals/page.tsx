"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { signalApi } from "@/lib/api";
import { fmtUsd, fmtPct } from "@/lib/utils";
import SignalBadge from "@/components/SignalBadge";
import { RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { useState } from "react";

const TIER_META: Record<string, { title: string; sub: string; cls: string; dot: string }> = {
  green:        { title: "Top Picks",    sub: "Rank 1–10",  cls: "border-buy/40 bg-buy/5",     dot: "bg-buy" },
  light_green:  { title: "Strong Picks", sub: "Rank 11–20", cls: "border-buy/20 bg-buy/[0.02]", dot: "bg-buy/60" },
  light_yellow: { title: "Watch List",   sub: "Rank 21–30", cls: "border-hold/30 bg-hold/5",    dot: "bg-hold/70" },
};

function RankedTierPanel({ tier, rows }: { tier: string; rows: any[] }) {
  const meta = TIER_META[tier];
  return (
    <div className={`card ${meta.cls}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
        <h3 className="font-semibold text-sm">{meta.title}</h3>
        <span className="text-xs text-gray-500 ml-auto">{meta.sub}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 py-4 text-center">No signals in this band yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-800/50 last:border-0">
              <span className="font-mono font-bold w-14 shrink-0">{s.symbol}</span>
              {s.signal_type === "BUY"
                ? <TrendingUp size={12} className="text-buy shrink-0" />
                : <TrendingDown size={12} className="text-sell shrink-0" />}
              <span className="text-gray-500 w-10 shrink-0">{fmtPct(s.confidence)}</span>
              <span className="text-gray-400 ml-auto">
                <span className="text-gray-500">In </span>{s.entry_price ? fmtUsd(s.entry_price) : "—"}
              </span>
              <span className="text-buy">
                <span className="text-gray-500">Out </span>{s.target_price ? fmtUsd(s.target_price) : "—"}
              </span>
              <span className="text-sell">
                <span className="text-gray-500">Stop </span>{s.stop_price ? fmtUsd(s.stop_price) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SignalsPage() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const { data: ranked = [] } = useQuery({
    queryKey: ["signals", "top-ranked"],
    queryFn: () => signalApi.topRanked(),
    refetchInterval: 1_000,
  });
  const greenRows = ranked.filter((s: any) => s.tier === "green");
  const lightGreenRows = ranked.filter((s: any) => s.tier === "light_green");
  const lightYellowRows = ranked.filter((s: any) => s.tier === "light_yellow");

  const { data: signals = [], isFetching } = useQuery({
    queryKey: ["signals", "all"],
    queryFn: () => signalApi.list(100),
    refetchInterval: 60_000,
  });

  const refreshMut = useMutation({
    mutationFn: (ticker: string) => signalApi.refresh(ticker),
    onMutate: (ticker) => setRefreshing(ticker),
    onSettled: () => {
      setRefreshing(null);
      qc.invalidateQueries({ queryKey: ["signals"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Signals</h1>
        <span className="text-xs text-gray-400">{isFetching ? "Refreshing…" : "Auto-refresh 60s"}</span>
      </div>

      {/* Top 30 ranked opportunities — watchlist-wide, tiered by confidence rank, 1s refresh */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Top Opportunities</h2>
          <span className="text-xs text-gray-500">Live · refreshes every second</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <RankedTierPanel tier="green" rows={greenRows} />
          <RankedTierPanel tier="light_green" rows={lightGreenRows} />
          <RankedTierPanel tier="light_yellow" rows={lightYellowRows} />
        </div>
      </div>

      {signals.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400">No signals yet.</p>
          <p className="text-sm text-gray-500 mt-1">Add tickers to watchlist and wait for hourly cycle.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-800">
                <th className="pb-3">Symbol</th>
                <th className="pb-3">Signal</th>
                <th className="pb-3">Confidence</th>
                <th className="pb-3">Entry</th>
                <th className="pb-3">Target</th>
                <th className="pb-3">Stop</th>
                <th className="pb-3">Pattern</th>
                <th className="pb-3">RSI</th>
                <th className="pb-3">Timeframe</th>
                <th className="pb-3">Time</th>
                <th className="pb-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {signals.map((s: any) => (
                <tr key={s.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-3 font-mono font-bold">{s.symbol}</td>
                  <td className="py-3"><SignalBadge type={s.signal_type} /></td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-800 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${s.signal_type === "BUY" ? "bg-buy" : s.signal_type === "SELL" ? "bg-sell" : "bg-hold"}`}
                          style={{ width: fmtPct(s.confidence) }}
                        />
                      </div>
                      <span className="text-xs">{fmtPct(s.confidence)}</span>
                    </div>
                  </td>
                  <td className="py-3">{s.entry_price ? fmtUsd(s.entry_price) : "—"}</td>
                  <td className="py-3 text-buy">{s.target_price ? fmtUsd(s.target_price) : "—"}</td>
                  <td className="py-3 text-sell">{s.stop_price ? fmtUsd(s.stop_price) : "—"}</td>
                  <td className="py-3 text-gray-400 text-xs">{s.pattern_detected || "—"}</td>
                  <td className="py-3 text-xs">{s.indicators?.rsi?.toFixed(1) || "—"}</td>
                  <td className="py-3 text-xs text-gray-400">{s.timeframe}</td>
                  <td className="py-3 text-xs text-gray-400">
                    {new Date(s.created_at).toLocaleTimeString()}
                  </td>
                  <td className="py-3">
                    <button
                      onClick={() => refreshMut.mutate(s.symbol)}
                      disabled={refreshing === s.symbol}
                      className="text-gray-500 hover:text-brand transition-colors"
                    >
                      <RefreshCw size={13} className={refreshing === s.symbol ? "animate-spin" : ""} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reasoning drawer */}
      <div className="card">
        <h2 className="font-semibold mb-3">Signal Reasoning</h2>
        {signals.slice(0, 5).map((s: any) => (
          <div key={s.id} className="mb-3 pb-3 border-b border-gray-800 last:border-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono font-bold text-sm">{s.symbol}</span>
              <SignalBadge type={s.signal_type} />
            </div>
            <p className="text-xs text-gray-400 font-mono">{s.reasoning}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
