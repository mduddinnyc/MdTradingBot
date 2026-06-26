"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnOrderState,
  type VisibilityState,
} from "@tanstack/react-table";
import { signalApi } from "@/lib/api";
import { fmtUsd, fmtPct, cn } from "@/lib/utils";
import { Download, ArrowUp, ArrowDown, ArrowUpDown, Settings2, RotateCcw, GripVertical, Check, X as XIcon } from "lucide-react";

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

const LAYOUT_KEY = "orders-table-layout-v1";

type OrdersTableMeta = {
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busyId: string | null;
};

const DEFAULT_ORDER = [
  "ticker", "type", "side", "quantity", "entry", "exit", "pnl_usd", "pnl_pct",
  "stop", "target", "status", "action", "auto", "reason", "time",
];
const DEFAULT_VISIBILITY: VisibilityState = {};

function loadLayout(): { order: ColumnOrderState; visibility: VisibilityState; sizing: Record<string, number> } {
  if (typeof window === "undefined") return { order: DEFAULT_ORDER, visibility: DEFAULT_VISIBILITY, sizing: {} };
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { order: DEFAULT_ORDER, visibility: DEFAULT_VISIBILITY, sizing: {} };
    const parsed = JSON.parse(raw);
    return {
      order: parsed.order?.length ? parsed.order : DEFAULT_ORDER,
      visibility: parsed.visibility || DEFAULT_VISIBILITY,
      sizing: parsed.sizing || {},
    };
  } catch {
    return { order: DEFAULT_ORDER, visibility: DEFAULT_VISIBILITY, sizing: {} };
  }
}

