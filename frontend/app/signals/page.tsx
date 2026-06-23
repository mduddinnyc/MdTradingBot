"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { signalApi } from "@/lib/api";
import { fmtUsd, fmtPct } from "@/lib/utils";
import SignalBadge from "@/components/SignalBadge";
import SortableTh, { SortState, toggleSort, sortRows } from "@/components/SortableTh";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

type SortKey =
  | "symbol" | "signal_type" | "option_type" | "confidence" | "entry_price"
  | "target_price" | "stop_price" | "pattern_detected" | "rsi" | "timeframe" | "created_at";

function optionType(s: any): string {
  return s.signal_type === "BUY" ? "CALL" : s.signal_type === "SELL" ? "PUT" : "";
}

function getSortValue(s: any, key: SortKey) {
  switch (key) {
    case "option_type": return optionType(s);
    case "rsi": return s.indicators?.rsi ?? null;
    case "created_at": return new Date(s.created_at).getTime();
    default: return s[key];
  }
}

export default function SignalsPage() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<SortKey>>(null);

  const { data: signals = [], isFetching } = useQuery({
    queryKey: ["signals", "all"],
    queryFn: () => signalApi.list(100),
    refetchInterval: 60_000,
  });

  const displayedSignals = sortRows(signals, sort, getSortValue);
  const onSort = (key: SortKey) => setSort((s) => toggleSort(s, key));

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
                <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} />
                <SortableTh label="Signal" sortKey="signal_type" sort={sort} onSort={onSort} />
                <SortableTh label="Call/Put" sortKey="option_type" sort={sort} onSort={onSort} />
                <SortableTh label="Confidence" sortKey="confidence" sort={sort} onSort={onSort} />
                <SortableTh label="Entry" sortKey="entry_price" sort={sort} onSort={onSort} />
                <SortableTh label="Target" sortKey="target_price" sort={sort} onSort={onSort} />
                <SortableTh label="Stop" sortKey="stop_price" sort={sort} onSort={onSort} />
                <SortableTh label="Pattern" sortKey="pattern_detected" sort={sort} onSort={onSort} />
                <SortableTh label="RSI" sortKey="rsi" sort={sort} onSort={onSort} />
                <SortableTh label="Timeframe" sortKey="timeframe" sort={sort} onSort={onSort} />
                <SortableTh label="Time" sortKey="created_at" sort={sort} onSort={onSort} />
                <th className="pb-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {displayedSignals.map((s: any) => (
                <tr key={s.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-3 font-mono font-bold">{s.symbol}</td>
                  <td className="py-3"><SignalBadge type={s.signal_type} /></td>
                  <td className="py-3">
                    {optionType(s) && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${optionType(s) === "CALL" ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell"}`}>
                        {optionType(s)}
                      </span>
                    )}
                    {!optionType(s) && <span className="text-gray-500">—</span>}
                  </td>
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
