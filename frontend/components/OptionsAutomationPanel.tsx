"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { brokerApi, signalApi } from "@/lib/api";
import { fmtUsd, fmtPct } from "@/lib/utils";
import { Flame, Check, X as XIcon } from "lucide-react";

const schema = z.object({
  broker_connection_id: z.string().uuid(),
  is_enabled: z.boolean(),
  budget_usd: z.number().min(100).max(1_000_000),
  min_confidence: z.number().min(0.1).max(1),
  max_contracts_per_trade: z.number().int().min(1).max(20),
  max_open_positions: z.number().int().min(1).max(20),
  target_dte_min: z.number().int().min(0).max(365),
  target_dte_max: z.number().int().min(0).max(365),
  profit_target_pct: z.number().min(0.01).max(5),
  stop_loss_pct: z.number().min(0.01).max(1),
});
type Form = z.infer<typeof schema>;

function PendingApprovals() {
  const qc = useQueryClient();
  const [bulkResult, setBulkResult] = useState("");
  const { data: pending = [] } = useQuery({
    queryKey: ["options-automation", "pending"],
    queryFn: signalApi.pendingOptionOrders,
    refetchInterval: 5_000,
  });
  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const connId = connections[0]?.id;

  // Live premium per staged contract, so the user can see if price moved
  // since staging before approving — same connId for every row since this
  // app only ever has one active connection per user today.
  const liveQuotes = useQueries({
    queries: pending.map((o: any) => ({
      queryKey: ["quote", connId, o.option_symbol],
      queryFn: () => brokerApi.quote(connId, o.option_symbol),
      enabled: !!connId && !!o.option_symbol,
      refetchInterval: 10_000,
    })),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => signalApi.approveOptionOrder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["options-automation"] }),
  });
  const rejectMut = useMutation({
    mutationFn: (id: string) => signalApi.rejectOptionOrder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["options-automation"] }),
  });
  const approveAllMut = useMutation({
    mutationFn: () => signalApi.approveAllOptionOrders(),
    onSuccess: (results: any[]) => {
      qc.invalidateQueries({ queryKey: ["options-automation"] });
      const submitted = results.filter((o) => o.status === "submitted" || o.status === "filled").length;
      const cancelled = results.length - submitted;
      setBulkResult(
        cancelled > 0
          ? `Approved ${submitted}, ${cancelled} couldn't go through (budget or connection) — see status below`
          : `Approved all ${submitted}`
      );
      setTimeout(() => setBulkResult(""), 6000);
    },
  });

  if (pending.length === 0) return null;
  const busy = approveMut.isPending || rejectMut.isPending || approveAllMut.isPending;

  return (
    <div className="card border-brand/30 bg-brand/5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Flame size={16} className="text-hold" /> Pending Approval
          <span className="text-xs text-gray-400 font-normal ml-1">— staged, not yet placed with the broker</span>
        </h2>
        {pending.length > 1 && (
          <button
            onClick={() => approveAllMut.mutate()}
            disabled={busy}
            className="flex items-center gap-1 px-3 py-1 rounded bg-buy text-white text-xs font-semibold hover:bg-buy/80 disabled:opacity-50"
          >
            <Check size={12} /> Approve All ({pending.length})
          </button>
        )}
      </div>
      {bulkResult && <p className="text-xs text-gray-300">{bulkResult}</p>}
      {pending.map((o: any, i: number) => {
        const cost = (o.premium_paid || 0) * o.quantity * 100;
        const live = liveQuotes[i]?.data as any;
        const livePremium = live?.last ?? live?.ask_price ?? null;
        const moved = livePremium != null && o.premium_paid ? livePremium - o.premium_paid : null;
        return (
          <div key={o.id} className="flex items-center gap-3 text-sm py-2 border-b border-gray-800/50 last:border-0">
            <span className="font-mono font-bold w-14">{o.ticker}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${o.option_right === "call" ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell"}`}>
              {o.option_right?.toUpperCase()}
            </span>
            <span className="text-gray-400">Strike ${o.strike_price?.toFixed(2)}</span>
            <span className="text-gray-500 text-xs">{o.expiration_date}</span>
            <span className="text-gray-400">Staged {fmtUsd(o.premium_paid)}</span>
            {livePremium != null && (
              <span className={moved != null && Math.abs(moved) >= 0.01 ? (moved > 0 ? "text-sell" : "text-buy") : "text-gray-400"}>
                Now {fmtUsd(livePremium)}
                {moved != null && Math.abs(moved) >= 0.01 && ` (${moved > 0 ? "+" : ""}${moved.toFixed(2)})`}
              </span>
            )}
            <span className="text-hold font-semibold">Cost {fmtUsd(cost)}</span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => approveMut.mutate(o.id)}
                disabled={approveMut.isPending || rejectMut.isPending}
                className="flex items-center gap-1 px-3 py-1 rounded bg-buy text-white text-xs font-semibold hover:bg-buy/80 disabled:opacity-50"
              >
                <Check size={12} /> Approve
              </button>
              <button
                onClick={() => rejectMut.mutate(o.id)}
                disabled={approveMut.isPending || rejectMut.isPending}
                className="flex items-center gap-1 px-3 py-1 rounded bg-gray-700 text-gray-200 text-xs font-semibold hover:bg-gray-600 disabled:opacity-50"
              >
                <XIcon size={12} /> Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function OptionsAutomationPanel() {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const { data: configs = [] } = useQuery({ queryKey: ["options-automation"], queryFn: signalApi.optionsAutomationList });
  const existing = configs[0];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: existing ? {
      ...existing,
      min_confidence: Math.round(existing.min_confidence * 100),
      profit_target_pct: Math.round(existing.profit_target_pct * 100),
      stop_loss_pct: Math.round(existing.stop_loss_pct * 100),
    } : {
      broker_connection_id: connections[0]?.id || "",
      is_enabled: false,
      budget_usd: 10_000,
      min_confidence: 40,
      max_contracts_per_trade: 1,
      max_open_positions: 5,
      target_dte_min: 7,
      target_dte_max: 21,
      profit_target_pct: 50,
      stop_loss_pct: 30,
    },
  });

  useEffect(() => {
    if (!connections.length) return;
    if (existing) {
      reset({
        ...existing,
        min_confidence: Math.round(existing.min_confidence * 100),
        profit_target_pct: Math.round(existing.profit_target_pct * 100),
        stop_loss_pct: Math.round(existing.stop_loss_pct * 100),
      });
    } else {
      reset({ broker_connection_id: connections[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, connections[0]?.id]);

  const mut = useMutation({
    mutationFn: (data: Form) =>
      existing
        ? signalApi.optionsAutomationUpdate(existing.id, data)
        : signalApi.optionsAutomationCreate(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["options-automation"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (e: any) => setError(e.response?.data?.detail || "Save failed"),
  });

  if (!connections.length) return null;

  return (
    <div className="space-y-4">
      <PendingApprovals />

      <div className="card border-hold/20">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <Flame size={16} className="text-hold" /> Options Automation (Paper Test)
        </h2>
        <p className="text-xs text-gray-400 mb-4">
          Single-leg long calls/puts only — buys a call on a BUY signal, a put on a SELL signal.
          Every trade is staged here for your approval before anything is sent to the broker;
          nothing fires automatically yet. Real strikes/premiums pulled from the live options chain.
        </p>

        <form onSubmit={handleSubmit((d) => mut.mutate(d))} className="space-y-4" noValidate>
          <div className="flex items-center justify-between bg-gray-800/40 rounded-lg p-3">
            <div>
              <p className="font-medium text-sm">Enable staging</p>
              <p className="text-xs text-gray-400">Scheduler will stage candidates for you to approve every ~15 min during market hours</p>
            </div>
            <input type="checkbox" {...register("is_enabled")} className="w-5 h-5 accent-brand" />
          </div>

          <div>
            <label className="label">Broker account</label>
            <select className="input" {...register("broker_connection_id")}>
              {connections.map((c: any) => (
                <option key={c.id} value={c.id}>{c.display_name} ({c.is_paper ? "Paper" : "Live"})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Test Budget ($)</label>
              <input className="input" type="number" min="100" step="100"
                {...register("budget_usd", { valueAsNumber: true })} />
              <p className="text-xs text-gray-500 mt-1">Total premium cap across open positions</p>
              {errors.budget_usd && <p className="text-xs text-sell mt-1">{errors.budget_usd.message}</p>}
            </div>
            <div>
              <label className="label">Min Confidence (%)</label>
              <input className="input" type="number" min="10" max="100" step="1"
                {...register("min_confidence", { setValueAs: (v) => Number(v) / 100 })} />
              {errors.min_confidence && <p className="text-xs text-sell mt-1">{errors.min_confidence.message}</p>}
            </div>
            <div>
              <label className="label">Max Open Positions</label>
              <input className="input" type="number" min="1" max="20"
                {...register("max_open_positions", { valueAsNumber: true })} />
              {errors.max_open_positions && <p className="text-xs text-sell mt-1">{errors.max_open_positions.message}</p>}
            </div>
            <div>
              <label className="label">Contracts / Trade</label>
              <input className="input" type="number" min="1" max="20"
                {...register("max_contracts_per_trade", { valueAsNumber: true })} />
              {errors.max_contracts_per_trade && <p className="text-xs text-sell mt-1">{errors.max_contracts_per_trade.message}</p>}
            </div>
            <div>
              <label className="label">Target DTE Min</label>
              <input className="input" type="number" min="0" max="365"
                {...register("target_dte_min", { valueAsNumber: true })} />
              {errors.target_dte_min && <p className="text-xs text-sell mt-1">{errors.target_dte_min.message}</p>}
            </div>
            <div>
              <label className="label">Target DTE Max</label>
              <input className="input" type="number" min="0" max="365"
                {...register("target_dte_max", { valueAsNumber: true })} />
              {errors.target_dte_max && <p className="text-xs text-sell mt-1">{errors.target_dte_max.message}</p>}
            </div>
            <div>
              <label className="label">Profit Target (%)</label>
              <input className="input" type="number" min="1" max="500" step="1"
                {...register("profit_target_pct", { setValueAs: (v) => Number(v) / 100 })} />
              <p className="text-xs text-gray-500 mt-1">Of premium paid</p>
              {errors.profit_target_pct && <p className="text-xs text-sell mt-1">{errors.profit_target_pct.message}</p>}
            </div>
            <div>
              <label className="label">Stop Loss (%)</label>
              <input className="input" type="number" min="1" max="100" step="1"
                {...register("stop_loss_pct", { setValueAs: (v) => Number(v) / 100 })} />
              <p className="text-xs text-gray-500 mt-1">Of premium paid</p>
              {errors.stop_loss_pct && <p className="text-xs text-sell mt-1">{errors.stop_loss_pct.message}</p>}
            </div>
          </div>

          {error && <p className="text-sell text-sm">{error}</p>}
          {saved && <p className="text-buy text-sm">Saved successfully.</p>}

          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : existing ? "Update config" : "Save config"}
          </button>
        </form>
      </div>
    </div>
  );
}
