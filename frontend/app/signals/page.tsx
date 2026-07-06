"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { signalApi, brokerApi } from "@/lib/api";
import { fmtUsd, fmtPct, cn } from "@/lib/utils";
import SignalBadge from "@/components/SignalBadge";
import SortableTh, { SortState, toggleSort, sortRows } from "@/components/SortableTh";
import OrderTicket from "@/components/OrderTicket";
import OptionsOrderTicket from "@/components/OptionsOrderTicket";
import { RefreshCw, ArrowUpRight } from "lucide-react";
import { useState, useMemo } from "react";

type Tab = "Watchlist" | "Day Trade" | "Options";
type SignalFilter = "ALL" | "BUY" | "SELL" | "HOLD";
type SortKey =
  | "symbol" | "signal_type" | "option_type" | "confidence" | "entry_price"
  | "target_price" | "stop_price" | "rsi" | "timeframe" | "created_at";

function optionType(s: any): string {
  return s.signal_type === "BUY" ? "CALL" : s.signal_type === "SELL" ? "PUT" : "";
}

function getSortValue(s: any, key: SortKey) {
  switch (key) {
    case "option_type":  return optionType(s);
    case "rsi":          return s.indicators?.rsi ?? null;
    case "created_at":   return new Date(s.created_at).getTime();
    default:             return s[key];
  }
}

const TABS: Tab[] = ["Watchlist", "Day Trade", "Options"];
const FILTERS: SignalFilter[] = ["ALL", "BUY", "SELL", "HOLD"];

function ConfidenceBar({ value, type }: { value: number; type: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 bg-gray-800 rounded-full h-1">
        <div
          className={cn("h-1 rounded-full", {
            "bg-buy": type === "BUY",
            "bg-sell": type === "SELL",
            "bg-hold": type === "HOLD",
          })}
          style={{ width: fmtPct(value) }}
        />
      </div>
      <span className="text-xs font-mono text-gray-400">{fmtPct(value)}</span>
    </div>
  );
}

