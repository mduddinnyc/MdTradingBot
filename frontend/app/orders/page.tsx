"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { signalApi } from "@/lib/api";
import { fmtUsd, fmtPct } from "@/lib/utils";
import { cn } from "@/lib/utils";
import SortableTh, { SortState, toggleSort, sortRows } from "@/components/SortableTh";
import { Download } from "lucide-react";

const statusColor: Record<string, string> = {
  submitted: "text-brand",
  filled: "text-buy",
  rejected: "text-sell",
  cancelled: "text-gray-400",
  pending: "text-hold",
  pending_approval: "text-hold",
};

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
] as const;
type Period = (typeof PERIODS)[number]["key"];

const TYPE_FILTERS = [
  { key: "all", label: "All" },
  { key: "equity", label: "Stocks" },
  { key: "call", label: "Calls" },
  { key: "put", label: "Puts" },
] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number]["key"];

type SortKey =
  | "ticker" | "type" | "side" | "quantity" | "avg_fill_price" | "exit_price"
  | "pnl_usd" | "pnl_pct" | "stop_price" | "take_profit_price" | "status" | "is_automated" | "created_at";

function typeLabel(o: any): string {
  if (o.asset_type !== "option") return "STOCK";
  return (o.option_right || "option").toUpperCase();
}

function getSortValue(o: any, key: SortKey) {
  switch (key) {
    case "type": return typeLabel(o);
    case "created_at": return new Date(o.created_at).getTime();
    case "is_automated": return o.is_automated ? 1 : 0;
    default: return o[key];
  }
}

function TypeBadge({ order }: { order: any }) {
  if (order.asset_type !== "option") {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-700 text-gray-300">STOCK</span>;
  }
  const isCall = order.option_right === "call";
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isCall ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell"}`}>
      {(order.option_right || "OPT").toUpperCase()}
    </span>
  );
}

