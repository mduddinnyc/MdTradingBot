"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { analysisApi } from "@/lib/api";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  BarChart2,
  Activity,
  Shield,
  Zap,
  ListOrdered,
  ShoppingCart,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────

interface GuardrailCheck {
  name: string;
  passed: boolean;
  detail: string;
}

interface DecisionStep {
  step: string;
  status: string; // "ok" | "warning" | "blocked"
  summary: string;
  detail: Record<string, unknown>;
}

interface Decision {
  id: string;
  symbol: string;
  timeframe: string;
  created_at: string;
  signal_type: string;
  confidence: number;
  entry_price: number | null;
  target_price: number | null;
  stop_price: number | null;
  pattern_detected: string | null;
  indicators: Record<string, number>;
  reasoning: string | null;
  guardrails: GuardrailCheck[];
  guardrails_passed: boolean;
  order_id: string | null;
  order_status: string | null;
  order_side: string | null;
  order_qty: number | null;
  order_fill_price: number | null;
  rejection_reason: string | null;
  steps: DecisionStep[];
}

interface Stats {
  total_signals: number;
  buy_signals: number;
  sell_signals: number;
  hold_signals: number;
  orders_placed: number;
  orders_filled: number;
  orders_rejected: number;
  win_rate: number | null;
  avg_confidence: number;
  symbols_tracked: number;
}

// ── Step config ─────────────────────────────────────────────────

const STEP_META: Record<string, { label: string; Icon: React.ElementType }> = {
  market_data: { label: "Market Data",   Icon: BarChart2    },
  indicators:  { label: "Indicators",    Icon: Activity     },
  pattern:     { label: "Pattern",       Icon: Zap          },
  fusion:      { label: "Signal Fusion", Icon: Brain        },
  guardrails:  { label: "Guardrails",    Icon: Shield       },
  order:       { label: "Order",         Icon: ShoppingCart },
};

// ── Sub-components ───────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === "ok")      return <CheckCircle2 className="w-4 h-4 text-green-400" />;
  if (status === "blocked") return <XCircle      className="w-4 h-4 text-red-400"   />;
  return                           <AlertCircle  className="w-4 h-4 text-yellow-400" />;
}

function SignalBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    BUY:  "bg-green-500/20 text-green-400 border border-green-500/40",
    SELL: "bg-red-500/20 text-red-400 border border-red-500/40",
    HOLD: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/40",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${map[type] ?? map.HOLD}`}>
      {type === "BUY"  && <TrendingUp   className="w-3 h-3" />}
      {type === "SELL" && <TrendingDown className="w-3 h-3" />}
      {type === "HOLD" && <Minus        className="w-3 h-3" />}
      {type}
    </span>
  );
}

function OrderStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, string> = {
    filled:    "bg-green-500/20 text-green-400",
    submitted: "bg-blue-500/20 text-blue-400",
    rejected:  "bg-red-500/20 text-red-400",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? "bg-zinc-700 text-zinc-400"}`}>
      {status.toUpperCase()}
    </span>
  );
}

function StepRow({ step, isLast }: { step: DecisionStep; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = STEP_META[step.step] ?? { label: step.step, Icon: ListOrdered };
  const { Icon } = meta;

  return (
    <div className="relative">
      {!isLast && (
        <div className="absolute left-4 top-9 bottom-0 w-px bg-zinc-700" />
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-zinc-800/60 transition-colors text-left"
      >
        <div className="mt-0.5 flex-shrink-0 flex items-center gap-2">
          <StatusIcon status={step.status} />
          <div className="w-6 h-6 rounded bg-zinc-800 flex items-center justify-center">
            <Icon className="w-3.5 h-3.5 text-zinc-400" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              {meta.label}
            </span>
          </div>
          <p className="text-sm text-zinc-200 mt-0.5 font-mono">{step.summary}</p>
        </div>
        <div className="flex-shrink-0 mt-1">
          {open ? (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-500" />
          )}
        </div>
      </button>

      {open && Object.keys(step.detail).length > 0 && (
        <div className="ml-14 mb-2 p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          {step.step === "guardrails" && Array.isArray((step.detail as any).checks) ? (
            <div className="space-y-1.5">
              {((step.detail as any).checks as GuardrailCheck[]).map((c) => (
                <div key={c.name} className="flex items-center gap-2 text-sm">
                  {c.passed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                  )}
                  <span className={c.passed ? "text-zinc-300" : "text-red-300"}>
                    <strong>{c.name}:</strong> {c.detail}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <pre className="text-xs text-zinc-400 font-mono overflow-auto">
              {JSON.stringify(step.detail, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function DecisionCard({ decision }: { decision: Decision }) {
  const [expanded, setExpanded] = useState(false);

  const borderColor =
    decision.order_status === "filled"
      ? "border-green-500/30"
      : decision.order_status === "rejected"
      ? "border-red-500/30"
      : decision.signal_type === "HOLD"
      ? "border-zinc-700"
      : "border-blue-500/30";

  const timeStr = new Date(decision.created_at).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className={`bg-zinc-900 border ${borderColor} rounded-xl overflow-hidden`}>
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-4 p-4 hover:bg-zinc-800/40 transition-colors text-left"
      >
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
          <span className="font-bold text-white">{decision.symbol}</span>
          <SignalBadge type={decision.signal_type} />
          <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
            {decision.timeframe}
          </span>
          {decision.order_status && (
            <OrderStatusBadge status={decision.order_status} />
          )}
          {decision.pattern_detected && (
            <span className="text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded">
              {decision.pattern_detected}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <div className="text-sm font-semibold text-white">
              {(decision.confidence * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-zinc-500">confidence</div>
          </div>
          {decision.entry_price && (
            <div className="text-right hidden sm:block">
              <div className="text-sm font-mono text-white">
                ${decision.entry_price.toFixed(2)}
              </div>
              <div className="text-xs text-zinc-500">entry</div>
            </div>
          )}
          <div className="text-right hidden md:block">
            <div className="text-xs text-zinc-400">{timeStr}</div>
          </div>
          {expanded ? (
            <ChevronDown className="w-5 h-5 text-zinc-500" />
          ) : (
            <ChevronRight className="w-5 h-5 text-zinc-500" />
          )}
        </div>
      </button>

      {/* Expanded: full decision chain */}
      {expanded && (
        <div className="border-t border-zinc-800">
          {/* Price targets */}
          {decision.signal_type !== "HOLD" && (
            <div className="flex gap-6 px-4 py-3 bg-zinc-800/30 text-sm">
              <div>
                <span className="text-zinc-500">Entry </span>
                <span className="text-white font-mono">
                  {decision.entry_price ? `$${decision.entry_price.toFixed(2)}` : "—"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Target </span>
                <span className="text-green-400 font-mono">
                  {decision.target_price ? `$${decision.target_price.toFixed(2)}` : "—"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Stop </span>
                <span className="text-red-400 font-mono">
                  {decision.stop_price ? `$${decision.stop_price.toFixed(2)}` : "—"}
                </span>
              </div>
              {decision.order_fill_price && (
                <div>
                  <span className="text-zinc-500">Fill </span>
                  <span className="text-blue-400 font-mono">
                    ${decision.order_fill_price.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 6-step chain */}
          <div className="p-4">
            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              Decision Chain
            </h4>
            <div className="space-y-1">
              {decision.steps.map((step, i) => (
                <StepRow
                  key={step.step}
                  step={step}
                  isLast={i === decision.steps.length - 1}
                />
              ))}
            </div>
          </div>

          {/* Reasoning */}
          {decision.reasoning && (
            <div className="px-4 pb-4">
              <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                Raw Reasoning
              </h4>
              <p className="text-xs text-zinc-400 font-mono bg-zinc-800 p-3 rounded-lg break-all">
                {decision.reasoning}
              </p>
            </div>
          )}

          {/* Rejection reason */}
          {decision.rejection_reason && (
            <div className="mx-4 mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <span className="text-xs font-semibold text-red-400">Rejection reason: </span>
              <span className="text-xs text-red-300">{decision.rejection_reason}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color = "text-white",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────

export default function AnalysisPage() {
  const [symbol, setSymbol] = useState<string>("");
  const [limit] = useState(50);

  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ["analysis-stats"],
    queryFn: () => analysisApi.stats(),
    staleTime: 30_000,
  });

  const { data: decisions = [], isLoading: decisionsLoading } = useQuery<Decision[]>({
    queryKey: ["analysis-decisions", limit, symbol],
    queryFn: () => analysisApi.decisions(limit, symbol || undefined),
    staleTime: 30_000,
  });

  const symbols = Array.from(new Set(decisions.map((d) => d.symbol))).sort();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Title */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-purple-500/20 flex items-center justify-center">
          <Brain className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">AI Decision Audit Log</h1>
          <p className="text-sm text-zinc-500">
            Full decision chain — every signal, indicator, pattern, and order the AI considered
          </p>
        </div>
      </div>

      {/* Stats row */}
      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Total Signals"
            value={stats.total_signals}
            sub={`${stats.buy_signals} BUY · ${stats.sell_signals} SELL · ${stats.hold_signals} HOLD`}
          />
          <StatCard
            label="Avg Confidence"
            value={`${(stats.avg_confidence * 100).toFixed(1)}%`}
            color="text-blue-400"
          />
          <StatCard
            label="Orders Placed"
            value={stats.orders_placed}
            sub={`${stats.orders_filled} filled · ${stats.orders_rejected} rejected`}
            color="text-green-400"
          />
          <StatCard
            label="Win Rate"
            value={stats.win_rate != null ? `${(stats.win_rate * 100).toFixed(1)}%` : "—"}
            sub={`${stats.symbols_tracked} symbols tracked`}
            color="text-purple-400"
          />
        </div>
      ) : null}

      {/* Filter row */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-zinc-400">Filter by symbol:</label>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All symbols</option>
          {symbols.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="text-xs text-zinc-500 ml-auto">
          {decisions.length} decisions
        </span>
      </div>

      {/* Decision list */}
      {decisionsLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 animate-pulse h-16" />
          ))}
        </div>
      ) : decisions.length === 0 ? (
        <div className="text-center py-20 text-zinc-500">
          <Brain className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No decisions yet</p>
          <p className="text-sm">The AI hasn&apos;t run any signal cycles yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {decisions.map((d) => (
            <DecisionCard key={d.id} decision={d} />
          ))}
        </div>
      )}
    </div>
  );
}
