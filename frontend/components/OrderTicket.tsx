"use client";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { brokerApi, signalApi } from "@/lib/api";
import { fmtUsd, cn } from "@/lib/utils";
import { X } from "lucide-react";

type Side = "buy" | "sell";
type OrderType = "market" | "limit";
type PriceMode = "%" | "$";

export default function OrderTicket({
  ticker,
  defaultSide = "buy",
  onClose,
}: {
  ticker: string;
  defaultSide?: Side;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"form" | "review">("form");
  const [side, setSide] = useState<Side>(defaultSide);
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [quantity, setQuantity] = useState("10");
  const [limitPrice, setLimitPrice] = useState("");
  const [slEnabled, setSlEnabled] = useState(false);
  const [slMode, setSlMode] = useState<PriceMode>("%");
  const [slValue, setSlValue] = useState("10");
  const [tpEnabled, setTpEnabled] = useState(false);
  const [tpMode, setTpMode] = useState<PriceMode>("%");
  const [tpValue, setTpValue] = useState("10");
  const [placed, setPlaced] = useState(false);

  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const [connId, setConnId] = useState("");
  useEffect(() => {
    if (connections.length && !connId) setConnId(connections[0].id);
  }, [connections, connId]);

  const { data: quote } = useQuery({
    queryKey: ["quote", connId, ticker],
    queryFn: () => brokerApi.quote(connId, ticker),
    enabled: !!connId,
    refetchInterval: 10_000,
  });

  const refPrice = orderType === "limit" && limitPrice ? parseFloat(limitPrice) : quote?.last ?? null;
  const isBuy = side === "buy";

  function pctToPrice(pct: number, kind: "tp" | "sl"): number | null {
    if (!refPrice) return null;
    if (kind === "tp") return isBuy ? refPrice * (1 + pct / 100) : refPrice * (1 - pct / 100);
    return isBuy ? refPrice * (1 - pct / 100) : refPrice * (1 + pct / 100);
  }

  function bracketPrice(enabled: boolean, mode: PriceMode, value: string, kind: "tp" | "sl"): number | null {
    if (!enabled) return null;
    const v = parseFloat(value);
    if (!v) return null;
    return mode === "$" ? v : pctToPrice(v, kind);
  }

  const stopLossPrice = bracketPrice(slEnabled, slMode, slValue, "sl");
  const takeProfitPrice = bracketPrice(tpEnabled, tpMode, tpValue, "tp");
  const qty = parseFloat(quantity) || 0;
  const estCost = refPrice && qty ? refPrice * qty : null;

  const placeMut = useMutation({
    mutationFn: () =>
      signalApi.placeManualOrder({
        broker_connection_id: connId,
        ticker,
        side,
        quantity: qty,
        order_type: orderType,
        limit_price: orderType === "limit" ? parseFloat(limitPrice) || null : null,
        take_profit_price: takeProfitPrice,
        stop_loss_price: stopLossPrice,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["pdt-status"] });
      setPlaced(true);
      setTimeout(onClose, 1200);
    },
  });

  const slWrongSide = slEnabled && stopLossPrice != null && refPrice != null && (isBuy ? stopLossPrice >= refPrice : stopLossPrice <= refPrice);
  const tpWrongSide = tpEnabled && takeProfitPrice != null && refPrice != null && (isBuy ? takeProfitPrice <= refPrice : takeProfitPrice >= refPrice);

  const formValid =
    qty > 0 &&
    connId &&
    (orderType === "market" || (limitPrice && parseFloat(limitPrice) > 0)) &&
    !slWrongSide &&
    !tpWrongSide;

  const disabledReason = !connId
    ? "Connect a broker to trade."
    : qty <= 0
    ? "Enter a quantity greater than 0."
    : orderType === "limit" && !(limitPrice && parseFloat(limitPrice) > 0)
    ? "Enter a limit price to continue."
    : slWrongSide
    ? `Stop-loss must be ${isBuy ? "below" : "above"} the entry price.`
    : tpWrongSide
    ? `Take-profit must be ${isBuy ? "above" : "below"} the entry price.`
    : "";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md border-brand/30" role="dialog" aria-modal="true" aria-label={`${ticker} order ticket`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg font-mono">{ticker}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        {placed ? (
          <div className="py-10 text-center">
            <p className="text-buy text-lg font-bold mb-1">Order Placed ✓</p>
            <p className="text-xs text-gray-400">Check Order History for fill status.</p>
          </div>
        ) : step === "form" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSide("buy")}
                className={cn("py-2.5 rounded-lg font-bold text-sm transition-colors", isBuy ? "bg-buy text-white" : "bg-gray-800 text-gray-400")}
              >
                Buy
              </button>
              <button
                onClick={() => setSide("sell")}
                className={cn("py-2.5 rounded-lg font-bold text-sm transition-colors", !isBuy ? "bg-sell text-white" : "bg-gray-800 text-gray-400")}
              >
                Sell
              </button>
            </div>

            {connections.length > 1 && (
              <div>
                <label className="label">Broker account</label>
                <select className="input" value={connId} onChange={(e) => setConnId(e.target.value)}>
                  {connections.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.display_name} ({c.is_paper ? "Paper" : "Live"})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Order Type</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {([{ v: "market", label: "Market" }, { v: "limit", label: "Limit" }] as const).map(({ v, label }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setOrderType(v)}
                      className={cn(
                        "py-2 rounded-lg text-sm font-semibold transition-colors",
                        orderType === v ? "bg-brand text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="order-quantity" className="label">Quantity</label>
                <input id="order-quantity" className="input" type="number" min="0" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
            </div>

            {orderType === "limit" && (
              <div>
                <label htmlFor="order-limit-price" className="label">Limit Price</label>
                <input
                  id="order-limit-price"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder={quote?.last ? quote.last.toFixed(2) : "0.00"}
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">
                  {quote?.last != null ? `Current: ${fmtUsd(quote.last)}` : "Enter your price"}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between bg-gray-800/40 rounded-lg p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={slEnabled} onChange={(e) => setSlEnabled(e.target.checked)} className="accent-brand" />
                  Stop-Loss
                </label>
                {slEnabled && (
                  <div className="flex items-center gap-1.5">
                    <input className="input w-20 !py-1 text-right" type="number" step="0.01" value={slValue} onChange={(e) => setSlValue(e.target.value)} />
                    <div className="flex rounded overflow-hidden">
                      {(["%", "$"] as const).map((m) => (
                        <button key={m} onClick={() => setSlMode(m)} className={cn("px-2 py-1 text-xs font-bold", slMode === m ? "bg-brand text-white" : "bg-gray-700 text-gray-400")}>
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {slEnabled && stopLossPrice && <p className="text-xs text-sell text-right">Stop @ {fmtUsd(stopLossPrice)}</p>}

              <div className="flex items-center justify-between bg-gray-800/40 rounded-lg p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={tpEnabled} onChange={(e) => setTpEnabled(e.target.checked)} className="accent-brand" />
                  Take-Profit
                </label>
                {tpEnabled && (
                  <div className="flex items-center gap-1.5">
                    <input className="input w-20 !py-1 text-right" type="number" step="0.01" value={tpValue} onChange={(e) => setTpValue(e.target.value)} />
                    <div className="flex rounded overflow-hidden">
                      {(["%", "$"] as const).map((m) => (
                        <button key={m} onClick={() => setTpMode(m)} className={cn("px-2 py-1 text-xs font-bold", tpMode === m ? "bg-brand text-white" : "bg-gray-700 text-gray-400")}>
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {tpEnabled && takeProfitPrice && <p className="text-xs text-buy text-right">Target @ {fmtUsd(takeProfitPrice)}</p>}
            </div>

            <div className="flex items-center justify-between text-sm bg-gray-900 rounded-lg p-3">
              <span className="text-gray-400">Est. {orderType === "limit" ? "limit" : "market"} cost</span>
              <span className="font-bold">{estCost ? fmtUsd(estCost) : "—"}</span>
            </div>

            <button
              onClick={() => setStep("review")}
              disabled={!formValid}
              className="w-full btn-primary disabled:opacity-40"
            >
              Review Order
            </button>
            {!formValid && disabledReason && (
              <p className="text-xs text-hold text-center">{disabledReason}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2 text-sm bg-gray-900 rounded-lg p-4">
              <div className="flex justify-between">
                <span className="text-gray-400">Side</span>
                <span className={cn("font-bold", isBuy ? "text-buy" : "text-sell")}>{side.toUpperCase()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Order Type</span>
                <span className="font-semibold capitalize">{orderType}{orderType === "limit" && ` @ ${fmtUsd(parseFloat(limitPrice))}`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Quantity</span>
                <span className="font-semibold">{qty} shares</span>
              </div>
              {stopLossPrice && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Stop-Loss</span>
                  <span className="font-semibold text-sell">{fmtUsd(stopLossPrice)}</span>
                </div>
              )}
              {takeProfitPrice && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Take-Profit</span>
                  <span className="font-semibold text-buy">{fmtUsd(takeProfitPrice)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-gray-800">
                <span className="text-gray-400">Est. Cost</span>
                <span className="font-bold">{estCost ? fmtUsd(estCost) : "—"}</span>
              </div>
            </div>

            {placeMut.isError && (
              <p className="text-sell text-sm">{(placeMut.error as any)?.response?.data?.detail || "Order failed"}</p>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep("form")} className="btn-ghost flex-1" disabled={placeMut.isPending}>
                Back
              </button>
              <button
                onClick={() => placeMut.mutate()}
                disabled={placeMut.isPending}
                className={cn("flex-1 py-2.5 rounded-lg font-bold text-sm transition-colors disabled:opacity-50", isBuy ? "bg-buy text-white hover:bg-buy/80" : "bg-sell text-white hover:bg-sell/80")}
              >
                {placeMut.isPending ? "Sending…" : `Send ${side === "buy" ? "Buy" : "Sell"} Order`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
