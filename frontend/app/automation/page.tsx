"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { brokerApi, signalApi } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useEffect } from "react";
import { Shield, AlertTriangle, OctagonX } from "lucide-react";
import { fmtPct } from "@/lib/utils";
import OptionsAutomationPanel from "@/components/OptionsAutomationPanel";
import RiskProfileWizard from "@/components/RiskProfileWizard";
import StrategiesPanel from "@/components/StrategiesPanel";
import AutomationDiagnosticPanel from "@/components/AutomationDiagnosticPanel";

const schema = z.object({
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
  max_trades_per_day: z.number().int().min(1).optional().nullable(),
});
type Form = z.infer<typeof schema>;

export default function AutomationPage() {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [stopResult, setStopResult] = useState<{ configs_disabled: number; orders_cancelled: number } | null>(null);
  const [mode, setMode] = useState<"wizard" | "custom" | null>(null);
  const [wizardDone, setWizardDone] = useState(false);

  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const { data: configs = [] } = useQuery({ queryKey: ["automation"], queryFn: signalApi.automationList });
  const { data: pdtStatuses = [] } = useQuery({ queryKey: ["pdt-status"], queryFn: signalApi.pdtStatus, refetchInterval: 60_000 });

  const existing = configs[0];
  const connId: string | undefined = existing?.broker_connection_id || connections[0]?.id;
  const equity = pdtStatuses.find((s: any) => s.connection_id === connId)?.equity;

  useEffect(() => {
    if (mode === null && connections.length) setMode(existing ? "custom" : "wizard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, connections.length]);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: existing ? {
      ...existing,
      broker_connection_id: existing.broker_connection_id,
      // Inputs display percentages; setValueAs divides by 100 on change.
      // defaultValues must supply percentages so the display matches the transform.
      min_confidence: Math.round(existing.min_confidence * 100),
      max_position_pct: Math.round(existing.max_position_pct * 100),
      stop_loss_pct: parseFloat((existing.stop_loss_pct * 100).toFixed(2)),
      take_profit_pct: parseFloat((existing.take_profit_pct * 100).toFixed(2)),
      max_trades_per_day: existing.max_trades_per_day ?? null,
    } : {
      broker_connection_id: connections[0]?.id || "",
      is_enabled: false,
      min_confidence: 60,
      max_position_pct: 10,
      stop_loss_pct: 2,
      take_profit_pct: 4,
      max_open_positions: 5,
      cooldown_minutes: 60,
      max_trades_per_day: null,
    },
  });

  // Reset form once async data arrives (defaultValues only apply on initial render)
  useEffect(() => {
    if (!connections.length) return;
    if (existing) {
      reset({
        ...existing,
        broker_connection_id: existing.broker_connection_id,
        min_confidence: Math.round(existing.min_confidence * 100),
        max_position_pct: Math.round(existing.max_position_pct * 100),
        stop_loss_pct: parseFloat((existing.stop_loss_pct * 100).toFixed(2)),
        take_profit_pct: parseFloat((existing.take_profit_pct * 100).toFixed(2)),
        max_trades_per_day: existing.max_trades_per_day ?? null,
      });
    } else {
      reset({ broker_connection_id: connections[0].id });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, connections[0]?.id]);

  const mut = useMutation({
    mutationFn: (data: Form) =>
      existing
        ? signalApi.automationUpdate(existing.id, data)
        : signalApi.automationCreate(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation"] });
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
      setError("");
      setStopResult({ configs_disabled: data.configs_disabled, orders_cancelled: data.orders_cancelled });
      setTimeout(() => setStopResult(null), 8000);
    },
    onError: (e: any) => setError(e.response?.data?.detail || "Emergency stop failed"),
  });

  if (!connections.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Automation</h1>
        <div className="card text-center py-12">
          <p className="text-gray-400">Connect a broker account first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Automation</h1>
        {existing?.is_enabled && (
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-buy/10 text-buy border border-buy/30">LIVE</span>
        )}
        <button
          type="button"
          disabled={stopMut.isPending}
          onClick={() => {
            if (confirm("EMERGENCY STOP: This will immediately disable all automation and cancel all open orders. Continue?")) {
              stopMut.mutate();
            }
          }}
          className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-sell text-white font-bold text-sm hover:bg-sell/80 disabled:opacity-50 transition-colors"
        >
          <OctagonX size={16} />
          {stopMut.isPending ? "Stopping…" : "Emergency Stop"}
        </button>
      </div>

      {/* Emergency stop success banner */}
      {stopResult && (
        <div className="card border-buy/40 bg-buy/5 flex items-start gap-3">
          <AlertTriangle size={18} className="text-buy mt-0.5 shrink-0" />
          <div className="text-sm">
            <strong className="text-buy">Emergency stop executed.</strong>
            <span className="text-gray-400 ml-2">
              {stopResult.configs_disabled} automation config{stopResult.configs_disabled !== 1 ? "s" : ""} disabled · {stopResult.orders_cancelled} open order{stopResult.orders_cancelled !== 1 ? "s" : ""} cancelled
            </span>
          </div>
        </div>
      )}

      {/* PDT warning banners */}
      {(pdtStatuses as any[]).filter((s) => s.pdt_applies).map((s: any) => (
        <div key={s.connection_id} className={`card flex items-start gap-3 ${s.at_limit ? "border-sell/40 bg-sell/5" : "border-hold/30 bg-hold/5"}`}>
          <AlertTriangle size={18} className={`${s.at_limit ? "text-sell" : "text-hold"} mt-0.5 shrink-0`} />
          <div className="text-sm">
            <strong className={s.at_limit ? "text-sell" : "text-hold"}>
              {s.at_limit ? "PDT limit reached" : `PDT warning — ${s.remaining} day trade${s.remaining !== 1 ? "s" : ""} remaining`}
            </strong>
            <span className="text-gray-400 ml-2">
              {s.day_trade_count}/{s.day_trade_limit} round-trips used in {s.window_days}-day window · {s.display_name} · ${s.equity.toLocaleString()} equity
              {s.at_limit && " · Fund account to $25,000+ to unlock unlimited day trades"}
            </span>
          </div>
        </div>
      ))}

      {/* Risk warning */}
      <div className="card border-hold/30 bg-hold/5 flex items-start gap-3">
        <AlertTriangle size={18} className="text-hold mt-0.5 shrink-0" />
        <div className="text-sm text-gray-300">
          <strong className="text-hold">Risk warning:</strong> Automated trading can result in rapid financial loss.
          All guardrails below are hard limits enforced before every order.
          Paper trading is strongly recommended before enabling with real money.
        </div>
      </div>

      {wizardDone && (
        <div className="card border-buy/40 bg-buy/5 flex items-start gap-3">
          <Shield size={18} className="text-buy mt-0.5 shrink-0" />
          <p className="text-sm"><strong className="text-buy">Autopilot is live.</strong> <span className="text-gray-400">Guardrails below reflect your risk profile — adjust anytime.</span></p>
        </div>
      )}

      {mode === "wizard" && connId && (
        equity != null ? (
          <RiskProfileWizard
            connId={connId}
            equity={equity}
            onDone={() => { setMode("custom"); setWizardDone(true); setTimeout(() => setWizardDone(false), 6000); }}
            onUseCustom={() => setMode("custom")}
          />
        ) : (
          <div className="card text-center py-12 text-gray-400">Loading account info…</div>
        )
      )}

      {mode === "custom" && (
      <form onSubmit={handleSubmit((d) => mut.mutate(d))} className="space-y-6" noValidate>

        {/* Enable toggle */}
        <div className="card flex items-center justify-between">
          <div>
            <p className="font-semibold">Automation Enabled</p>
            <p className="text-sm text-gray-400">System will automatically place orders when signal fires</p>
          </div>
          <input type="checkbox" {...register("is_enabled")} className="w-5 h-5 accent-brand" />
        </div>

        {/* Broker */}
        <div className="card space-y-4">
          <h2 className="font-semibold flex items-center gap-2"><Shield size={16} /> Broker Account</h2>
          <div>
            <label className="label">Select account</label>
            <select className="input" {...register("broker_connection_id")}>
              {connections.map((c: any) => (
                <option key={c.id} value={c.id}>{c.display_name} ({c.is_paper ? "Paper" : "Live"})</option>
              ))}
            </select>
          </div>
        </div>

        {/* Signal filters */}
        <div className="card space-y-4">
          <h2 className="font-semibold">Signal Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Min Confidence (%)</label>
              <input className="input" type="number" step="1" min="10" max="100"
                {...register("min_confidence", { setValueAs: (v) => Number(v) / 100 })}
                defaultValue={35}
              />
              <p className="text-xs text-gray-500 mt-1">
                Signal scores: 10%–70% typical, median ~25–35%. Set lower to trade more; higher for fewer, stronger-conviction trades.
              </p>
              {errors.min_confidence && <p className="text-xs text-sell mt-1">{errors.min_confidence.message}</p>}
            </div>
            <div>
              <label className="label">Cooldown (minutes)</label>
              <input className="input" type="number" min="1" {...register("cooldown_minutes", { valueAsNumber: true })} />
              <p className="text-xs text-gray-500 mt-1">Min time between signals for same ticker</p>
              {errors.cooldown_minutes && <p className="text-xs text-sell mt-1">{errors.cooldown_minutes.message}</p>}
            </div>
          </div>
        </div>

        {/* Position sizing */}
        <div className="card space-y-4">
          <h2 className="font-semibold">Position Sizing</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Max Position Size ($)</label>
              <input className="input" type="number" min="1" placeholder="e.g. 500"
                {...register("max_position_size_usd", { setValueAs: (v) => v === "" ? null : Number(v) })} />
              <p className="text-xs text-gray-500 mt-1">Hard cap per trade in dollars (optional)</p>
              {errors.max_position_size_usd && <p className="text-xs text-sell mt-1">{errors.max_position_size_usd.message}</p>}
            </div>
            <div>
              <label className="label">Max Position (% of portfolio)</label>
              <input className="input" type="number" step="1" min="1" max="100"
                {...register("max_position_pct", { setValueAs: (v) => Number(v) / 100 })}
                defaultValue={10}
              />
              <p className="text-xs text-gray-500 mt-1">% of total equity per position</p>
              {errors.max_position_pct && <p className="text-xs text-sell mt-1">{errors.max_position_pct.message}</p>}
            </div>
          </div>
        </div>

        {/* Risk limits — GUARDRAILS */}
        <div className="card space-y-4 border-sell/20">
          <h2 className="font-semibold text-sell flex items-center gap-2">
            <Shield size={16} /> Guardrails (Hard Stops)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Stop Loss (%)</label>
              <input className="input" type="number" step="0.1" min="0.1"
                {...register("stop_loss_pct", { setValueAs: (v) => Number(v) / 100 })}
                defaultValue={2}
              />
              <p className="text-xs text-gray-500 mt-1">Auto stop-loss below entry</p>
              {errors.stop_loss_pct && <p className="text-xs text-sell mt-1">{errors.stop_loss_pct.message}</p>}
            </div>
            <div>
              <label className="label">Take Profit (%)</label>
              <input className="input" type="number" step="0.1" min="0.1"
                {...register("take_profit_pct", { setValueAs: (v) => Number(v) / 100 })}
                defaultValue={4}
              />
              <p className="text-xs text-gray-500 mt-1">Auto take-profit above entry</p>
              {errors.take_profit_pct && <p className="text-xs text-sell mt-1">{errors.take_profit_pct.message}</p>}
            </div>
            <div>
              <label className="label">Max Daily Loss ($)</label>
              <input className="input" type="number" min="1" placeholder="e.g. 200"
                {...register("max_daily_loss_usd", { setValueAs: (v) => v === "" ? null : Number(v) })} />
              <p className="text-xs text-gray-500 mt-1">Kill switch — halts automation</p>
              {errors.max_daily_loss_usd && <p className="text-xs text-sell mt-1">{errors.max_daily_loss_usd.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Max Open Positions</label>
              <input className="input" type="number" min="1" max="20"
                {...register("max_open_positions", { valueAsNumber: true })} />
              <p className="text-xs text-gray-500 mt-1">Max concurrent open positions</p>
              {errors.max_open_positions && <p className="text-xs text-sell mt-1">{errors.max_open_positions.message}</p>}
            </div>
            <div>
              <label className="label">Max Trades Per Day</label>
              <input className="input" type="number" min="1" placeholder="Unlimited"
                {...register("max_trades_per_day", { setValueAs: (v) => v === "" ? null : parseInt(v, 10) })} />
              <p className="text-xs text-gray-500 mt-1">Automation stops firing after this many fills today</p>
              {errors.max_trades_per_day && <p className="text-xs text-sell mt-1">{errors.max_trades_per_day.message}</p>}
            </div>
          </div>
        </div>

        {error && <p className="text-sell text-sm">{error}</p>}
        {saved && <p className="text-buy text-sm">Saved successfully.</p>}

        <div className="flex items-center gap-4">
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : existing ? "Update config" : "Save config"}
          </button>
          <button type="button" onClick={() => setMode("wizard")} className="text-xs text-gray-400 hover:text-gray-200 underline">
            Use guided setup instead
          </button>
        </div>
      </form>
      )}

      <AutomationDiagnosticPanel />

      <StrategiesPanel />

      <OptionsAutomationPanel />
    </div>
  );
}