function exportCsv(rows: any[]) {
  const headers = ["Ticker", "Type", "Side", "Qty", "Entry", "Exit", "PnL_USD", "PnL_Pct", "Status", "Auto", "OpenedAt", "ClosedAt"];
  const lines = [headers.join(",")];
  for (const o of rows) {
    lines.push([
      o.ticker,
      typeLabel(o),
      o.side,
      o.quantity,
      o.avg_fill_price ?? "",
      o.exit_price ?? "",
      o.pnl_usd ?? "",
      o.pnl_pct != null ? (o.pnl_pct * 100).toFixed(2) : "",
      o.status,
      o.is_automated ? "auto" : "manual",
      new Date(o.created_at).toISOString(),
      o.closed_at ? new Date(o.closed_at).toISOString() : "",
    ].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `order-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function OrdersPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortState<SortKey>>(null);

  const { data: orders = [], isFetching } = useQuery({
    queryKey: ["orders", period],
    queryFn: () => signalApi.orders(200, period),
    refetchInterval: 30_000,
  });

  const filtered = orders.filter((o: any) => {
    if (typeFilter === "all") return true;
    if (typeFilter === "equity") return o.asset_type !== "option";
    return o.asset_type === "option" && o.option_right === typeFilter;
  });
  const displayed = sortRows(filtered, sort, getSortValue);
  const onSort = (key: SortKey) => setSort((s) => toggleSort(s, key));

  const closed = displayed.filter((o: any) => o.pnl_usd != null);
  const totalPnl = closed.reduce((sum: number, o: any) => sum + o.pnl_usd, 0);
  const winCount = closed.filter((o: any) => o.pnl_usd > 0).length;
  const winRate = closed.length ? winCount / closed.length : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Order History</h1>
        <span className="text-xs text-gray-400">{isFetching ? "Refreshing…" : `${orders.length} orders`}</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 mr-1">Range</span>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "px-3 py-1 rounded text-xs font-semibold transition-colors",
                period === p.key ? "bg-brand text-white" : "bg-gray-800 text-gray-400 hover:text-gray-200"
              )}
            >
              {p.label}
            </button>
          ))}
          <span className="text-xs text-gray-500 mx-2">Type</span>
          {TYPE_FILTERS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTypeFilter(t.key)}
              className={cn(
                "px-3 py-1 rounded text-xs font-semibold transition-colors",
                typeFilter === t.key ? "bg-brand text-white" : "bg-gray-800 text-gray-400 hover:text-gray-200"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => exportCsv(displayed)}
          disabled={displayed.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          <Download size={13} /> Export CSV
        </button>
      </div>

      {closed.length > 0 && (
        <div className="card flex items-center gap-8">
          <div>
            <p className="text-xs text-gray-500 mb-1">Total Realized P&L</p>
            <p className={cn("text-xl font-bold", totalPnl >= 0 ? "text-buy" : "text-sell")}>
              {totalPnl >= 0 ? "+" : ""}{fmtUsd(totalPnl)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Win Rate</p>
            <p className="text-xl font-bold">{winRate != null ? fmtPct(winRate) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Closed Trades</p>
            <p className="text-xl font-bold">{closed.length}</p>
          </div>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400">No orders yet.</p>
          <p className="text-sm text-gray-500 mt-1">Enable automation to see automated orders here.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-800">
                <SortableTh label="Ticker" sortKey="ticker" sort={sort} onSort={onSort} />
                <SortableTh label="Type" sortKey="type" sort={sort} onSort={onSort} />
                <SortableTh label="Side" sortKey="side" sort={sort} onSort={onSort} />
                <SortableTh label="Qty" sortKey="quantity" sort={sort} onSort={onSort} />
                <SortableTh label="Entry" sortKey="avg_fill_price" sort={sort} onSort={onSort} />
                <SortableTh label="Exit" sortKey="exit_price" sort={sort} onSort={onSort} />
                <SortableTh label="P&L $" sortKey="pnl_usd" sort={sort} onSort={onSort} />
                <SortableTh label="P&L %" sortKey="pnl_pct" sort={sort} onSort={onSort} />
                <SortableTh label="Stop" sortKey="stop_price" sort={sort} onSort={onSort} />
                <SortableTh label="Target" sortKey="take_profit_price" sort={sort} onSort={onSort} />
                <SortableTh label="Status" sortKey="status" sort={sort} onSort={onSort} />
                <SortableTh label="Auto" sortKey="is_automated" sort={sort} onSort={onSort} />
                <th className="pb-3">Reason</th>
                <SortableTh label="Time" sortKey="created_at" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {displayed.map((o: any) => (
                <tr key={o.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-2 font-mono font-bold">{o.ticker}</td>
                  <td className="py-2"><TypeBadge order={o} /></td>
                  <td className={cn("py-2 font-medium uppercase text-xs", o.side === "buy" ? "text-buy" : "text-sell")}>
                    {o.side}
                  </td>
                  <td className="py-2">{o.quantity}</td>
                  <td className="py-2">{o.avg_fill_price ? fmtUsd(o.avg_fill_price) : "—"}</td>
                  <td className="py-2">{o.exit_price ? fmtUsd(o.exit_price) : "—"}</td>
                  <td className={cn("py-2 font-semibold", o.pnl_usd == null ? "text-gray-500" : o.pnl_usd >= 0 ? "text-buy" : "text-sell")}>
                    {o.pnl_usd != null ? `${o.pnl_usd >= 0 ? "+" : ""}${fmtUsd(o.pnl_usd)}` : "—"}
                  </td>
                  <td className={cn("py-2 font-semibold", o.pnl_pct == null ? "text-gray-500" : o.pnl_pct >= 0 ? "text-buy" : "text-sell")}>
                    {o.pnl_pct != null ? `${o.pnl_pct >= 0 ? "+" : ""}${fmtPct(o.pnl_pct)}` : "—"}
                  </td>
                  <td className="py-2 text-sell text-xs">{o.stop_price ? fmtUsd(o.stop_price) : "—"}</td>
                  <td className="py-2 text-buy text-xs">{o.take_profit_price ? fmtUsd(o.take_profit_price) : "—"}</td>
                  <td className={cn("py-2 text-xs font-medium uppercase", statusColor[o.status] || "text-gray-400")}>
                    {o.status}
                  </td>
                  <td className="py-2 text-xs">{o.is_automated ? "🤖" : "Manual"}</td>
                  <td className="py-2 text-xs text-gray-400 max-w-xs truncate">{o.rejection_reason || "—"}</td>
                  <td className="py-2 text-xs text-gray-400 whitespace-nowrap">
                    {new Date(o.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
