"use client";
import { useQuery } from "@tanstack/react-query";
import { signalApi } from "@/lib/api";
import { AlertCircle, CheckCircle2, Clock, Activity, XCircle } from "lucide-react";
import { cn, fmtPct } from "@/lib/utils";
import Link from "next/link";

export default function AutomationDiagnosticPanel() {
  const { data: status, isLoading } = useQuery({
    queryKey: ["automation-status"],
    queryFn: signalApi.automationStatus,
    refetchInterval: 30_000,
  });

  if (isLoading || !status) return null;

  const { config, today, top_rejection_reasons } = status;
  const totalToday = today.submitted + today.filled + today.rejected + today.pending_approval;
  const hasActivity = totalToday > 0;
  const executedToday = today.submitted + today.filled;

  return (
    <div className="card border-gray-800 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <Activity size={15} className="text-brand" /> Automation Diagnostics
        </h2>
        <Link href="/orders" className="text-xs text-brand hover:underline">
          View all orders →
        </Link>
      </div>

      {/* Config live status */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg p-3 border text-sm",
          config.is_enabled
            ? "border-buy/30 bg-buy/5"
            : "border-sell/30 bg-sell/5"
        )}
      >
        {config.is_enabled ? (
          <CheckCircle2 size={16} className="text-buy shrink-0" />
        ) : (
          <XCircle size={16} className="text-sell shrink-0" />
        )}
        <div>
          <strong className={config.is_enabled ? "text-buy" : "text-sell"}>
            Autopilot is {config.is_enabled ? "ON" : "OFF"}
          </strong>
          {config.is_enabled && config.min_confidence != null && (
            <span className="text-gray-400 ml-2">
              — fires when signal confidence ≥{" "}
              <span className="text-white font-semibold">
                {fmtPct(config.min_confidence)}
              </span>
              <span className="text-gray-600 ml-1">
                (typical signal range: 10%–65%)
              </span>
            </span>
          )}
          {!config.is_enabled && (
            <span className="text-gray-400 ml-2">
              — enable "Automation Enabled" in the form above to start
            </span>
          )}
        </div>
      </div>

      {/* Today's order summary */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Today's activity</p>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Executed", value: executedToday, color: "text-buy" },
            { label: "Rejected", value: today.rejected, color: today.rejected > 0 ? "text-sell" : "text-gray-500" },
            { label: "Pending", value: today.pending_approval, color: "text-hold" },
            { label: "Total evals", value: totalToday, color: "text-gray-300" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-gray-900 rounded-lg p-2.5 text-center">
              <p className={cn("text-xl font-bold", color)}>{value}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

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

      {/* Idle state hints */}
      {!hasActivity && config.is_enabled && (
        <p className="text-xs text-gray-500 bg-gray-900 rounded-lg p-3">
          No automated activity yet today. The scheduler runs Mon–Fri during
          US market hours (9am–4pm ET). If no orders appear after a market
          session, check that your watchlist has tickers and that the confidence
          threshold is reachable — most signals score 15%–55%.
        </p>
      )}

      {!hasActivity && !config.is_enabled && (
        <p className="text-xs text-gray-500 bg-gray-900 rounded-lg p-3">
          Enable automation above and set a confidence threshold. Recommended
          starting point: 35% (Balanced profile). The signal engine produces
          scores from 10%–70%; most BUY/SELL signals score 20%–50%.
        </p>
      )}
    </div>
  );
}
