"use client";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { brokerApi, signalApi } from "@/lib/api";
import { fmtUsd, cn } from "@/lib/utils";
import { X } from "lucide-react";

type Side = "buy" | "sell";
type Right = "call" | "put";

export default function OptionsOrderTicket({
  ticker,
  defaultSide = "buy",
  defaultRight = "call",
  onClose,
}: {
  ticker: string;
  defaultSide?: Side;
  defaultRight?: Right;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"pick" | "review">("pick");
  const [side, setSide] = useState<Side>(defaultSide);
  const [right, setRight] = useState<Right>(defaultRight);
  const [expiration, setExpiration] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [placed, setPlaced] = useState(false);

  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const connId = connections[0]?.id;

  const { data: expirations = [] } = useQuery({
    queryKey: ["option-expirations", connId, ticker],
    queryFn: () => brokerApi.optionExpirations(connId, ticker),
    enabled: !!connId,
  });

  useEffect(() => {
    if (expirations.length && !expiration) setExpiration(expirations[0]);
  }, [expirations, expiration]);

  const { data: chain, isLoading: chainLoading } = useQuery({
    queryKey: ["option-chain", connId, ticker, expiration],
    queryFn: () => brokerApi.options(connId, ticker, expiration),
    enabled: !!connId && !!expiration,
    refetchInterval: 10_000,
  });

  const contracts = (chain?.options || []).filter((o: any) => o.option_type === right);
  const selected = contracts.find((o: any) => o.symbol === selectedSymbol);

  const qty = parseInt(quantity) || 0;
  const refPrice = selected ? (side === "buy" ? selected.ask : selected.bid) : null;
  const estCost = refPrice && qty ? refPrice * qty * 100 : null;

  const stageMut = useMutation({
    mutationFn: () =>
      signalApi.stageManualOption({
        broker_connection_id: connId,
        ticker,
        option_symbol: selected.symbol,
        option_right: right,
        strike_price: selected.strike,
        expiration_date: expiration,
        side,
        quantity: qty,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["options-automation"] });
      setPlaced(true);
      setTimeout(onClose, 1500);
    },
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div
        className="card w-full max-w-lg border-brand/30 max-h-[85vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label={`${ticker} options order ticket`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg font-mono">{ticker} Options</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        {placed ? (
          <div className="py-10 text-center">
            <p className="text-buy text-lg font-bold mb-1">Staged for Approval ✓</p>
            <p className="text-xs text-gray-400">Review it in Automation → Pending Approval before it's sent to your broker.</p>
          </div>
        ) : step === "pick" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSide("buy")}
                className={cn("py-2.5 rounded-lg font-bold text-sm transition-colors", side === "buy" ? "bg-buy text-white" : "bg-gray-800 text-gray-400")}
              >
                Buy
              </button>
              <button
                onClick={() => setSide("sell")}
                className={cn("py-2.5 rounded-lg font-bold text-sm transition-colors", side === "sell" ? "bg-sell text-white" : "bg-gray-800 text-gray-400")}
              >
                Sell
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setRight("call"); setSelectedSymbol(""); }}
                className={cn("py-2 rounded-lg text-sm font-semibold transition-colors", right === "call" ? "bg-buy text-white" : "bg-gray-800 text-gray-400")}
              >
                Call
              </button>
              <button
                onClick={() => { setRight("put"); setSelectedSymbol(""); }}
                className={cn("py-2 rounded-lg text-sm font-semibold transition-colors", right === "put" ? "bg-sell text-white" : "bg-gray-800 text-gray-400")}
              >
                Put
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="opt-expiration" className="label">Expiration</label>
                <select
                  id="opt-expiration"
                  className="input"
                  value={expiration}
                  onChange={(e) => { setExpiration(e.target.value); setSelectedSymbol(""); }}
                >
                  {expirations.map((d: string) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="opt-quantity" className="label">Contracts</label>
                <input
                  id="opt-quantity"
                  className="input"
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="label">Strike</label>
              <div className="max-h-64 overflow-y-auto border border-gray-800 rounded-lg divide-y divide-gray-800/50">
                {chainLoading ? (
                  <p className="text-xs text-gray-500 py-4 text-center">Loading live chain…</p>
                ) : contracts.length === 0 ? (
                  <p className="text-xs text-gray-500 py-4 text-center">No {right}s found for this expiration.</p>
                ) : (
                  contracts
                    .slice()
                    .sort((a: any, b: any) => a.strike - b.strike)
                    .map((c: any) => (
                      <button
                        key={c.symbol}
                        onClick={() => setSelectedSymbol(c.symbol)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors",
                          selectedSymbol === c.symbol ? "bg-brand/10" : "hover:bg-gray-800/40"
                        )}
                      >
                        <span className="font-mono font-bold">${c.strike?.toFixed(2)}</span>
                        <span className="text-gray-400 text-xs">
                          Bid {c.bid != null ? fmtUsd(c.bid) : "—"} · Ask {c.ask != null ? fmtUsd(c.ask) : "—"}
                        </span>
                      </button>
                    ))
                )}
              </div>
            </div>

            {selected && (
              <div className="flex items-center justify-between text-sm bg-gray-900 rounded-lg p-3">
                <span className="text-gray-400">Est. {side === "buy" ? "cost" : "proceeds"} ({qty} contract{qty !== 1 ? "s" : ""})</span>
                <span className="font-bold">{estCost ? fmtUsd(estCost) : "—"}</span>
              </div>
            )}

            <button
              onClick={() => setStep("review")}
              disabled={!selected || qty <= 0}
              className="w-full btn-primary disabled:opacity-40"
            >
              Review
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2 text-sm bg-gray-900 rounded-lg p-4">
              <div className="flex justify-between">
                <span className="text-gray-400">Side</span>
                <span className={cn("font-bold", side === "buy" ? "text-buy" : "text-sell")}>
                  {side.toUpperCase()} TO {side === "buy" ? "OPEN" : "CLOSE"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Contract</span>
                <span className="font-mono text-xs">{selected.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Strike</span>
                <span className="font-semibold">${selected.strike?.toFixed(2)} {right.toUpperCase()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Expiration</span>
                <span className="font-semibold">{expiration}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Quantity</span>
                <span className="font-semibold">{qty} contract{qty !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-800">
                <span className="text-gray-400">Est. {side === "buy" ? "Cost" : "Proceeds"}</span>
                <span className="font-bold">{estCost ? fmtUsd(estCost) : "—"}</span>
              </div>
            </div>

            <p className="text-xs text-hold bg-hold/10 border border-hold/30 rounded-lg p-3">
              This stages the order for your approval — nothing is sent to your broker until you approve it from Automation → Pending Approval.
            </p>

            {stageMut.isError && (
              <p className="text-sell text-sm">{(stageMut.error as any)?.response?.data?.detail || "Could not stage order"}</p>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep("pick")} className="btn-ghost flex-1" disabled={stageMut.isPending}>
                Back
              </button>
              <button
                onClick={() => stageMut.mutate()}
                disabled={stageMut.isPending}
                className={cn(
                  "flex-1 py-2.5 rounded-lg font-bold text-sm transition-colors disabled:opacity-50",
                  side === "buy" ? "bg-buy text-white hover:bg-buy/80" : "bg-sell text-white hover:bg-sell/80"
                )}
              >
                {stageMut.isPending ? "Staging…" : "Stage for Approval"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
