"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { authApi, brokerApi, signalApi } from "@/lib/api";
import { fmtUsd, fmtPct, cn } from "@/lib/utils";
import SignalBadge from "@/components/SignalBadge";
import { Zap, AlertTriangle, ArrowRight, Bot, Users, Link2 } from "lucide-react";
import SortableTh, { SortState, toggleSort, sortRows } from "@/components/SortableTh";

function PnlBadge({ value }: { value: number }) {
  const isPos = value >= 0;
  return (
    <span className={cn("text-xs font-mono font-medium", isPos ? "text-buy" : "text-sell")}>
      {isPos ? "+" : ""}{fmtUsd(value)}
    </span>
  );
}

function PnlPctBadge({ value }: { value: number }) {
  const isPos = value >= 0;
  return (
    <span className={cn("text-xs font-mono", isPos ? "text-buy" : "text-sell")}>
      {isPos ? "+" : ""}{(value * 100).toFixed(2)}%
    </span>
  );
}

const STATUS_COLOR: Record<string, string> = {
  filled: "text-buy",
  submitted: "text-brand",
  pending_approval: "text-hold",
  rejected: "text-sell",
  cancelled: "text-gray-500",
};

type SignalSortKey = "symbol" | "signal_type" | "confidence" | "entry_price" | "target_price" | "pattern_detected";

