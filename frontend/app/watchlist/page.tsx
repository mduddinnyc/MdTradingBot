"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { brokerApi, signalApi } from "@/lib/api";
import { fmtUsd, fmtPct, cn } from "@/lib/utils";
import { X, Plus, Search, Link2 } from "lucide-react";
import CandleChart from "@/components/CandleChart";
import OrderTicket from "@/components/OrderTicket";
import OptionsOrderTicket from "@/components/OptionsOrderTicket";

const RANGES = [
  { key: "1H", timeframe: "1Min", limit: 60 },
  { key: "1D", timeframe: "5Min", limit: 78 },
  { key: "7D", timeframe: "1Hour", limit: 49 },
  { key: "30D", timeframe: "1Day", limit: 30 },
  { key: "12M", timeframe: "1Day", limit: 252 },
  { key: "5Y", timeframe: "1Day", limit: 1260 },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

export default function WatchlistPage() {
  const qc = useQueryClient();
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("1D");
  const [searchValue, setSearchValue] = useState("");
  const [orderSide, setOrderSide] = useState<"buy" | "sell" | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const { data: watchlist = [] } = useQuery({ queryKey: ["watchlist"], queryFn: signalApi.watchlist });
  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const conn = connections[0];

  const rangeCfg = RANGES.find((r) => r.key === range)!;
  const { data: bars = [] } = useQuery({
    queryKey: ["bars", conn?.id, selectedTicker, range],
    queryFn: () => brokerApi.bars(conn.id, selectedTicker!, rangeCfg.timeframe, rangeCfg.limit),
    enabled: !!conn && !!selectedTicker,
  });

  const { data: quote } = useQuery({
    queryKey: ["quote", conn?.id, selectedTicker],
    queryFn: () => brokerApi.quote(conn.id, selectedTicker!),
    enabled: !!conn && !!selectedTicker,
    refetchInterval: 10_000,
  });

  // Lightweight last/change per row so the list itself carries real info,
  // not just the selected ticker's detail panel.
  const rowQuotes = useQueries({
    queries: watchlist.map((w: any) => ({
      queryKey: ["quote", conn?.id, w.ticker],
      queryFn: () => brokerApi.quote(conn.id, w.ticker),
      enabled: !!conn,
      refetchInterval: 15_000,
    })),
  });

  const addMut = useMutation({
    mutationFn: (ticker: string) => signalApi.addToWatchlist(ticker),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const removeMut = useMutation({
    mutationFn: (ticker: string) => signalApi.removeFromWatchlist(ticker),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      setSelectedTicker((t) => (t && watchlist.find((w: any) => w.ticker === t) ? t : null));
    },
  });

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = searchValue.trim().toUpperCase();
    if (!ticker) return;
    addMut.mutate(ticker);
    setSearchValue("");
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Watchlist</h1>

      {!conn && (
        <div className="card flex items-center justify-between">
          <p className="text-sm text-gray-400">Connect a broker to see live prices and charts.</p>
          <Link href="/connections" className="btn-primary flex items-center gap-2 text-sm">
            <Link2 size={14} /> Connect Your Trading Apps
          </Link>
        </div>
      )}

      {/* Search / add ticker */}
      <div className="card">
        <h2 className="font-semibold mb-3">Add to Watchlist</h2>
        <form onSubmit={onSearchSubmit} className="flex gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input !pl-9 uppercase"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search ticker symbol… e.g. AAPL"
              maxLength={10}
            />
          </div>
          <button type="submit" className="btn-primary flex items-center gap-1" disabled={addMut.isPending}>
            <Plus size={14} /> Add
          </button>
        </form>
        {addMut.isError && <p className="text-sell text-sm mt-2">{(addMut.error as any)?.response?.data?.detail}</p>}
      </div>

      {/* Watchlist + chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h2 className="font-semibold mb-3">Symbols</h2>
          {watchlist.length === 0 ? (
            <p className="text-gray-400 text-sm">No symbols yet.</p>
          ) : (
            <ul className="space-y-1">
              {watchlist.map((w: any, i: number) => {
                const q = rowQuotes[i]?.data as any;
                const changeUp = q?.change != null && q.change >= 0;
                return (
                  <li
                    key={w.ticker}
                    className={cn(
                      "flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors",
                      selectedTicker === w.ticker ? "bg-brand/10 text-brand" : "hover:bg-gray-800"
                    )}
                    onClick={() => setSelectedTicker(w.ticker)}
                  >
                    <span className="font-mono font-bold text-sm">{w.ticker}</span>
                    <div className="flex items-center gap-3">
                      {q?.last != null && (
                        <span className="text-xs text-right">
                          <span className="text-gray-300">{fmtUsd(q.last)}</span>{" "}
                          <span className={changeUp ? "text-buy" : "text-sell"}>
                            {changeUp ? "+" : ""}{q.change?.toFixed(2)}
                          </span>
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeMut.mutate(w.ticker); }}
                        className="text-gray-500 hover:text-sell transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedTicker && conn && (
          <div className="card lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold font-mono">{selectedTicker}</h2>
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <button onClick={() => setOrderSide("buy")} className="px-3 py-1 rounded text-xs font-bold bg-buy text-white hover:bg-buy/80 transition-colors">
                    Buy
                  </button>
                  <button onClick={() => setOrderSide("sell")} className="px-3 py-1 rounded text-xs font-bold bg-sell text-white hover:bg-sell/80 transition-colors">
                    Sell
                  </button>
                  <button onClick={() => setOptionsOpen(true)} className="px-3 py-1 rounded text-xs font-bold bg-brand text-white hover:bg-brand/80 transition-colors">
                    Options
                  </button>
                </div>
                <div className="flex gap-1">
                  {RANGES.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setRange(r.key)}
                      className={cn(
                        "px-2 py-1 rounded text-xs font-medium transition-colors",
                        range === r.key ? "bg-brand text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      )}
                    >
                      {r.key}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {quote && (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-4 text-xs">
                <div>
                  <p className="text-gray-500">Last</p>
                  <p className="font-bold">{quote.last != null ? fmtUsd(quote.last) : "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Change</p>
                  <p className={cn("font-bold", (quote.change ?? 0) >= 0 ? "text-buy" : "text-sell")}>
                    {quote.change != null ? `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)}` : "—"}
                    {quote.change_percentage != null && ` (${fmtPct(quote.change_percentage / 100)})`}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Open</p>
                  <p>{quote.open != null ? fmtUsd(quote.open) : "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">High</p>
                  <p>{quote.high != null ? fmtUsd(quote.high) : "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Low</p>
                  <p>{quote.low != null ? fmtUsd(quote.low) : "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Prev Close</p>
                  <p>{quote.prevclose != null ? fmtUsd(quote.prevclose) : "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Volume</p>
                  <p>{quote.volume != null ? quote.volume.toLocaleString() : "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">52W Range</p>
                  <p>
                    {quote.week_52_low != null && quote.week_52_high != null
                      ? `${fmtUsd(quote.week_52_low)} – ${fmtUsd(quote.week_52_high)}`
                      : "—"}
                  </p>
                </div>
              </div>
            )}

            <CandleChart bars={bars} height={300} />
          </div>
        )}
      </div>

      {orderSide && selectedTicker && (
        <OrderTicket ticker={selectedTicker} defaultSide={orderSide} onClose={() => setOrderSide(null)} />
      )}
      {optionsOpen && selectedTicker && (
        <OptionsOrderTicket ticker={selectedTicker} onClose={() => setOptionsOpen(false)} />
      )}
    </div>
  );
}
