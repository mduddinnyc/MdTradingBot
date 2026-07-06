"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { signalApi, brokerApi } from "@/lib/api";
import { cn, fmtUsd } from "@/lib/utils";
import OrderTicket from "@/components/OrderTicket";
import OptionsOrderTicket from "@/components/OptionsOrderTicket";
import AutomationDiagnosticPanel from "@/components/AutomationDiagnosticPanel";
import StrategiesPanel from "@/components/StrategiesPanel";
import OptionsAutomationPanel from "@/components/OptionsAutomationPanel";
import RiskProfileWizard from "@/components/RiskProfileWizard";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import {
  ArrowUpRight, Bot, Users, Check, X as XIcon,
  Shield, AlertTriangle, OctagonX, Settings2, Zap,
  Sliders, ChevronDown, ChevronUp,
} from "lucide-react";
import Link from "next/link";

type ExecMode = "manual" | "automated";

// ── Pending equity approvals component ─────────────────────
function PendingApprovals({ orders, onApprove, onReject, busyId }: {
  orders: any[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busyId: string | null;
}) {
  if (orders.length === 0) return null;
  return (
    <div className="card border-hold/30">
      <div className="flex items-center gap-2 mb-3">
        <span className="dot-warn" />
        <h3 className="font-semibold text-sm">Pending Approvals ({orders.length})</h3>
      </div>
      <div className="space-y-2">
        {orders.map((o) => (
          <div key={o.id} className="flex items-center gap-3 py-2 border-b border-gray-800/50 last:border-0">
            <span className={cn(
              "text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0",
              o.side === "buy" ? "bg-buy/10 text-buy" : "bg-sell/10 text-sell"
            )}>
              {o.side?.toUpperCase()}
            </span>
            <span className="font-mono font-bold text-sm">{o.ticker}</span>
            <span className="text-xs text-gray-500 font-mono">{parseFloat(o.quantity || 0).toFixed(0)} sh</span>
            {o.avg_fill_price && (
              <span className="text-xs font-mono text-gray-400">@ {fmtUsd(o.avg_fill_price)}</span>
            )}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <button
                disabled={busyId === o.id}
                onClick={() => onApprove(o.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-buy/10 text-buy hover:bg-buy/20 transition-colors disabled:opacity-50"
              >
                <Check size={11} />
                Approve
              </button>
              <button
                disabled={busyId === o.id}
                onClick={() => onReject(o.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-sell/10 text-sell hover:bg-sell/20 transition-colors disabled:opacity-50"
              >
                <XIcon size={11} />
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Custom Strategy Builder ─────────────────────────────────
function CustomStrategyBuilder() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    trendWeight: 33,
    momentumWeight: 33,
    patternWeight: 34,
    minConfidence: 40,
    timeframe: "1Hour",
    positionSize: 1000,
    stopLossPct: 5,
    takeProfitPct: 10,
    maxPositions: 3,
    regimeGate: "any",
  });
  const [saved, setSaved] = useState(false);

  function save() {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const totalWeight = form.trendWeight + form.momentumWeight + form.patternWeight;

  return (
    <div className="card">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-300 hover:text-white"
      >
        <div className="flex items-center gap-2">
          <Sliders size={15} className="text-brand" />
          Custom Strategy Builder
        </div>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {open && (
        <div className="mt-4 space-y-5">
          <p className="text-xs text-gray-500">Design your own signal strategy. The engine scores each ticker using weighted combinations of trend, momentum, and pattern indicators.</p>

          {/* Name */}
          <div>
            <label className="label">Strategy Name</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="My Strategy" />
          </div>

          {/* Indicator weights */}
          <div>
            <label className="label">
              Indicator Weights{" "}
              <span className={cn("ml-1 text-xs", totalWeight === 100 ? "text-buy" : "text-sell")}>
                (total: {totalWeight}% — must equal 100)
              </span>
            </label>
            <div className="grid grid-cols-3 gap-3 mt-2">
              {(
                [
                  { key: "trendWeight" as const, label: "Trend (EMA/VWAP)" },
                  { key: "momentumWeight" as const, label: "Momentum (RSI/BB)" },
                  { key: "patternWeight" as const, label: "Pattern (Candles)" },
                ] as { key: keyof typeof form; label: string }[]
              ).map(({ key, label }) => (
                <div key={key}>
                  <label className="text-[11px] text-gray-500 block mb-1">{label}</label>
                  <input
                    type="number" min={0} max={100}
                    className="input text-center font-mono"
                    value={form[key] as number}
                    onChange={e => setForm(f => ({...f, [key]: Number(e.target.value)}))}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Parameters grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Min Confidence (%)</label>
              <input type="number" min={5} max={95} className="input font-mono" value={form.minConfidence}
                onChange={e => setForm(f => ({...f, minConfidence: Number(e.target.value)}))} />
            </div>
            <div>
              <label className="label">Timeframe</label>
              <select className="input" value={form.timeframe} onChange={e => setForm(f => ({...f, timeframe: e.target.value}))}>
                <option value="5Min">5 Minutes</option>
                <option value="15Min">15 Minutes</option>
                <option value="1Hour">1 Hour</option>
                <option value="Daily">Daily</option>
              </select>
            </div>
            <div>
              <label className="label">Capital per Trade ($)</label>
              <input type="number" min={100} className="input font-mono" value={form.positionSize}
                onChange={e => setForm(f => ({...f, positionSize: Number(e.target.value)}))} />
            </div>
            <div>
              <label className="label">Max Open Positions</label>
              <input type="number" min={1} max={20} className="input font-mono" value={form.maxPositions}
                onChange={e => setForm(f => ({...f, maxPositions: Number(e.target.value)}))} />
            </div>
            <div>
              <label className="label">Stop Loss (%)</label>
              <input type="number" min={1} max={50} className="input font-mono" value={form.stopLossPct}
                onChange={e => setForm(f => ({...f, stopLossPct: Number(e.target.value)}))} />
            </div>
            <div>
              <label className="label">Take Profit (%)</label>
              <input type="number" min={1} max={100} className="input font-mono" value={form.takeProfitPct}
                onChange={e => setForm(f => ({...f, takeProfitPct: Number(e.target.value)}))} />
            </div>
          </div>

          {/* Market regime gate */}
          <div>
            <label className="label">Market Regime Gate</label>
            <select className="input" value={form.regimeGate} onChange={e => setForm(f => ({...f, regimeGate: e.target.value}))}>
              <option value="any">Trade in any regime</option>
              <option value="trending_only">Trending markets only (bull/bear)</option>
              <option value="sideways_only">Sideways markets only</option>
              <option value="bull_only">Bull market only</option>
            </select>
          </div>

          <button
            onClick={save}
            disabled={!form.name || totalWeight !== 100}
            className={cn("btn-primary w-full", saved && "bg-buy/80")}
          >
            {saved ? "✓ Strategy Saved" : "Save Custom Strategy"}
          </button>

          {(!form.name || totalWeight !== 100) && (
            <p className="text-xs text-gray-600 text-center">Enter a name and ensure weights sum to 100% to save.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Automation config form ──────────────────────────────────
const autoSchema = z.object({
  broker_connection_id: z.string().uuid(),
  is_enabled: z.boolean(),
  min_confidence: z.number().min(0.1).max(1),
  max_position_size_usd: z.number().min(1).optional().nullable(),
  max_position_pct: z.number().min(0.01).max(1),
  stop_loss_pct: z.number().min(0.001).max(0.5),
  take_profit_pct: z.number().min(0.001).max(1),
  max_daily_loss_usd: z.number().min(1).optional().nullable(),
  max_open_positions: z.number().int().min(1).max(20),
  cooldown_minutes: z.number().int().min(1),
});
type AutoForm = z.infer<typeof autoSchema>;

function AutomationPanel() {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [stopResult, setStopResult] = useState<{ configs_disabled: number; orders_cancelled: number } | null>(null);
  const [mode, setMode] = useState<"wizard" | "custom" | null>(null);
  const [wizardDone, setWizardDone] = useState(false);

  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const { data: configs = [] } = useQuery({ queryKey: ["automation"], queryFn: signalApi.automationList });
  const { data: pdtStatuses = [] } = useQuery({ queryKey: ["pdt-status"], queryFn: signalApi.pdtStatus, refetchInterval: 60_000 });
  const { data: autoStatus } = useQuery({ queryKey: ["automation-status"], queryFn: signalApi.automationStatus, retry: false, staleTime: 30_000 });

  const existing = (configs as any[])[0];
  const connId: string | undefined = existing?.broker_connection_id || (connections as any[])[0]?.id;
  const equity = (pdtStatuses as any[]).find((s: any) => s.connection_id === connId)?.equity;

  useEffect(() => {
    if (mode === null && (connections as any[]).length) setMode(existing ? "custom" : "wizard");
  }, [existing?.id, (connections as any[]).length]);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<AutoForm>({
    resolver: zodResolver(autoSchema),
  });

  useEffect(() => {
    if (!(connections as any[]).length) return;
    if (existing) {
      reset({
        ...existing,
        broker_connection_id: existing.broker_connection_id,
        min_confidence: Math.round(existing.min_confidence * 100),
        max_position_pct: Math.round(existing.max_position_pct * 100),
        stop_loss_pct: parseFloat((existing.stop_loss_pct * 100).toFixed(2)),
        take_profit_pct: parseFloat((existing.take_profit_pct * 100).toFixed(2)),
      });
    } else {
      reset({
        broker_connection_id: (connections as any[])[0]?.id ?? "",
        is_enabled: false,
        min_confidence: 60,
        max_position_pct: 10,
        stop_loss_pct: 2,
        take_profit_pct: 4,
        max_open_positions: 5,
        cooldown_minutes: 60,
      });
    }
  }, [existing?.id, (connections as any[])[0]?.id]);

  const saveMut = useMutation({
    mutationFn: (data: AutoForm) =>
      existing
        ? signalApi.automationUpdate(existing.id, data)
        : signalApi.automationCreate(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation"] });
      qc.invalidateQueries({ queryKey: ["automation-status"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (e: any) => setError(e.response?.data?.detail || "Save failed"),
  });

  const stopMut = useMutation({
    mutationFn: signalApi.emergencyStop,
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["automation"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["automation-status"] });
      setError("");
      setStopResult({ configs_disabled: data.configs_disabled, orders_cancelled: data.orders_cancelled });
      setTimeout(() => setStopResult(null), 8000);
    },
    onError: (e: any) => setError(e.response?.data?.detail || "Emergency stop failed"),
  });

  if (!(connections as any[]).length) {
    return (
      <div className="space-y-5">
        <div className="card text-center py-10">
          <p className="text-gray-400 mb-3">Connect a broker account to enable automation.</p>
          <Link href="/connections" className="btn-primary inline-block">Connect Broker</Link>
        </div>
        <CustomStrategyBuilder />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Emergency stop + status header */}
      <div className="card flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={existing?.is_enabled ? "dot-live" : "dot-off"} />
          <div>
            <p className="font-semibold">{existing?.is_enabled ? "Autopilot Active" : "Autopilot Off"}</p>
            {autoStatus && (
              <p className="text-xs text-gray-500 font-mono mt-0.5">
                Today: {autoStatus.today?.filled ?? 0} filled · {autoStatus.today?.rejected ?? 0} rejected
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={stopMut.isPending}
          onClick={() => {
            if (confirm("EMERGENCY STOP: Disable all automation and cancel open orders?")) stopMut.mutate();
          }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sell/10 text-sell border border-sell/30 text-sm font-medium hover:bg-sell/20 disabled:opacity-50 transition-colors"
        >
          <OctagonX size={14} />
          {stopMut.isPending ? "Stopping…" : "Emergency Stop"}
        </button>
      </div>

      {stopResult && (
        <div className="alert-ok text-buy">
          <Check size={16} className="shrink-0" />
          <span>Stop executed. {stopResult.configs_disabled} config{stopResult.configs_disabled !== 1 ? "s" : ""} disabled · {stopResult.orders_cancelled} order{stopResult.orders_cancelled !== 1 ? "s" : ""} cancelled</span>
        </div>
      )}

      {/* PDT warnings */}
      {(pdtStatuses as any[]).filter((s) => s.pdt_applies).map((s: any) => (
        <div key={s.connection_id} className={s.at_limit ? "alert-bad" : "alert-warn"}>
          <AlertTriangle size={16} className={cn("shrink-0 mt-0.5", s.at_limit ? "text-sell" : "text-hold")} />
          <span className={s.at_limit ? "text-sell" : "text-hold"}>
            {s.at_limit
              ? `PDT limit reached — ${s.day_trade_count}/${s.day_trade_limit} round-trips used`
              : `PDT warning — ${s.remaining} day trade${s.remaining !== 1 ? "s" : ""} remaining`}
          </span>
        </div>
      ))}

      {wizardDone && (
        <div className="alert-ok">
          <Shield size={16} className="text-buy shrink-0" />
          <span className="text-buy font-medium">Autopilot live. Guardrails active.</span>
        </div>
      )}

      {/* Risk warning */}
      <div className="alert-warn">
        <AlertTriangle size={16} className="text-hold shrink-0 mt-0.5" />
        <p className="text-gray-400 text-xs">
          <strong className="text-hold">Risk warning:</strong> Automated trading can result in rapid financial loss.
          Paper trading recommended before live funds.
        </p>
      </div>

      {mode === "wizard" && connId && (
        equity != null ? (
          <RiskProfileWizard
            connId={connId}
            equity={equity}
            onDone={() => { setMode("custom"); setWizardDone(true); setTimeout(() => setWizardDone(false), 6000); }}
            onUseCustom={() => setMode("custom")}
          />
        ) : (
          <div className="card text-center py-8 text-gray-400 text-sm">Loading account info…</div>
        )
      )}

      {mode === "custom" && (
        <form onSubmit={handleSubmit((d) => saveMut.mutate(d))} className="space-y-5" noValidate>
          <div className="flex justify-end">
            <button type="button" onClick={() => setMode("wizard")} className="text-xs text-gray-500 hover:text-gray-200 underline">
              Use guided setup
            </button>
          </div>

          {/* Enable toggle */}
          <div className="card flex items-center justify-between">
            <div>
              <p className="font-medium">Automation Enabled</p>
              <p className="text-xs text-gray-500 mt-0.5">Places orders automatically when signals fire</p>
            </div>
            <input type="checkbox" {...register("is_enabled")} className="w-5 h-5 accent-brand" />
          </div>

          {/* Broker + Signal filters */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Settings2 size={14} className="text-gray-400" />
              Signal Filters
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Broker Account</label>
                <select className="input" {...register("broker_connection_id")}>
                  {(connections as any[]).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.display_name} ({c.is_paper ? "Paper" : "Live"})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Min Confidence (%)</label>
                <input className="input" type="number" step="1" min="10" max="100"
                  {...register("min_confidence", { setValueAs: (v) => Number(v) / 100 })}
                  defaultValue={35}
                />
                <p className="text-xs text-gray-600 mt-1">Typical range 25–40%</p>
              </div>
              <div>
                <label className="label">Cooldown (minutes)</label>
                <input className="input" type="number" min="1" {...register("cooldown_minutes", { valueAsNumber: true })} />
              </div>
            </div>
          </div>

          {/* Position sizing */}
          <div className="card space-y-4">
            <h3 className="font-semibold text-sm">Position Sizing</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Max Position ($)</label>
                <input className="input" type="number" min="1" placeholder="e.g. 500"
                  {...register("max_position_size_usd", { setValueAs: (v) => v === "" ? null : Number(v) })} />
              </div>
              <div>
                <label className="label">Max Position (% of portfolio)</label>
                <input className="input" type="number" step="1" min="1" max="100"
                  {...register("max_position_pct", { setValueAs: (v) => Number(v) / 100 })}
                  defaultValue={10}
                />
              </div>
            </div>
          </div>

          {/* Guardrails */}
          <div className="card space-y-4 border-sell/20">
            <h3 className="font-semibold text-sm text-sell flex items-center gap-2">
              <Shield size={14} />
              Guardrails
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="label">Stop Loss (%)</label>
                <input className="input" type="number" step="0.1" min="0.1"
                  {...register("stop_loss_pct", { setValueAs: (v) => Number(v) / 100 })}
                  defaultValue={2}
                />
              </div>
              <div>
                <label className="label">Take Profit (%)</label>
                <input className="input" type="number" step="0.1" min="0.1"
                  {...register("take_profit_pct", { setValueAs: (v) => Number(v) / 100 })}
                  defaultValue={4}
                />
              </div>
              <div>
                <label className="label">Max Daily Loss ($)</label>
                <input className="input" type="number" min="1" placeholder="e.g. 200"
                  {...register("max_daily_loss_usd", { setValueAs: (v) => v === "" ? null : Number(v) })} />
              </div>
            </div>
            <div>
              <label className="label">Max Open Positions</label>
              <input className="input w-28" type="number" min="1" max="20"
                {...register("max_open_positions", { valueAsNumber: true })} />
            </div>
          </div>

          {error && <p className="text-sell text-sm">{error}</p>}
          {saved && <p className="text-buy text-sm">Saved successfully.</p>}

          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : existing ? "Update Config" : "Save Config"}
          </button>
        </form>
      )}

      <AutomationDiagnosticPanel />
      <StrategiesPanel />
      <OptionsAutomationPanel />
      <CustomStrategyBuilder />
    </div>
  );
}

// ── Manual execution panel ──────────────────────────────────
function ManualPanel() {
  const qc = useQueryClient();
  const [ticker, setTicker] = useState("");
  const [inputVal, setInputVal] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [optionTicker, setOptionTicker] = useState<string | null>(null);

  // Pending equity orders for approval
  const { data: allOrders = [] } = useQuery({
    queryKey: ["orders-pending"],
    queryFn: () => signalApi.orders(50, "today"),
    refetchInterval: 30_000,
  });

  const pendingEquity = (allOrders as any[]).filter((o: any) => o.status === "pending_approval" && o.asset_type !== "option");

  const [busyId, setBusyId] = useState<string | null>(null);

  const approveMut = useMutation({
    mutationFn: (id: string) => signalApi.approveOrder(id),
    onMutate: (id) => setBusyId(id),
    onSettled: () => { setBusyId(null); qc.invalidateQueries({ queryKey: ["orders-pending"] }); },
  });
  const rejectMut = useMutation({
    mutationFn: (id: string) => signalApi.rejectOrder(id),
    onMutate: (id) => setBusyId(id),
    onSettled: () => { setBusyId(null); qc.invalidateQueries({ queryKey: ["orders-pending"] }); },
  });

  return (
    <div className="space-y-5">
      {/* Order ticket opener */}
      <div className="card">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Users size={15} className="text-gray-400" />
          Place Manual Order
        </h3>

        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="label">Ticker Symbol</label>
              <input
                className="input uppercase font-mono"
                placeholder="e.g. AAPL"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") setTicker(inputVal); }}
              />
            </div>
            <div>
              <label className="label">Side</label>
              <div className="flex rounded-lg bg-gray-800 p-0.5 gap-0.5">
                <button
                  type="button"
                  onClick={() => setSide("buy")}
                  className={cn("px-4 py-1.5 text-sm font-medium rounded-md transition-all", side === "buy" ? "bg-buy text-gray-950" : "text-gray-400")}
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => setSide("sell")}
                  className={cn("px-4 py-1.5 text-sm font-medium rounded-md transition-all", side === "sell" ? "bg-sell text-white" : "text-gray-400")}
                >
                  SELL
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => { if (inputVal) setTicker(inputVal); }}
              disabled={!inputVal}
              className="btn-primary flex items-center gap-2 disabled:opacity-40"
            >
              <ArrowUpRight size={15} />
              Open Order Ticket
            </button>
            <button
              onClick={() => { if (inputVal) setOptionTicker(inputVal); }}
              disabled={!inputVal}
              className="btn-ghost flex items-center gap-2 disabled:opacity-40"
            >
              <Zap size={14} />
              Options Ticket
            </button>
          </div>
        </div>
      </div>

      {/* Pending approvals */}
      <PendingApprovals
        orders={pendingEquity}
        onApprove={(id) => approveMut.mutate(id)}
        onReject={(id) => rejectMut.mutate(id)}
        busyId={busyId}
      />

      {/* Recent signals quick reference */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm text-gray-400 uppercase tracking-wider">Latest Signals</h3>
          <a href="/signals" className="text-xs text-brand hover:underline">Full signals →</a>
        </div>
        <p className="text-xs text-gray-600">
          Go to <a href="/signals" className="text-brand hover:underline">Signals</a> to view signals and click "Trade" on any row to open an order ticket directly.
        </p>
      </div>

      {/* Modals */}
      {ticker && (
        <OrderTicket
          ticker={ticker}
          defaultSide={side}
          onClose={() => setTicker("")}
        />
      )}
      {optionTicker && (
        <OptionsOrderTicket
          ticker={optionTicker}
          defaultSide={side}
          onClose={() => setOptionTicker(null)}
        />
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────
export default function TradePage() {
  const [mode, setMode] = useState<ExecMode>("manual");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Trade & Execution</h1>
        <div className="mode-toggle">
          <button
            onClick={() => setMode("manual")}
            className={cn("mode-btn", mode === "manual" && "mode-btn-active")}
          >
            <Users size={14} />
            Manual
          </button>
          <button
            onClick={() => setMode("automated")}
            className={cn("mode-btn", mode === "automated" && "mode-btn-active")}
          >
            <Bot size={14} />
            Automated
          </button>
        </div>
      </div>

      {mode === "manual" ? <ManualPanel /> : <AutomationPanel />}
    </div>
  );
}
