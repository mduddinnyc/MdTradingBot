"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { signalApi } from "@/lib/api";
import { fmtUsd, fmtPct } from "@/lib/utils";
import SignalBadge from "@/components/SignalBadge";
import { RefreshCw, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { useState } from "react";

export default function SignalsPage() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);

  const { data: signals = [], isFetching } = useQuery({
    queryKey: ["signals", "all"],
    queryFn: () => signalApi.list(100),
    refetchInterval: 60_000,
  });

  const displayedSignals = sortDir
    ? [...signals].sort((a: any, b: any) =>
        sortDir === "asc" ? a.confidence - b.confidence : b.confidence - a.confidence
      )
    : signals;

  const toggleConfidenceSort = () => setSortDir((d) => (d === "desc" ? "asc" : "desc"));

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
        <h1 className="text-2xl font-bold">Watchlist Signals</h1>
        <span className="text-xs text-gray-400">{isFetching ? "Refreshing…" : "Auto-refresh 60s"}</span>
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
                <th className="pb-3">
                  <button
                    onClick={toggleConfidenceSort}
                    className="flex items-center gap-1 hover:text-gray-200 transition-colors"
                  >
                    Confidence
                    {sortDir === "asc" ? <ArrowUp size={12} />
                      : sortDir === "desc" ? <ArrowDown size={12} />
                      : <ArrowUpDown size={12} className="text-gray-600" />}
                  </button>
                </th>
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
              {displayedSignals.map((s: any) => (
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