function typeLabel(o: any): string {
  if (o.asset_type !== "option") return "STOCK";
  return (o.option_right || "option").toUpperCase();
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

const COLUMN_LABELS: Record<string, string> = {
  ticker: "Ticker", type: "Type", side: "Side", quantity: "Qty", entry: "Entry", exit: "Exit",
  pnl_usd: "P&L $", pnl_pct: "P&L %", stop: "Stop", target: "Target", status: "Status",
  action: "Action", auto: "Auto", reason: "Reason", time: "Time",
};

const baseColumns: ColumnDef<any>[] = [
  {
    id: "ticker", header: "Ticker", accessorKey: "ticker", size: 90,
    cell: (c) => <span className="font-mono font-bold">{c.row.original.ticker}</span>,
  },
  {
    id: "type", header: "Type", accessorFn: typeLabel, size: 80,
    cell: (c) => <TypeBadge order={c.row.original} />,
  },
  {
    id: "side", header: "Side", accessorKey: "side", size: 70,
    cell: (c) => (
      <span className={cn("font-medium uppercase text-xs", c.row.original.side === "buy" ? "text-buy" : "text-sell")}>
        {c.row.original.side}
      </span>
    ),
  },
  { id: "quantity", header: "Qty", accessorKey: "quantity", size: 60 },
  {
    id: "entry", header: "Entry", accessorKey: "avg_fill_price", size: 90,
    cell: (c) => (c.row.original.avg_fill_price ? fmtUsd(c.row.original.avg_fill_price) : "—"),
  },
  {
    id: "exit", header: "Exit", accessorKey: "exit_price", size: 90,
    cell: (c) => (c.row.original.exit_price ? fmtUsd(c.row.original.exit_price) : "—"),
  },
  {
    id: "pnl_usd", header: "P&L $", accessorKey: "pnl_usd", size: 100,
    cell: (c) => {
      const v = c.row.original.pnl_usd;
      return (
        <span className={cn("font-semibold", v == null ? "text-gray-500" : v >= 0 ? "text-buy" : "text-sell")}>
          {v != null ? `${v >= 0 ? "+" : ""}${fmtUsd(v)}` : "—"}
        </span>
      );
    },
  },
  {
    id: "pnl_pct", header: "P&L %", accessorKey: "pnl_pct", size: 90,
    cell: (c) => {
      const v = c.row.original.pnl_pct;
      return (
        <span className={cn("font-semibold", v == null ? "text-gray-500" : v >= 0 ? "text-buy" : "text-sell")}>
          {v != null ? `${v >= 0 ? "+" : ""}${fmtPct(v)}` : "—"}
        </span>
      );
    },
  },
  {
    id: "stop", header: "Stop", accessorKey: "stop_price", size: 90,
    cell: (c) => <span className="text-sell text-xs">{c.row.original.stop_price ? fmtUsd(c.row.original.stop_price) : "—"}</span>,
  },
  {
    id: "target", header: "Target", accessorKey: "take_profit_price", size: 90,
    cell: (c) => <span className="text-buy text-xs">{c.row.original.take_profit_price ? fmtUsd(c.row.original.take_profit_price) : "—"}</span>,
  },
  {
    id: "status", header: "Status", accessorKey: "status", size: 140,
    cell: (c) => (
      <span className={cn("text-xs font-medium uppercase", statusColor[c.row.original.status] || "text-gray-400")}>
        {c.row.original.status}
      </span>
    ),
  },
  {
    id: "action", header: "Action", size: 140, enableSorting: false,
    cell: (c) => {
      const o = c.row.original;
      if (o.status !== "pending_approval") return <span className="text-gray-600 text-xs">—</span>;
      const meta = c.table.options.meta as OrdersTableMeta;
      const busy = meta.busyId === o.id;
      return (
        <div className="flex gap-1.5">
          <button
            onClick={() => meta.onApprove(o.id)}
            disabled={busy}
            className="flex items-center gap-1 px-2 py-1 rounded bg-buy text-white text-[11px] font-semibold hover:bg-buy/80 disabled:opacity-50"
          >
            <Check size={11} /> Approve
          </button>
          <button
            onClick={() => meta.onReject(o.id)}
            disabled={busy}
            className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-gray-200 text-[11px] font-semibold hover:bg-gray-600 disabled:opacity-50"
          >
            <XIcon size={11} />
          </button>
        </div>
      );
    },
  },
  {
    id: "auto", header: "Auto", accessorFn: (o) => (o.is_automated ? 1 : 0), size: 60,
    cell: (c) => <span className="text-xs">{c.row.original.is_automated ? "🤖" : "Manual"}</span>,
  },
  {
    id: "reason", header: "Reason", accessorKey: "rejection_reason", size: 220,
    cell: (c) => {
      const reason = c.row.original.rejection_reason;
      return (
        <span className="text-xs text-gray-400 block truncate" title={reason || undefined}>
          {reason || "—"}
        </span>
      );
    },
  },
  {
    id: "time", header: "Time", accessorKey: "created_at", size: 150,
    cell: (c) => (
      <span className="text-xs text-gray-400 whitespace-nowrap">{new Date(c.row.original.created_at).toLocaleString()}</span>
    ),
  },
];

export default function OrdersPage() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(DEFAULT_ORDER);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(DEFAULT_VISIBILITY);
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>({});
  const [draggedCol, setDraggedCol] = useState<string | null>(null);

  useEffect(() => {
    const layout = loadLayout();
    setColumnOrder(layout.order);
    setColumnVisibility(layout.visibility);
    setColumnSizing(layout.sizing);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ order: columnOrder, visibility: columnVisibility, sizing: columnSizing }));
  }, [columnOrder, columnVisibility, columnSizing]);

  const { data: orders = [], isFetching } = useQuery({
    queryKey: ["orders", period],
    queryFn: () => signalApi.orders(200, period),
    refetchInterval: 30_000,
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => signalApi.approveOptionOrder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });
  const rejectMut = useMutation({
    mutationFn: (id: string) => signalApi.rejectOptionOrder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });
  const busyPending = approveMut.isPending || rejectMut.isPending;
  const busyId = busyPending ? (approveMut.variables ?? rejectMut.variables ?? null) : null;

  const filtered = useMemo(
    () =>
      orders.filter((o: any) => {
        if (typeFilter === "all") return true;
        if (typeFilter === "equity") return o.asset_type !== "option";
        return o.asset_type === "option" && o.option_right === typeFilter;
      }),
    [orders, typeFilter]
  );

  const table = useReactTable({
    data: filtered,
    columns: baseColumns,
    state: { sorting, columnOrder, columnVisibility, columnSizing },
    onSortingChange: setSorting,
    onColumnOrderChange: setColumnOrder,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    meta: {
      onApprove: (id: string) => approveMut.mutate(id),
      onReject: (id: string) => rejectMut.mutate(id),
      busyId,
    } satisfies OrdersTableMeta,
  });

  const closed = filtered.filter((o: any) => o.pnl_usd != null);
  const totalPnl = closed.reduce((sum: number, o: any) => sum + o.pnl_usd, 0);
  const winCount = closed.filter((o: any) => o.pnl_usd > 0).length;
  const winRate = closed.length ? winCount / closed.length : null;

  function resetLayout() {
    setColumnOrder(DEFAULT_ORDER);
    setColumnVisibility(DEFAULT_VISIBILITY);
    setColumnSizing({});
    window.localStorage.removeItem(LAYOUT_KEY);
  }

  function moveColumn(dragged: string, target: string) {
    if (dragged === target) return;
    setColumnOrder((old) => {
      const next = [...old];
      const from = next.indexOf(dragged);
      const to = next.indexOf(target);
      if (from === -1 || to === -1) return old;
      next.splice(from, 1);
      next.splice(to, 0, dragged);
      return next;
    });
  }

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
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className="list-none flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors cursor-pointer select-none">
              <Settings2 size={13} /> Columns
            </summary>
            <div className="absolute right-0 mt-2 w-52 card z-20 space-y-1 p-3">
              {DEFAULT_ORDER.map((id) => {
                const col = table.getColumn(id);
                if (!col) return null;
                return (
                  <label key={id} className="flex items-center gap-2 text-xs text-gray-300 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={col.getIsVisible()}
                      onChange={col.getToggleVisibilityHandler()}
                    />
                    {COLUMN_LABELS[id]}
                  </label>
                );
              })}
              <button
                onClick={resetLayout}
                className="w-full flex items-center justify-center gap-1.5 mt-2 pt-2 border-t border-gray-800 text-xs text-gray-400 hover:text-gray-200"
              >
                <RotateCcw size={12} /> Reset layout
              </button>
            </div>
          </details>
          <button
            onClick={() => exportCsv(table.getSortedRowModel().rows.map((r) => r.original))}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            <Download size={13} /> Export CSV
          </button>
        </div>
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
          <table className="text-sm" style={{ width: table.getTotalSize(), tableLayout: "fixed" }}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="text-gray-400 text-left border-b border-gray-800">
                  {headerGroup.headers.map((header) => {
                    const sortDir = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        style={{ width: header.getSize() }}
                        className={cn("relative pb-3 pr-2 select-none", draggedCol === header.column.id && "opacity-40")}
                        draggable
                        onDragStart={() => setDraggedCol(header.column.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedCol) moveColumn(draggedCol, header.column.id);
                          setDraggedCol(null);
                        }}
                        onDragEnd={() => setDraggedCol(null)}
                      >
                        <div className="flex items-center gap-1 cursor-grab active:cursor-grabbing">
                          <GripVertical size={11} className="text-gray-600 shrink-0" />
                          <button
                            onClick={header.column.getToggleSortingHandler()}
                            className="flex items-center gap-1 hover:text-gray-200 transition-colors truncate"
                          >
                            <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            {sortDir === "asc" ? <ArrowUp size={12} className="shrink-0" />
                              : sortDir === "desc" ? <ArrowDown size={12} className="shrink-0" />
                              : <ArrowUpDown size={12} className="text-gray-600 shrink-0" />}
                          </button>
                        </div>
                        <div
                          onMouseDown={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                          onTouchStart={(e) => { e.stopPropagation(); header.getResizeHandler()(e); }}
                          draggable={false}
                          className={cn(
                            "absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-brand/50 transition-colors",
                            header.column.getIsResizing() && "bg-brand"
                          )}
                        />
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {table.getSortedRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-800/30 transition-colors">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} style={{ width: cell.column.getSize() }} className="py-2 pr-2 overflow-hidden">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
