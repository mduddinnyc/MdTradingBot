"use client";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { brokerApi, signalApi } from "@/lib/api";
import { fmtUsd, fmtPct, cn } from "@/lib/utils";
import { Layers, TrendingUp, Clock } from "lucide-react";

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
] as const;
type Period = (typeof PERIODS)[number]["key"];

// Duration options for how long a strategy runs before auto-disabling.
// null = forever (never expires).
const DURATION_OPTIONS = [
  { label: "Forever", value: null },
  { label: "Today only", value: "today" },
  { label: "1 Week", value: "1w" },
  { label: "1 Month", value: "1m" },
  { label: "6 Months", value: "6m" },
  { label: "1 Year", value: "1y" },
] as const;
type DurationValue = (typeof DURATION_OPTIONS)[number]["value"];

function computeExpiresAt(value: DurationValue): string | null {
  if (value === null) return null;
  const now = new Date();
  if (value === "today") {
    // End of today in UTC
    const end = new Date(now);
    end.setUTCHours(23, 59, 59, 999);
    return end.toISOString();
  }
  const daysMap: Record<string, number> = { "1w": 7, "1m": 30, "6m": 180, "1y": 365 };
  const days = daysMap[value];
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function durationValueFromExpiresAt(expiresAt: string | null): DurationValue {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return null; // expired — treat as no selection
  const days = diff / (1000 * 60 * 60 * 24);
  if (days <= 1) return "today";
  if (days <= 8) return "1w";
  if (days <= 35) return "1m";
  if (days <= 185) return "6m";
  return "1y";
}

function formatRemaining(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days === 1) return "Expires today";
  if (days < 8) return `${days}d left`;
  if (days < 35) return `${Math.ceil(days / 7)}w left`;
  if (days < 185) return `${Math.ceil(days / 30)}mo left`;
  return `${Math.ceil(days / 365)}y left`;
}

