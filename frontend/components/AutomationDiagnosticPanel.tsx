"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { signalApi } from "@/lib/api";
import { Clock, Activity } from "lucide-react";
import { cn, fmtPct } from "@/lib/utils";
import Link from "next/link";

export default function AutomationDiagnosticPanel() {
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ["automation-status"],
    queryFn: signalApi.automationStatus,
    refetchInterval: 30_000,
  });

  const toggleMut = useMutation({
    mutationFn: (enabled: boolean) =>
      signalApi.automationUpdate(status!.config.id, {
        broker_connection_id: status!.config.broker_connection_id,
        is_enabled: enabled,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation-status"] });
      qc.invalidateQueries({ queryKey: ["automation"] });
    },
  });

  if (isLoading || !status) return null;

  const { config, today, top_rejection_reasons } = status;
  const totalToday = today.submitted + today.filled + today.rejected + today.pending_approval;
  const executedToday = today.submitted + today.filled;
  const hasConfig = !!config.id;

  return (
    <div className="card border-gray-800 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <Activity size={15} className="text-brand" /> Automation Status
        </h2>
        <Link href="/orders" className="text-xs text-brand hover:underline">
          View all orders →
        </Link>
      </div>

      {/* Prominent ON / OFF toggle */}
      <div
        className={cn(
          "flex items-center justify-between rounded-lg p-4 border transition-colors",
          config.is_enabled
            ? "border-buy/30 bg-buy/5"
            : "border-gray-700 bg-gray-900"
        )}
      >
        <div>
          <p className={cn("font-semibold text-base", config.is_enabled ? "text-buy" : "text-gray-300")}>
            Autopilot is {config.is_enabled ? "ON" : "OFF"}
          </p>
          {config.is_enabled && config.min_confidence != null && (
            <p className="text-xs text-gray-400 mt-0.5">
              Fires when signal confidence ≥{" "}
              <span className="text-white font-semibold">{fmtPct(config.min_confidence)}</span>
              <span className="text-gray-600 ml-1">(typical range: 10%–65%)</span>
            </p>
          )}
          {!config.is_enabled && hasConfig && (
            <p className="text-xs text-gray-500 mt-0.5">
              Toggle ON to start automated trading
            </p>
          )}
          {!hasConfig && (
            <p className="text-xs text-gray-500 mt-0.5">
              Complete the setup wizard below first
            </p>
          )}
        </div>

        {hasConfig && (
          <button
            disabled={toggleMut.isPending}
            onClick={() => toggleMut.mutate(!config.is_enabled)}
            className={cn(
              "relative inline-flex h-8 w-14 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50",
              config.is_enabled ? "bg-buy" : "bg-gray-600"
            )}
            aria-label={config.is_enabled ? "Disable autopilot" : "Enable autopilot"}
          >
            <span
              className={cn(
                "inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform duration-200",
                config.is_enabled ? "translate-x-7" : "translate-x-1"
              )}
            />
          </button>
        )}
      </div>

      {/* Today's summary */}
      {hasConfig && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Today's activity</p>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Executed", value: executedToday, color: executedToday > 0 ? "text-buy" : "text-gray-500" },
              { label: "Rejected", value: today.rejected, color: today.rejected > 0 ? "text-sell" : "text-gray-500" },
              { label: "Pending", value: today.pending_approval, color: today.pending_approval > 0 ? "text-hold" : "text-gray-500" },
              { label: "Total evals", value: totalToday, color: "text-gray-300" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gray-900 rounded-lg p-2.5 text-center">
                <p className={cn("text-xl font-bold", color)}>{value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top rejection reasons */}
      {top_rejection_reasons.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Clock size={11} /> Why signals were blocked today
          </p>
          <div className="space-y-1.5">
            {top_rejection_reasons.map(
              ({ reason, count }: { reason: string; count: number }) => (
                <div key={reason} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 px-1.5 py-0.5 rounded bg-sell/20 text-sell font-bold">
                    ×{count}
                  </span>
                  <span className="text-gray-400">{reason}</span>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Idle hints */}
      {totalToday === 0 && config.is_enabled && (
        <p className="text-xs text-gray-500 bg-gray-900 rounded-lg p-3">
          No activity yet today. Scheduler runs Mon–Fri, 9am–4pm ET. Most
          signals score 15–55%; set confidence threshold below 35% to see
          regular trade activity.
        </p>
      )}
    </div>
  );
}
