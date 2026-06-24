"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { signalApi } from "@/lib/api";
import { fmtUsd, fmtPct } from "@/lib/utils";
import CandleChart from "@/components/CandleChart";
import OrderTicket from "@/components/OrderTicket";
import { Flame, TrendingUp, TrendingDown, X, Loader2 } from "lucide-react";

const TIER_META: Record<string, { title: string; sub: string; cls: string; dot: string }> = {
  green:        { title: "Top Picks",    sub: "Rank 1–20",  cls: "border-buy/40 bg-buy/5",      dot: "bg-buy" },
  light_green:  { title: "Strong Picks", sub: "Rank 21–40", cls: "border-buy/20 bg-buy/[0.02]", dot: "bg-buy/60" },
};

function OptionBadge({ type }: { type: string }) {
  const isCall = type === "CALL";
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
        isCall ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell"
      }`}
    >
      {type}
    </span>
  );
}

function TierPanel({ tier, rows, onSelect, selected }: { tier: string; rows: any[]; onSelect: (t: string) => void; selected: string | null }) {
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
        <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
          {rows.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s.symbol)}
              className={`w-full flex items-center gap-2 text-xs py-1.5 px-1.5 rounded border-b border-gray-800/50 last:border-0 transition-colors text-left ${
                selected === s.symbol ? "bg-brand/10" : "hover:bg-gray-800/40"
              }`}
            >
              <span className="font-mono font-bold w-14 shrink-0">{s.symbol}</span>
              <OptionBadge type={s.option_type} />
              {s.signal_type === "BUY"
                ? <TrendingUp size={12} className="text-buy shrink-0" />
                : <TrendingDown size={12} className="text-sell shrink-0" />}
              <span className="text-gray-500 w-9 shrink-0">{fmtPct(s.confidence)}</span>
              <span className="text-gray-400 ml-auto whitespace-nowrap">
                <span className="text-gray-500">In </span>{s.entry_price ? fmtUsd(s.entry_price) : "—"}
              </span>
              <span className="text-buy whitespace-nowrap">
                <span className="text-gray-500">Out </span>{s.target_price ? fmtUsd(s.target_price) : "—"}
              </span>
              <span className="text-sell whitespace-nowrap">
                <span className="text-gray-500">Stop </span>{s.stop_price ? fmtUsd(s.stop_price) : "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailPanel({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [orderSide, setOrderSide] = useState<"buy" | "sell" | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["signal-detail", ticker],
    queryFn: () => signalApi.detail(ticker),
  });

  return (
    <div className="card border-brand/30">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-lg font-mono">{ticker}</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
          <X size={18} />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading analysis…
        </div>
      )}

      {isError && <p className="text-sell text-sm py-8 text-center">Failed to load analysis for {ticker}.</p>}

      {data && (
        <div className="space-y-5">
          {data.bars?.length > 0 ? (
            <CandleChart bars={data.bars} height={300} />
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm bg-gray-900/40 rounded-lg">
              No chart data — connect a broker to pull real bars for {ticker}.
            </div>
          )}

          {data.signal && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOrderSide("buy")}
                className="flex-1 py-2 rounded-lg font-bold text-sm bg-buy text-white hover:bg-buy/80 transition-colors"
              >
                Buy
              </button>
              <button
                onClick={() => setOrderSide("sell")}
                className="flex-1 py-2 rounded-lg font-bold text-sm bg-sell text-white hover:bg-sell/80 transition-colors"
              >
                Sell
              </button>
            </div>
          )}

          {data.signal && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-800/40 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Signal</p>
                <p className={`font-bold ${data.signal.signal_type === "BUY" ? "text-buy" : "text-sell"}`}>
                  {data.signal.signal_type}
                </p>
              </div>
              <div className="bg-gray-800/40 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Confidence</p>
                <p className="font-bold">{fmtPct(data.signal.confidence)}</p>
              </div>
              <div className="bg-gray-800/40 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Entry → Exit</p>
                <p className="font-bold text-xs">
                  {fmtUsd(data.signal.entry_price)} → <span className="text-buy">{fmtUsd(data.signal.target_price)}</span>
                </p>
              </div>
              <div className="bg-gray-800/40 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Stop</p>
                <p className="font-bold text-sell">{fmtUsd(data.signal.stop_price)}</p>
              </div>
            </div>
          )}

          {data.signal?.indicators?.pivot && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Pivot Points</h3>
              <div className="grid grid-cols-7 gap-1 text-center">
                {(["s3", "s2", "s1", "pp", "r1", "r2", "r3"] as const).map((k) => (
                  <div
                    key={k}
                    className={`rounded-lg py-2 ${
                      k === "pp" ? "bg-brand/10 text-brand" : k.startsWith("s") ? "bg-sell/10 text-sell" : "bg-buy/10 text-buy"
                    }`}
                  >
                    <p className="text-[10px] uppercase opacity-70">{k}</p>
                    <p className="font-mono font-bold text-xs">{fmtUsd(data.signal.indicators.pivot[k])}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(data.signal?.indicators?.support_levels?.length > 0 || data.signal?.indicators?.resistance_levels?.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Support</h3>
                <div className="flex flex-wrap gap-1.5">
                  {(data.signal.indicators.support_levels || []).map((lvl: number) => (
                    <span key={lvl} className="px-2 py-1 rounded bg-sell/10 text-sell text-xs font-mono">{fmtUsd(lvl)}</span>
                  ))}
                  {!data.signal.indicators.support_levels?.length && <span className="text-xs text-gray-500">None nearby</span>}
                </div>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Resistance</h3>
                <div className="flex flex-wrap gap-1.5">
                  {(data.signal.indicators.resistance_levels || []).map((lvl: number) => (
                    <span key={lvl} className="px-2 py-1 rounded bg-buy/10 text-buy text-xs font-mono">{fmtUsd(lvl)}</span>
                  ))}
                  {!data.signal.indicators.resistance_levels?.length && <span className="text-xs text-gray-500">None nearby</span>}
                </div>
              </div>
            </div>
          )}

          {data.signal?.reasoning && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Reasoning</h3>
              <p className="text-xs text-gray-400 font-mono bg-gray-900 p-3 rounded-lg break-all">
                {data.signal.reasoning}
              </p>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Market Regime: <span className="text-brand">{data.regime}</span>
            </h3>
          </div>

          {data.strategy_recommendation && data.strategy_recommendation.strategy !== "none" && (
            <div className="border border-brand/20 rounded-lg p-3 bg-brand/5">
              <h3 className="text-sm font-semibold text-brand mb-1 capitalize">
                {data.strategy_recommendation.strategy.replace(/_/g, " ")}
              </h3>
              <p className="text-xs text-gray-300 mb-2">{data.strategy_recommendation.rationale}</p>
              {data.strategy_recommendation.legs?.map((leg: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1">
                  <span className={`px-1.5 py-0.5 rounded font-bold ${leg.action === "buy" ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell"}`}>
                    {leg.action.toUpperCase()}
                  </span>
                  <span className="font-mono uppercase">{leg.type}</span>
                  <span className="text-gray-400">@ ~${leg.strike_hint?.toFixed(2)}</span>
                  <span className="text-gray-500">{leg.expiry_dte}d</span>
                </div>
              ))}
            </div>
          )}

          {!data.has_broker_connection && (
            <p className="text-xs text-hold">Connect a broker in Watchlist to pull live bars and options chain.</p>
          )}
        </div>
      )}

      {orderSide && (
        <OrderTicket ticker={ticker} defaultSide={orderSide} onClose={() => setOrderSide(null)} />
      )}
    </div>
  );
}

export default function DayTradePage() {
  const [selected, setSelected] = useState<string | null>(null);

  const { data: ranked = [], isFetching } = useQuery({
    queryKey: ["signals", "day-trade", 20],
    queryFn: () => signalApi.topRanked(20, "daytrade"),
    refetchInterval: 1_000,
  });

  const greenRows = ranked.filter((s: any) => s.tier === "green");
  const lightGreenRows = ranked.filter((s: any) => s.tier === "light_green");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame size={22} className="text-hold" />
          <h1 className="text-2xl font-bold">Day Trade Signal</h1>
        </div>
        <span className="text-xs text-gray-400">{isFetching ? "Refreshing…" : "Live · refreshes every second"}</span>
      </div>

      <p className="text-sm text-gray-400">
        Top 20 per band, ranked by live confidence from the signal engine. CALL/PUT is the suggested
        directional play derived from the real BUY/SELL signal — click a ticker for the full chart,
        live options chain, and strategy recommendation.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TierPanel tier="green" rows={greenRows} onSelect={setSelected} selected={selected} />
        <TierPanel tier="light_green" rows={lightGreenRows} onSelect={setSelected} selected={selected} />
      </div>

      {selected && <DetailPanel ticker={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