function StrategyCard({ strategy, connId }: { strategy: any; connId: string }) {
  const qc = useQueryClient();
  const [isEnabled, setIsEnabled] = useState(strategy.is_enabled);
  const [mode, setMode] = useState<"auto" | "manual">(strategy.mode);
  const [capital, setCapital] = useState(String(strategy.allocated_capital_usd));
  const [duration, setDuration] = useState<DurationValue>(
    durationValueFromExpiresAt(strategy.expires_at ?? null)
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setIsEnabled(strategy.is_enabled);
    setMode(strategy.mode);
    setCapital(String(strategy.allocated_capital_usd));
    setDuration(durationValueFromExpiresAt(strategy.expires_at ?? null));
  }, [strategy.is_enabled, strategy.mode, strategy.allocated_capital_usd, strategy.expires_at]);

  const isExpired = strategy.expires_at && new Date(strategy.expires_at).getTime() < Date.now();
  const remaining = formatRemaining(strategy.expires_at ?? null);

  const mut = useMutation({
    mutationFn: (overrides: Partial<{
      is_enabled: boolean;
      mode: "auto" | "manual";
      allocated_capital_usd: number;
      expires_at: string | null;
    }>) =>
      signalApi.updateStrategyConfig(strategy.id, {
        broker_connection_id: connId,
        is_enabled: isEnabled,
        mode,
        allocated_capital_usd: parseFloat(capital) || 0,
        expires_at: computeExpiresAt(duration),
        ...overrides,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const hasEnoughHistory = strategy.total_trades >= 3;

  return (
    <div className={cn(
      "rounded-lg border p-4 space-y-3 transition-colors",
      isExpired ? "border-gray-700 bg-gray-900/50 opacity-60"
        : isEnabled ? "border-brand/40 bg-brand/5"
        : "border-gray-800"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold flex items-center gap-2">
            {strategy.name}
            {isEnabled && !isExpired && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-brand/20 text-brand">ACTIVE</span>
            )}
            {isExpired && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-700 text-gray-400">EXPIRED</span>
            )}
            {remaining && !isExpired && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-hold/10 text-hold flex items-center gap-1">
                <Clock size={9} />{remaining}
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400 mt-0.5 max-w-md">{strategy.description}</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer shrink-0">
          <span className="text-xs text-gray-400">{isEnabled ? "Enabled" : "Disabled"}</span>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => {
              const next = e.target.checked;
              setIsEnabled(next);
              mut.mutate({ is_enabled: next });
            }}
            className="w-5 h-5 accent-brand"
          />
        </label>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <div>
          <span className="text-gray-500">Win rate: </span>
          {hasEnoughHistory ? (
            <span className={cn("font-bold", (strategy.win_rate ?? 0) >= 0.5 ? "text-buy" : "text-sell")}>
              {fmtPct(strategy.win_rate)} ({strategy.wins}/{strategy.total_trades})
            </span>
          ) : (
            <span className="text-gray-500">Not enough trades yet ({strategy.total_trades}/3)</span>
          )}
        </div>
        {strategy.total_pnl_usd != null && (
          <div>
            <span className="text-gray-500">All-time P&L: </span>
            <span className={cn("font-bold", strategy.total_pnl_usd >= 0 ? "text-buy" : "text-sell")}>
              {strategy.total_pnl_usd >= 0 ? "+" : ""}{fmtUsd(strategy.total_pnl_usd)}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
        {/* Execution mode */}
        <div>
          <label className="label">Mode</label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => { setMode("auto"); mut.mutate({ mode: "auto" }); }}
              className={cn(
                "py-1.5 rounded text-xs font-semibold transition-colors",
                mode === "auto" ? "bg-buy text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              )}
            >
              Autopilot
            </button>
            <button
              type="button"
              onClick={() => { setMode("manual"); mut.mutate({ mode: "manual" }); }}
              className={cn(
                "py-1.5 rounded text-xs font-semibold transition-colors",
                mode === "manual" ? "bg-hold text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              )}
            >
              Manual
            </button>
          </div>
        </div>

        {/* Capital */}
        <div>
          <label htmlFor={`capital-${strategy.id}`} className="label">Capital ($)</label>
          <input
            id={`capital-${strategy.id}`}
            className="input"
            type="number"
            min="1"
            step="100"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            onBlur={() => mut.mutate({})}
          />
        </div>

        {/* Duration */}
        <div>
          <label htmlFor={`duration-${strategy.id}`} className="label">Run for</label>
          <select
            id={`duration-${strategy.id}`}
            className="input"
            value={duration ?? ""}
            onChange={(e) => {
              const raw = e.target.value || null;
              const val = raw as DurationValue;
              setDuration(val);
              mut.mutate({ expires_at: computeExpiresAt(val) });
            }}
          >
            {DURATION_OPTIONS.map((opt) => (
              <option key={String(opt.value)} value={opt.value ?? ""}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Mode hint */}
        <p className="text-xs text-gray-500">
          {mode === "auto"
            ? "Places paper orders immediately. Manual mode always overrides — your approve/reject takes priority."
            : "Stages orders for your review on the Orders page. Manual always overrides autopilot."}
        </p>
      </div>

      {saved && <p className="text-buy text-xs">Saved.</p>}
    </div>
  );
}

function PerformanceComparison() {
  const [period, setPeriod] = useState<Period>("7d");
  const { data: perf = [] } = useQuery({
    queryKey: ["strategy-performance", period],
    queryFn: () => signalApi.strategyPerformance(period),
  });

  const withTrades = perf.filter((p: any) => p.trades > 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <TrendingUp size={15} className="text-brand" /> Strategy Performance
        </h3>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                period === p.key ? "bg-brand text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {withTrades.length === 0 ? (
        <p className="text-xs text-gray-500">No closed trades from any strategy in this period yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-left text-xs">
              <th className="pb-2">Strategy</th>
              <th className="pb-2">Trades</th>
              <th className="pb-2">Win Rate</th>
              <th className="pb-2">Total P&L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {withTrades.map((p: any) => (
              <tr key={p.strategy_id}>
                <td className="py-2 font-medium">{p.strategy_name}</td>
                <td className="py-2">{p.trades}</td>
                <td className="py-2">{p.win_rate != null ? fmtPct(p.win_rate) : "—"}</td>
                <td className={cn("py-2 font-semibold", (p.total_pnl_usd ?? 0) >= 0 ? "text-buy" : "text-sell")}>
                  {p.total_pnl_usd != null ? `${p.total_pnl_usd >= 0 ? "+" : ""}${fmtUsd(p.total_pnl_usd)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function StrategiesPanel() {
  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const connId = connections[0]?.id;
  const { data: strategies = [] } = useQuery({
    queryKey: ["strategies"],
    queryFn: signalApi.strategies,
    enabled: !!connId,
  });

  if (!connId) return null;

  return (
    <div className="card border-hold/20 space-y-4">
      <div>
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <Layers size={16} className="text-hold" /> Strategies
        </h2>
        <p className="text-xs text-gray-400">
          Each strategy runs a different weighting of the same indicators.
          Set the execution mode and how long it should run. <strong className="text-gray-300">Manual always overrides Autopilot</strong> — your approve/reject on the Orders page takes final priority.
        </p>
      </div>

      <div className="space-y-3">
        {strategies.map((s: any) => (
          <StrategyCard key={s.id} strategy={s} connId={connId} />
        ))}
      </div>

      <div className="pt-3 border-t border-gray-800">
        <PerformanceComparison />
      </div>
    </div>
  );
}