export default function DashboardPage() {
  const [signalSort, setSignalSort] = useState<SortState<SignalSortKey>>(null);
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const { data: rawSignals = [] } = useQuery({
    queryKey: ["signals-dashboard"],
    queryFn: () => signalApi.list(6),
    refetchInterval: 60_000,
  });
  const signals = sortRows(rawSignals as any[], signalSort, (row, key) => row[key]);
  const { data: autoStatus } = useQuery({
    queryKey: ["automation-status"],
    queryFn: signalApi.automationStatus,
    retry: false,
    staleTime: 30_000,
  });

  const conn = connections[0];

  const { data: account } = useQuery({
    queryKey: ["account", conn?.id],
    queryFn: () => brokerApi.account(conn.id),
    enabled: !!conn,
    refetchInterval: 30_000,
  });

  const { data: positions = [] } = useQuery({
    queryKey: ["positions", conn?.id],
    queryFn: () => brokerApi.positions(conn.id),
    enabled: !!conn,
    refetchInterval: 30_000,
  });

  const { data: recentOrders = [] } = useQuery({
    queryKey: ["orders-recent"],
    queryFn: () => signalApi.orders(5, "today"),
    refetchInterval: 30_000,
  });

  const change = account
    ? parseFloat(account.equity) - parseFloat(account.last_equity)
    : 0;
  const changeIsPos = change >= 0;

  const autopilotOn = autoStatus?.config?.is_enabled;
  const todayFilled = autoStatus?.today?.filled ?? 0;
  const todayRejected = autoStatus?.today?.rejected ?? 0;
  const pendingApprovals = autoStatus?.today?.pending_approval ?? 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          {user && (
            <p className="text-xs text-gray-500 mt-0.5">
              {user.full_name || user.email}
            </p>
          )}
        </div>
        <Link href="/trade" className="btn-primary text-sm flex items-center gap-2">
          <ArrowRight size={14} />
          New Trade
        </Link>
      </div>

      {/* Portfolio metrics */}
      {account ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Total equity */}
          <div className="card">
            <p className="section-label mb-2">Portfolio Value</p>
            <p className="data-value text-gray-100">{fmtUsd(account.portfolio_value)}</p>
          </div>

          {/* Today's change */}
          <div className="card">
            <p className="section-label mb-2">Today's P&L</p>
            <p className={cn("data-value", changeIsPos ? "text-buy" : "text-sell")}>
              {changeIsPos ? "+" : ""}{fmtUsd(change)}
            </p>
            <p className={cn("text-xs font-mono mt-0.5", changeIsPos ? "text-buy/70" : "text-sell/70")}>
              {changeIsPos ? "+" : ""}
              {account.equity && account.last_equity
                ? ((change / parseFloat(account.last_equity)) * 100).toFixed(2)
                : "0.00"}%
            </p>
          </div>

          {/* Cash */}
          <div className="card">
            <p className="section-label mb-2">Cash</p>
            <p className="data-value text-gray-100">{fmtUsd(account.cash)}</p>
          </div>

          {/* Buying power */}
          <div className="card">
            <p className="section-label mb-2">Buying Power</p>
            <p className="data-value text-gray-100">{fmtUsd(account.buying_power)}</p>
          </div>
        </div>
      ) : (
        <div className="card text-center py-10">
          <p className="text-gray-400 mb-4">No broker connected</p>
          <Link href="/connections" className="btn-primary inline-flex items-center gap-2">
            <Link2 size={14} />
            Connect Broker
          </Link>
        </div>
      )}

      {/* Warnings */}
      {account?.pattern_day_trader && (
        <div className="alert-warn text-hold">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>Pattern Day Trader flag active — 3 round-trip limit per 5 days applies.</span>
        </div>
      )}
      {account?.trading_blocked && (
        <div className="alert-bad text-sell">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>Trading is blocked on this account.</span>
        </div>
      )}

      {/* Pending approvals alert */}
      {pendingApprovals > 0 && (
        <div className="alert-warn">
          <AlertTriangle size={16} className="text-hold shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="text-hold font-medium">{pendingApprovals} order{pendingApprovals !== 1 ? "s" : ""} pending approval</span>
          </div>
          <Link href="/trade" className="text-xs text-brand hover:underline shrink-0">Review →</Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Open Positions */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-sm uppercase tracking-wider text-gray-400">Open Positions</h2>
            <Link href="/positions" className="text-xs text-brand hover:underline">View all</Link>
          </div>

          {positions.length === 0 ? (
            <p className="text-gray-500 text-sm py-4 text-center">No open positions</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-800">
                  <th className="th">Symbol</th>
                  <th className="th">Side</th>
                  <th className="th text-right">Qty</th>
                  <th className="th text-right">Entry</th>
                  <th className="th text-right">Current</th>
                  <th className="th text-right">P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {(positions as any[]).map((p) => {
                  const pl = parseFloat(p.unrealized_pl);
                  const plPct = parseFloat(p.unrealized_plpc);
                  return (
                    <tr key={p.symbol} className="hover:bg-gray-800/30 transition-colors">
                      <td className="py-2.5 font-mono font-bold text-gray-100">{p.symbol}</td>
                      <td className="py-2.5">
                        <span className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded",
                          p.side === "long" ? "bg-buy/10 text-buy" : "bg-sell/10 text-sell"
                        )}>
                          {p.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-mono text-gray-300">{parseFloat(p.qty).toFixed(0)}</td>
                      <td className="py-2.5 text-right font-mono text-gray-400">{fmtUsd(p.avg_entry_price)}</td>
                      <td className="py-2.5 text-right font-mono text-gray-100">{fmtUsd(p.current_price)}</td>
                      <td className="py-2.5 text-right">
                        <div>
                          <PnlBadge value={pl} />
                        </div>
                        <div>
                          <PnlPctBadge value={plPct} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right column: Recent Orders + Automation */}
        <div className="space-y-4">
          {/* Recent orders */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm uppercase tracking-wider text-gray-400">Recent Fills</h2>
              <Link href="/positions" className="text-xs text-brand hover:underline">All orders</Link>
            </div>

            {recentOrders.length === 0 ? (
              <p className="text-gray-500 text-xs text-center py-4">No orders today</p>
            ) : (
              <div className="space-y-2">
                {(recentOrders as any[]).slice(0, 5).map((o) => (
                  <div key={o.id} className="flex items-center gap-2 py-1.5 border-b border-gray-800/50 last:border-0">
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0",
                      o.side === "buy" ? "bg-buy/10 text-buy" : "bg-sell/10 text-sell"
                    )}>
                      {o.side.toUpperCase()}
                    </span>
                    <span className="font-mono font-bold text-xs text-gray-100 shrink-0">{o.ticker}</span>
                    <span className="font-mono text-xs text-gray-500">{parseFloat(o.quantity || 0).toFixed(0)}sh</span>
                    <span className={cn("text-xs ml-auto", STATUS_COLOR[o.status] || "text-gray-400")}>
                      {o.status}
                    </span>
                    {o.is_automated ? (
                      <Bot size={11} className="text-gray-600 shrink-0" />
                    ) : (
                      <Users size={11} className="text-gray-600 shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Automation status */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm uppercase tracking-wider text-gray-400">Autopilot</h2>
              <Link href="/trade" className="text-xs text-brand hover:underline">Configure</Link>
            </div>

            <div className="flex items-center gap-2 mb-3">
              <span className={autopilotOn ? "dot-live" : "dot-off"} />
              <span className={cn("text-sm font-medium", autopilotOn ? "text-buy" : "text-gray-500")}>
                {autopilotOn ? "Active" : "Disabled"}
              </span>
            </div>

            {autoStatus && (
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg bg-gray-800/60 py-2">
                  <p className="text-lg font-mono font-semibold text-buy">{todayFilled}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">filled</p>
                </div>
                <div className="rounded-lg bg-gray-800/60 py-2">
                  <p className="text-lg font-mono font-semibold text-gray-400">{todayRejected}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">rejected</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Latest signals */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-brand" />
            <h2 className="font-semibold text-sm uppercase tracking-wider text-gray-400">Latest Signals</h2>
          </div>
          <Link href="/signals" className="text-xs text-brand hover:underline">View all →</Link>
        </div>

        {signals.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-6">
            No signals yet. Add tickers to watchlist to start.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-800">
                <SortableTh label="Symbol"     sortKey="symbol"            sort={signalSort} onSort={(k) => setSignalSort(toggleSort(signalSort, k))} />
                <SortableTh label="Signal"     sortKey="signal_type"       sort={signalSort} onSort={(k) => setSignalSort(toggleSort(signalSort, k))} />
                <SortableTh label="Confidence" sortKey="confidence"        sort={signalSort} onSort={(k) => setSignalSort(toggleSort(signalSort, k))} />
                <SortableTh label="Entry"      sortKey="entry_price"       sort={signalSort} onSort={(k) => setSignalSort(toggleSort(signalSort, k))} />
                <SortableTh label="Target"     sortKey="target_price"      sort={signalSort} onSort={(k) => setSignalSort(toggleSort(signalSort, k))} />
                <SortableTh label="Pattern"    sortKey="pattern_detected"  sort={signalSort} onSort={(k) => setSignalSort(toggleSort(signalSort, k))} className="hidden md:table-cell pb-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {(signals as any[]).map((s) => (
                <tr key={s.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-2.5 font-mono font-bold text-gray-100">{s.symbol}</td>
                  <td className="py-2.5"><SignalBadge type={s.signal_type} /></td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-12 bg-gray-800 rounded-full h-1">
                        <div
                          className={cn("h-1 rounded-full", {
                            "bg-buy": s.signal_type === "BUY",
                            "bg-sell": s.signal_type === "SELL",
                            "bg-hold": s.signal_type === "HOLD",
                          })}
                          style={{ width: fmtPct(s.confidence) }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-400">{fmtPct(s.confidence)}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right font-mono text-gray-300">{s.entry_price ? fmtUsd(s.entry_price) : "—"}</td>
                  <td className="py-2.5 text-right font-mono text-buy">{s.target_price ? fmtUsd(s.target_price) : "—"}</td>
                  <td className="py-2.5 text-gray-500 text-xs hidden md:table-cell">{s.pattern_detected || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
