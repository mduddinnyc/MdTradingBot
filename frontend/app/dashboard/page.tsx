"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authApi, brokerApi, signalApi } from "@/lib/api";
import { fmtUsd, fmtPct, cn } from "@/lib/utils";
import SignalBadge from "@/components/SignalBadge";
import SortableTh, { SortState, toggleSort, sortRows } from "@/components/SortableTh";
import Link from "next/link";

type SignalSortKey = "symbol" | "signal_type" | "confidence" | "entry_price" | "target_price" | "pattern_detected";

export default function DashboardPage() {
  const { data: user } = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const { data: signals = [] } = useQuery({ queryKey: ["signals"], queryFn: () => signalApi.list(10) });
  const [sort, setSort] = useState<SortState<SignalSortKey>>(null);
  const sortedSignals = sortRows(signals, sort, (row, key) => row[key]);

  const conn = connections[0];
  const { data: account } = useQuery({
    queryKey: ["account", conn?.id],
    queryFn: () => brokerApi.account(conn.id),
    enabled: !!conn,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {user && <p className="text-gray-400 text-sm mt-1">Welcome back, {user.full_name || user.email}</p>}
      </div>

      {/* Account Overview */}
      {account ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(() => {
            const change = parseFloat(account.equity) - parseFloat(account.last_equity);
            return [
              { label: "Portfolio Value", value: fmtUsd(account.portfolio_value), color: "" },
              { label: "Cash", value: fmtUsd(account.cash), color: "" },
              { label: "Buying Power", value: fmtUsd(account.buying_power), color: "" },
              { label: "Today's Change", value: (change >= 0 ? "+" : "") + fmtUsd(change), color: change >= 0 ? "text-buy" : "text-sell" },
            ].map(({ label, value, color }) => (
              <div key={label} className="card">
                <p className="section-label mb-2">{label}</p>
                <p className={cn("data-value", color || "text-gray-100")}>{value}</p>
              </div>
            ));
          })()}
        </div>
      ) : (
        <div className="card text-center py-8">
          <p className="text-gray-400 mb-3">No broker connected</p>
          <Link href="/watchlist" className="btn-primary inline-block">Connect Broker</Link>
        </div>
      )}

      {/* Recent signals */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Latest Signals</h2>
          <Link href="/signals" className="text-brand text-sm hover:underline">View all</Link>
        </div>

        {signals.length === 0 ? (
          <p className="text-gray-400 text-sm">No signals yet. Add tickers to your watchlist.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-800">
                <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={(k) => setSort(toggleSort(sort, k))} />
                <SortableTh label="Signal" sortKey="signal_type" sort={sort} onSort={(k) => setSort(toggleSort(sort, k))} />
                <SortableTh label="Confidence" sortKey="confidence" sort={sort} onSort={(k) => setSort(toggleSort(sort, k))} />
                <SortableTh label="Entry" sortKey="entry_price" sort={sort} onSort={(k) => setSort(toggleSort(sort, k))} />
                <SortableTh label="Target" sortKey="target_price" sort={sort} onSort={(k) => setSort(toggleSort(sort, k))} />
                <SortableTh label="Pattern" sortKey="pattern_detected" sort={sort} onSort={(k) => setSort(toggleSort(sort, k))} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {sortedSignals.map((s: any) => (
                <tr key={s.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-2 font-mono font-bold">{s.symbol}</td>
                  <td className="py-2"><SignalBadge type={s.signal_type} /></td>
                  <td className="py-2 font-mono text-xs">{fmtPct(s.confidence)}</td>
                  <td className="py-2 font-mono">{s.entry_price ? fmtUsd(s.entry_price) : "—"}</td>
                  <td className="py-2 font-mono text-buy">{s.target_price ? fmtUsd(s.target_price) : "—"}</td>
                  <td className="py-2 text-gray-400 text-xs">{s.pattern_detected || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Account status warnings */}
      {account?.pattern_day_trader && (
        <div className="card border-hold/30 bg-hold/5">
          <p className="text-hold text-sm font-medium">Pattern Day Trader flag active on this account.</p>
        </div>
      )}
      {account?.trading_blocked && (
        <div className="card border-sell/30 bg-sell/5">
          <p className="text-sell text-sm font-medium">Trading is blocked on this account. Check Alpaca dashboard.</p>
        </div>
      )}
    </div>
  );
}
