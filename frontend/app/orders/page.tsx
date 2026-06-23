"use client";
import { useQuery } from "@tanstack/react-query";
import { signalApi } from "@/lib/api";
import { fmtUsd } from "@/lib/utils";
import { cn } from "@/lib/utils";

const statusColor: Record<string, string> = {
  submitted: "text-brand",
  filled: "text-buy",
  rejected: "text-sell",
  cancelled: "text-gray-400",
  pending: "text-hold",
};

export default function OrdersPage() {
  const { data: orders = [], isFetching } = useQuery({
    queryKey: ["orders"],
    queryFn: () => signalApi.orders(100),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Order History</h1>
        <span className="text-xs text-gray-400">{isFetching ? "Refreshing…" : `${orders.length} orders`}</span>
      </div>

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
                <th className="pb-3">Ticker</th>
                <th className="pb-3">Side</th>
                <th className="pb-3">Qty</th>
                <th className="pb-3">Fill Price</th>
                <th className="pb-3">Stop</th>
                <th className="pb-3">Target</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Auto</th>
                <th className="pb-3">Reason</th>
                <th className="pb-3">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {orders.map((o: any) => (
                <tr key={o.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-2 font-mono font-bold">{o.ticker}</td>
                  <td className={cn("py-2 font-medium uppercase text-xs", o.side === "buy" ? "text-buy" : "text-sell")}>
                    {o.side}
                  </td>
                  <td className="py-2">{o.quantity}</td>
                  <td className="py-2">{o.avg_fill_price ? fmtUsd(o.avg_fill_price) : "—"}</td>
                  <td className="py-2 text-sell text-xs">{o.stop_price ? fmtUsd(o.stop_price) : "—"}</td>
                  <td className="py-2 text-buy text-xs">{o.take_profit_price ? fmtUsd(o.take_profit_price) : "—"}</td>
                  <td className={cn("py-2 text-xs font-medium uppercase", statusColor[o.status] || "text-gray-400")}>
                    {o.status}
                  </td>
                  <td className="py-2 text-xs">{o.is_automated ? "🤖" : "Manual"}</td>
                  <td className="py-2 text-xs text-gray-400 max-w-xs truncate">{o.rejection_reason || "—"}</td>
                  <td className="py-2 text-xs text-gray-400">
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
