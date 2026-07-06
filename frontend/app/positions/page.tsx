"use client";
import { useMemo, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { brokerApi, signalApi } from "@/lib/api";
import { fmtUsd, fmtPct, cn } from "@/lib/utils";
import { Download, ArrowUp, ArrowDown, ArrowUpDown, Check, X as XIcon } from "lucide-react";

type Tab = "open" | "history";

// ── Helpers ─────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  submitted:        "text-brand",
  filled:           "text-buy",
  rejected:         "text-sell",
  cancelled:        "text-gray-500",
  pending:          "text-hold",
  pending_approval: "text-hold",
};

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d",    label: "7D" },
  { key: "30d",   label: "30D" },
  { key: "1y",    label: "1Y" },
  { key: "all",   label: "All" },
] as const;
type Period = (typeof PERIODS)[number]["key"];

function TypeBadge({ order }: { order: any }) {
  if (order.asset_type !== "option") {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-700 text-gray-300">STOCK</span>;
  }
  const isCall = order.option_right === "call";
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", isCall ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell")}>
      {(order.option_right || "OPT").toUpperCase()}
    </span>
  );
}

// ── Open Positions panel ─────────────────────────────────────
function OpenPositions() {
  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const conn = (connections as any[])[0];

  const { data: positions = [], isLoading } = useQuery({
    queryKey: ["positions", conn?.id],
    queryFn: () => brokerApi.positions(conn.id),
    enabled: !!conn,
    refetchInterval: 30_000,
  });

  if (!conn) {
    return (
      <div className="card text-center py-10">
        <p className="text-gray-400">No broker connected.</p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="card text-center py-10 text-gray-500 text-sm">Loading positions…</div>;
  }

  if ((positions as any[]).length === 0) {
    return <div className="card text-center py-10 text-gray-500 text-sm">No open positions</div>;
  }

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-gray-800">
            <th className="th pl-5">Symbol</th>
            <th className="th">Side</th>
            <th className="th text-right">Qty</th>
            <th className="th text-right">Avg Entry</th>
            <th className="th text-right">Current</th>
            <th className="th text-right">Market Value</th>
            <th className="th text-right pr-5">Unrealized P&L</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {(positions as any[]).map((p) => {
            const pl = parseFloat(p.unrealized_pl);
            const plPct = parseFloat(p.unrealized_plpc);
            const isPos = pl >= 0;
            return (
              <tr key={p.symbol} className="hover:bg-gray-800/20 transition-colors">
                <td className="py-3 pl-5 font-mono font-bold text-gray-100">{p.symbol}</td>
                <td className="py-3">
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded",
                    p.side === "long" ? "bg-buy/10 text-buy" : "bg-sell/10 text-sell"
                  )}>
                    {p.side.toUpperCase()}
                  </span>
                </td>
                <td className="py-3 text-right font-mono text-gray-300">
                  {parseFloat(p.qty).toFixed(0)}
                </td>
                <td className="py-3 text-right font-mono text-gray-400">
                  {fmtUsd(p.avg_entry_price)}
                </td>
                <td className="py-3 text-right font-mono text-gray-100">
                  {fmtUsd(p.current_price)}
                </td>
                <td className="py-3 text-right font-mono text-gray-300">
                  {fmtUsd(p.market_value)}
                </td>
                <td className="py-3 text-right pr-5">
                  <span className={cn("font-mono font-medium", isPos ? "text-buy" : "text-sell")}>
                    {isPos ? "+" : ""}{fmtUsd(pl)}
                  </span>
                  <br />
                  <span className={cn("text-xs font-mono", isPos ? "text-buy/70" : "text-sell/70")}>
                    {isPos ? "+" : ""}{(plPct * 100).toFixed(2)}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Order History panel ──────────────────────────────────────
function OrderHistory() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>("7d");
  const [sorting, setSorting] = useState<SortingState>([{ id: "time", desc: true }]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: rawOrders = [], isFetching } = useQuery({
    queryKey: ["orders", period],
    queryFn: () => signalApi.orders(200, period),
    refetchInterval: 60_000,
  });

  const orders = rawOrders as any[];

  function exportCsv() {
    const headers = ["Ticker", "Type", "Side", "Qty", "Entry", "Exit", "PnL", "Status", "Auto", "Strategy", "Time"];
    const lines = [headers.join(",")];
    for (const o of orders) {
      lines.push([
        o.ticker,
        o.asset_type === "option" ? (o.option_right || "OPT").toUpperCase() : "STOCK",
        o.side,
        o.quantity,
        o.avg_fill_price ?? "",
        o.exit_price ?? "",
        o.realized_pnl ?? "",
        o.status,
        o.is_automated ? "Auto" : "Manual",
        o.strategy_name ?? "",
        o.created_at,
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `orders-${period}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const approveMut = useMutation({
    mutationFn: (id: string) => signalApi.approveOrder(id),
    onMutate: (id) => setBusyId(id),
    onSettled: () => { setBusyId(null); qc.invalidateQueries({ queryKey: ["orders"] }); },
  });
  const rejectMut = useMutation({
    mutationFn: (id: string) => signalApi.rejectOrder(id),
    onMutate: (id) => setBusyId(id),
    onSettled: () => { setBusyId(null); qc.invalidateQueries({ queryKey: ["orders"] }); },
  });

  const columns = useMemo<ColumnDef<any>[]>(() => [
    {
      id: "ticker",
      header: "Ticker",
      accessorKey: "ticker",
      cell: ({ row }) => (
        <span className="font-mono font-bold text-gray-100">{row.original.ticker}</span>
      ),
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => <TypeBadge order={row.original} />,
      sortingFn: (a, b) => {
        const ta = a.original.asset_type === "option" ? a.original.option_right : "stock";
        const tb = b.original.asset_type === "option" ? b.original.option_right : "stock";
        return ta.localeCompare(tb);
      },
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      cell: ({ row }) => (
        <span className={cn(
          "text-[10px] font-bold px-1.5 py-0.5 rounded",
          row.original.side === "buy" ? "bg-buy/10 text-buy" : "bg-sell/10 text-sell"
        )}>
          {row.original.side?.toUpperCase()}
        </span>
      ),
    },
    {
      id: "quantity",
      header: "Qty",
      accessorKey: "quantity",
      cell: ({ getValue }) => <span className="font-mono text-gray-300">{parseFloat(String(getValue() || 0)).toFixed(0)}</span>,
    },
    {
      id: "entry",
      header: "Entry",
      accessorFn: (row) => row.avg_fill_price,
      cell: ({ getValue }) => <span className="font-mono text-gray-300">{getValue() ? fmtUsd(getValue() as number) : "—"}</span>,
    },
    {
      id: "exit",
      header: "Exit",
      accessorFn: (row) => row.exit_price,
      cell: ({ getValue }) => <span className="font-mono text-gray-400">{getValue() ? fmtUsd(getValue() as number) : "—"}</span>,
    },
    {
      id: "pnl",
      header: "P&L",
      accessorFn: (row) => row.realized_pnl,
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        if (v == null) return <span className="text-gray-600">—</span>;
        const isPos = v >= 0;
        return (
          <span className={cn("font-mono font-medium text-xs", isPos ? "text-buy" : "text-sell")}>
            {isPos ? "+" : ""}{fmtUsd(v)}
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => {
        const o = row.original;
        const color = STATUS_COLOR[o.status] || "text-gray-400";
        if (o.status === "pending_approval") {
          return (
            <div className="flex items-center gap-1.5">
              <span className="text-hold text-xs">Pending</span>
              <button disabled={busyId === o.id} onClick={() => approveMut.mutate(o.id)}
                className="p-0.5 rounded bg-buy/10 text-buy hover:bg-buy/20 disabled:opacity-50">
                <Check size={11} />
              </button>
              <button disabled={busyId === o.id} onClick={() => rejectMut.mutate(o.id)}
                className="p-0.5 rounded bg-sell/10 text-sell hover:bg-sell/20 disabled:opacity-50">
                <XIcon size={11} />
              </button>
            </div>
          );
        }
        return <span className={cn("text-xs capitalize", color)}>{o.status}</span>;
      },
    },
    {
      id: "source",
      header: "Source",
      cell: ({ row }) => (
        <span className="text-xs text-gray-500">
          {row.original.is_automated ? "Auto" : "Manual"}
        </span>
      ),
    },
    {
      id: "strategy",
      header: "Strategy",
      accessorFn: (row) => row.strategy_name,
      cell: ({ getValue }) => (
        <span className="text-xs text-gray-500">{(getValue() as string) || "—"}</span>
      ),
    },
    {
      id: "time",
      header: "Time",
      accessorFn: (row) => new Date(row.created_at).getTime(),
      cell: ({ row }) => (
        <span className="text-xs font-mono text-gray-500">
          {new Date(row.original.created_at).toLocaleString([], {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}
        </span>
      ),
    },
  ], [busyId]);

  const table = useReactTable({
    data: orders,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg bg-gray-800/60 p-0.5 gap-0.5">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={cn("px-3 py-1 text-xs font-medium rounded-md transition-all",
                period === p.key ? "bg-gray-700 text-gray-100" : "text-gray-500 hover:text-gray-200")}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-600">{orders.length} orders</span>
        <button onClick={exportCsv} className="ml-auto flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200">
          <Download size={13} />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-800">
              {table.getFlatHeaders().map((header) => (
                <th
                  key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                  className={cn("th pl-5 last:pr-5", header.column.getCanSort() && "cursor-pointer select-none")}
                >
                  <div className="flex items-center gap-1">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanSort() && (
                      header.column.getIsSorted() === "asc" ? <ArrowUp size={10} className="text-brand" /> :
                      header.column.getIsSorted() === "desc" ? <ArrowDown size={10} className="text-brand" /> :
                      <ArrowUpDown size={10} className="text-gray-600" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-10 text-center text-gray-500 text-sm">
                  No orders for this period
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-800/20 transition-colors">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="py-2.5 pl-5 last:pr-5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────
export default function PositionsPage() {
  const [tab, setTab] = useState<Tab>("open");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Positions</h1>
      </div>

      <div className="tabs mb-4">
        <button onClick={() => setTab("open")} className={cn("tab", tab === "open" && "tab-active")}>
          Open Positions
        </button>
        <button onClick={() => setTab("history")} className={cn("tab", tab === "history" && "tab-active")}>
          Order History
        </button>
      </div>

      {tab === "open" ? <OpenPositions /> : <OrderHistory />}
    </div>
  );
}
