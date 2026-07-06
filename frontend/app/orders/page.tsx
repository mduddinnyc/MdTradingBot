"use client";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { signalApi } from "@/lib/api";
import { fmtUsd, cn } from "@/lib/utils";
import { Download, ArrowUp, ArrowDown, ArrowUpDown, Check, X as XIcon } from "lucide-react";

// ── Types ────────────────────────────────────────────────────
type Period = "today" | "7d" | "30d" | "1y" | "all";
type AssetFilter = "All" | "Stocks" | "Options";
type SourceFilter = "All" | "Auto" | "Manual";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d",    label: "7D" },
  { key: "30d",   label: "30D" },
  { key: "1y",    label: "1Y" },
  { key: "all",   label: "All" },
];

const STATUS_COLOR: Record<string, string> = {
  submitted:        "text-brand",
  filled:           "text-buy",
  rejected:         "text-sell",
  cancelled:        "text-gray-500",
  pending:          "text-hold",
  pending_approval: "text-hold",
};

// ── TypeBadge ────────────────────────────────────────────────
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

// ── Mini P&L SVG Bar Chart ───────────────────────────────────
function PnlChart({ orders }: { orders: any[] }) {
  const CHART_H = 120;
  const CHART_W = 600;
  const BAR_GAP = 4;
  const LABEL_H = 20;
  const PLOT_H = CHART_H - LABEL_H;

  const byDay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of orders) {
      if (!o.created_at) continue;
      const day = o.created_at.slice(0, 10);
      const pnl = parseFloat(o.realized_pnl ?? "0") || 0;
      map[day] = (map[day] ?? 0) + pnl;
    }
    const sorted = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
    return sorted.slice(-14);
  }, [orders]);

  const hasData = byDay.some(([, v]) => v !== 0);

  if (!hasData) {
    return (
      <div className="card flex items-center justify-center h-[120px] text-gray-600 text-sm">
        No closed P&amp;L data yet
      </div>
    );
  }

  const maxAbs = Math.max(...byDay.map(([, v]) => Math.abs(v)), 1);
  const n = byDay.length;
  const barW = Math.floor((CHART_W - BAR_GAP * (n + 1)) / n);
  const midY = PLOT_H / 2;

  return (
    <div className="card p-3 overflow-x-auto">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        width="100%"
        style={{ maxWidth: CHART_W, display: "block" }}
        aria-label="Daily realized P&L chart"
      >
        <line x1={0} y1={midY} x2={CHART_W} y2={midY} stroke="#374151" strokeWidth={1} />
        {byDay.map(([day, pnl], i) => {
          const x = BAR_GAP + i * (barW + BAR_GAP);
          const barH = Math.max(2, Math.abs(pnl) / maxAbs * (midY - 4));
          const isPos = pnl >= 0;
          const barY = isPos ? midY - barH : midY;
          const fill = isPos ? "#10D987" : "#FF4D6D";
          const dateObj = new Date(day + "T00:00:00");
          const label = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          return (
            <g key={day}>
              <rect x={x} y={barY} width={barW} height={barH} fill={fill} rx={2} opacity={0.85} />
              <text
                x={x + barW / 2}
                y={CHART_H - 2}
                textAnchor="middle"
                fontSize={9}
                fill="#6B7280"
                fontFamily="IBM Plex Mono, monospace"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Filter Button Group ──────────────────────────────────────
function FilterGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg bg-gray-800/60 p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            "px-3 py-1 text-xs font-medium rounded-md transition-all",
            value === opt ? "bg-gray-700 text-gray-100" : "text-gray-500 hover:text-gray-200"
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ── Orders Page ──────────────────────────────────────────────
export default function OrdersPage() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>("7d");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("All");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("All");
  const [sorting, setSorting] = useState<SortingState>([{ id: "time", desc: true }]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: rawOrders = [] } = useQuery({
    queryKey: ["orders", period],
    queryFn: () => signalApi.orders(200, period),
    refetchInterval: 60_000,
  });

  const orders = rawOrders as any[];

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (assetFilter === "Stocks" && o.asset_type === "option") return false;
      if (assetFilter === "Options" && o.asset_type !== "option") return false;
      if (sourceFilter === "Auto" && !o.is_automated) return false;
      if (sourceFilter === "Manual" && o.is_automated) return false;
      return true;
    });
  }, [orders, assetFilter, sourceFilter]);

  function exportCsv() {
    const headers = ["Ticker", "Type", "Side", "Qty", "Entry", "Exit", "PnL", "Status", "Auto", "Strategy", "Time"];
    const lines = [headers.join(",")];
    for (const o of filtered) {
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
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${period}.csv`;
    a.click();
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
      cell: ({ getValue }) => (
        <span className="font-mono font-bold text-gray-100">{getValue() as string}</span>
      ),
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => <TypeBadge order={row.original} />,
      sortingFn: (a, b) => {
        const ta = a.original.asset_type === "option" ? a.original.option_right ?? "option" : "stock";
        const tb = b.original.asset_type === "option" ? b.original.option_right ?? "option" : "stock";
        return ta.localeCompare(tb);
      },
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      cell: ({ getValue }) => {
        const side = getValue() as string;
        return (
          <span className={cn(
            "text-[10px] font-bold px-1.5 py-0.5 rounded",
            side === "buy" ? "bg-buy/10 text-buy" : "bg-sell/10 text-sell"
          )}>
            {side?.toUpperCase()}
          </span>
        );
      },
    },
    {
      id: "quantity",
      header: "Qty",
      accessorKey: "quantity",
      cell: ({ getValue }) => (
        <span className="font-mono text-gray-300">{parseFloat(String(getValue() ?? 0)).toFixed(0)}</span>
      ),
    },
    {
      id: "entry",
      header: "Entry",
      accessorFn: (row) => row.avg_fill_price,
      cell: ({ getValue }) => (
        <span className="font-mono text-gray-300">{getValue() ? fmtUsd(getValue() as number) : "—"}</span>
      ),
    },
    {
      id: "exit",
      header: "Exit",
      accessorFn: (row) => row.exit_price,
      cell: ({ getValue }) => (
        <span className="font-mono text-gray-400">{getValue() ? fmtUsd(getValue() as number) : "—"}</span>
      ),
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
              <button
                disabled={busyId === o.id}
                onClick={() => approveMut.mutate(o.id)}
                aria-label="Approve"
                className="p-0.5 rounded bg-buy/10 text-buy hover:bg-buy/20 disabled:opacity-50"
              >
                <Check size={11} />
              </button>
              <button
                disabled={busyId === o.id}
                onClick={() => rejectMut.mutate(o.id)}
                aria-label="Reject"
                className="p-0.5 rounded bg-sell/10 text-sell hover:bg-sell/20 disabled:opacity-50"
              >
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
      sortingFn: (a, b) => {
        return (a.original.is_automated ? 1 : 0) - (b.original.is_automated ? 1 : 0);
      },
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
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Order History</h1>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200"
        >
          <Download size={13} /> Export CSV
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg bg-gray-800/60 p-0.5 gap-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                period === p.key ? "bg-gray-700 text-gray-100" : "text-gray-500 hover:text-gray-200"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <FilterGroup<AssetFilter>
          options={["All", "Stocks", "Options"]}
          value={assetFilter}
          onChange={setAssetFilter}
        />

        <FilterGroup<SourceFilter>
          options={["All", "Auto", "Manual"]}
          value={sourceFilter}
          onChange={setSourceFilter}
        />

        <span className="text-xs text-gray-600">{filtered.length} orders</span>
      </div>

      {/* Mini P&L chart */}
      <PnlChart orders={filtered} />

      {/* Table */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-800">
              {table.getFlatHeaders().map((header) => (
                <th
                  key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                  className={cn(
                    "th pl-5 last:pr-5",
                    header.column.getCanSort() && "cursor-pointer select-none"
                  )}
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