export default function SignalsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("Watchlist");
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("ALL");
  const [sort, setSort] = useState<SortState<SortKey>>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [orderTicker, setOrderTicker] = useState<string | null>(null);
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [optionsTicker, setOptionsTicker] = useState<string | null>(null);
  const [optionsSide, setOptionsSide] = useState<"buy" | "sell">("buy");

  // Watchlist & Options tab signals
  const { data: watchlistSignals = [], isFetching: wlFetching } = useQuery({
    queryKey: ["signals", "all"],
    queryFn: () => signalApi.list(150),
    refetchInterval: 60_000,
  });

  // Day Trade tab signals
  const { data: dayTradeData = {}, isFetching: dtFetching } = useQuery({
    queryKey: ["signals", "daytrade-ranked"],
    queryFn: () => signalApi.topRanked(40, "daytrade"),
    refetchInterval: 60_000,
    enabled: tab === "Day Trade",
  });

  const isFetching = tab === "Day Trade" ? dtFetching : wlFetching;

  const rawSignals = useMemo(() => {
    if (tab === "Day Trade") {
      const green = (dayTradeData as any).green ?? [];
      const lg = (dayTradeData as any).light_green ?? [];
      return [...green, ...lg];
    }
    return watchlistSignals as any[];
  }, [tab, watchlistSignals, dayTradeData]);

  const filteredSignals = useMemo(() => {
    if (signalFilter === "ALL") return rawSignals;
    return rawSignals.filter((s) => s.signal_type === signalFilter);
  }, [rawSignals, signalFilter]);

  const displayedSignals = sortRows(filteredSignals, sort, getSortValue);
  const onSort = (key: SortKey) => setSort((s) => toggleSort(s, key));

  const refreshMut = useMutation({
    mutationFn: (ticker: string) => signalApi.refresh(ticker),
    onMutate: (ticker) => setRefreshing(ticker),
    onSettled: () => {
      setRefreshing(null);
      qc.invalidateQueries({ queryKey: ["signals"] });
    },
  });

  const isOptions = tab === "Options";

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold tracking-tight">Signals</h1>
        <span className="text-xs text-gray-500">
          {isFetching ? "Refreshing…" : `${displayedSignals.length} signals · auto-refresh 60s`}
        </span>
      </div>

      {/* Tab bar */}
      <div className="tabs mb-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSort(null); }}
            className={cn("tab", tab === t && "tab-active")}
          >
            {t}
            {t === "Day Trade" && (
              <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-brand/10 text-brand font-bold align-middle">
                RANKED
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex rounded-lg bg-gray-800/60 p-0.5 gap-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setSignalFilter(f)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                signalFilter === f
                  ? f === "BUY"
                    ? "bg-buy text-gray-950 font-bold"
                    : f === "SELL"
                    ? "bg-sell text-white font-bold"
                    : f === "HOLD"
                    ? "bg-hold text-gray-950 font-bold"
                    : "bg-gray-700 text-gray-100"
                  : "text-gray-500 hover:text-gray-200"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-600">{displayedSignals.length} shown</span>
      </div>

      {/* Table */}
      {displayedSignals.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400 mb-1">No signals yet.</p>
          <p className="text-sm text-gray-600">
            {tab === "Watchlist" || tab === "Options"
              ? "Add tickers to your watchlist and wait for the next cycle."
              : "Day trade scan runs hourly during market hours."}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-800">
                <SortableTh label="Symbol"  sortKey="symbol"      sort={sort} onSort={onSort} className="pl-5 th" />
                <SortableTh label="Signal"  sortKey="signal_type" sort={sort} onSort={onSort} className="th" />
                {isOptions && (
                  <SortableTh label="Type"  sortKey="option_type" sort={sort} onSort={onSort} className="th" />
                )}
                <SortableTh label="Confidence" sortKey="confidence" sort={sort} onSort={onSort} className="th" />
                <SortableTh label="Entry"   sortKey="entry_price"  sort={sort} onSort={onSort} className="th" />
                <SortableTh label="Target"  sortKey="target_price" sort={sort} onSort={onSort} className="th" />
                <SortableTh label="Stop"    sortKey="stop_price"   sort={sort} onSort={onSort} className="th" />
                <SortableTh label="RSI"     sortKey="rsi"          sort={sort} onSort={onSort} className="th" />
                <SortableTh label="TF"      sortKey="timeframe"    sort={sort} onSort={onSort} className="th" />
                <SortableTh label="Time"    sortKey="created_at"   sort={sort} onSort={onSort} className="th" />
                <th className="th pr-5">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {displayedSignals.map((s: any) => {
                const optType = optionType(s);
                return (
                  <tr key={s.id} className="hover:bg-gray-800/20 transition-colors">
                    <td className="py-3 pl-5 font-mono font-bold text-gray-100">{s.symbol}</td>
                    <td className="py-3"><SignalBadge type={s.signal_type} /></td>
                    {isOptions && (
                      <td className="py-3">
                        {optType ? (
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-bold",
                            optType === "CALL" ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell"
                          )}>
                            {optType}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                    )}
                    <td className="py-3">
                      <ConfidenceBar value={s.confidence} type={s.signal_type} />
                    </td>
                    <td className="py-3 font-mono text-gray-300">{s.entry_price ? fmtUsd(s.entry_price) : "—"}</td>
                    <td className="py-3 font-mono text-buy">{s.target_price ? fmtUsd(s.target_price) : "—"}</td>
                    <td className="py-3 font-mono text-sell">{s.stop_price ? fmtUsd(s.stop_price) : "—"}</td>
                    <td className="py-3 text-xs font-mono text-gray-400">{s.indicators?.rsi?.toFixed(1) ?? "—"}</td>
                    <td className="py-3 text-xs font-mono text-gray-500">{s.timeframe}</td>
                    <td className="py-3 text-xs font-mono text-gray-500">
                      {new Date(s.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-3 pr-5">
                      <div className="flex items-center gap-1.5">
                        {isOptions ? (
                          <button
                            onClick={() => { setOptionsTicker(s.symbol); setOptionsSide("buy"); }}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
                          >
                            <ArrowUpRight size={11} />
                            Options
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => { setOrderTicker(s.symbol); setOrderSide("buy"); }}
                              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold bg-buy/10 text-buy hover:bg-buy/20 transition-colors"
                            >
                              B
                            </button>
                            <button
                              onClick={() => { setOrderTicker(s.symbol); setOrderSide("sell"); }}
                              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold bg-sell/10 text-sell hover:bg-sell/20 transition-colors"
                            >
                              S
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => refreshMut.mutate(s.symbol)}
                          disabled={refreshing === s.symbol}
                          className="text-gray-600 hover:text-gray-400 transition-colors"
                        >
                          <RefreshCw size={12} className={refreshing === s.symbol ? "animate-spin" : ""} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Signal reasoning — Watchlist only */}
      {tab === "Watchlist" && displayedSignals.length > 0 && (
        <div className="card mt-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-gray-400 mb-3">Signal Reasoning</h2>
          <div className="space-y-3">
            {displayedSignals.slice(0, 5).map((s: any) => (
              <div key={s.id} className="pb-3 border-b border-gray-800/50 last:border-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono font-bold text-sm">{s.symbol}</span>
                  <SignalBadge type={s.signal_type} />
                  <span className="text-xs font-mono text-gray-500">{fmtPct(s.confidence)} confidence</span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{s.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Order ticket modals */}
      {orderTicker && (
        <OrderTicket
          ticker={orderTicker}
          defaultSide={orderSide}
          onClose={() => setOrderTicker(null)}
        />
      )}
      {optionsTicker && (
        <OptionsOrderTicket
          ticker={optionsTicker}
          defaultSide={optionsSide}
          onClose={() => setOptionsTicker(null)}
        />
      )}
    </div>
  );
}
