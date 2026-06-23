"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { brokerApi, signalApi } from "@/lib/api";
import { useForm } from "react-hook-form";
import { X, Plus, RefreshCw, Link as LinkIcon } from "lucide-react";
import CandleChart from "@/components/CandleChart";

export default function WatchlistPage() {
  const qc = useQueryClient();
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [chartTf, setChartTf] = useState("1Hour");
  const [brokerForm, setBrokerForm] = useState(false);
  const [connError, setConnError] = useState("");

  const { data: watchlist = [] } = useQuery({ queryKey: ["watchlist"], queryFn: signalApi.watchlist });
  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });
  const conn = connections[0];

  // Bars for selected ticker
  const { data: bars = [] } = useQuery({
    queryKey: ["bars", conn?.id, selectedTicker, chartTf],
    queryFn: () => brokerApi.bars(conn.id, selectedTicker!, chartTf),
    enabled: !!conn && !!selectedTicker,
  });

  const addMut = useMutation({
    mutationFn: (ticker: string) => signalApi.addToWatchlist(ticker),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const removeMut = useMutation({
    mutationFn: (ticker: string) => signalApi.removeFromWatchlist(ticker),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const connectMut = useMutation({
    mutationFn: (d: { broker_name: string; api_key: string; api_secret: string; is_paper: boolean }) =>
      brokerApi.connect(d.broker_name, d.api_key, d.api_secret, d.is_paper),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      setBrokerForm(false);
      setConnError("");
    },
    onError: (e: any) => setConnError(e.response?.data?.detail || "Connection failed"),
  });

  const { register: reg, handleSubmit, reset } = useForm<{ ticker: string }>();
  const { register: regB, handleSubmit: submitB, watch: watchB } = useForm<{ broker_name: string; api_key: string; api_secret: string; is_paper: boolean }>({
    defaultValues: { broker_name: "tradier", is_paper: true },
  });
  const selectedBroker = watchB("broker_name");

  const FIELD_LABELS: Record<string, { key: string; keyPlaceholder: string; secret: string; secretPlaceholder: string }> = {
    tradier:    { key: "Access Token",    keyPlaceholder: "Tradier access token", secret: "Account Number", secretPlaceholder: "e.g. VA12345678" },
    webull:     { key: "App Key",         keyPlaceholder: "Webull App Key",       secret: "App Secret",     secretPlaceholder: "Webull App Secret" },
    alpaca:     { key: "API Key",         keyPlaceholder: "PK...",                secret: "API Secret",     secretPlaceholder: "Enter secret…" },
    ibkr:       { key: "Gateway Host",    keyPlaceholder: "127.0.0.1",            secret: "Gateway Port",   secretPlaceholder: "7497 (paper) / 7496 (live)" },
    tastytrade: { key: "Username",        keyPlaceholder: "Enter username…",      secret: "Password",       secretPlaceholder: "Enter password…" },
  };
  const labels = FIELD_LABELS[selectedBroker] || FIELD_LABELS.tradier;

  const onAddTicker = (d: { ticker: string }) => {
    addMut.mutate(d.ticker.toUpperCase());
    reset();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Watchlist</h1>

      {/* Broker connection */}
      {!conn ? (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2"><LinkIcon size={16} />Connect Broker</h2>
          </div>
          {!brokerForm ? (
            <button className="btn-primary" onClick={() => setBrokerForm(true)}>Connect account</button>
          ) : (
            <form onSubmit={submitB((d) => connectMut.mutate(d))} className="space-y-3 max-w-sm">
              <div>
                <label className="label">Broker</label>
                <select className="input" {...regB("broker_name")}>
                  <option value="tradier">Tradier (recommended)</option>
                  <option value="ibkr">Interactive Brokers</option>
                  <option value="alpaca">Alpaca</option>
                  <option value="webull">Webull</option>
                  <option value="tastytrade">tastytrade</option>
                </select>
              </div>
              <div>
                <label className="label">{labels.key}</label>
                <input className="input font-mono text-xs" {...regB("api_key")} placeholder={labels.keyPlaceholder} />
              </div>
              <div>
                <label className="label">{labels.secret}</label>
                <input className="input font-mono text-xs" {...regB("api_secret")} placeholder={labels.secretPlaceholder} type={selectedBroker === "tradier" ? "text" : "password"} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="paper" {...regB("is_paper")} />
                <label htmlFor="paper" className="text-sm text-gray-300">
                  {selectedBroker === "tradier" ? "Sandbox (paper) — uses sandbox.tradier.com" : "Paper / demo account"}
                </label>
              </div>
              {connError && <p className="text-sell text-sm">{connError}</p>}
              <div className="flex gap-2">
                <button type="submit" className="btn-primary" disabled={connectMut.isPending}>
                  {connectMut.isPending ? "Connecting…" : "Connect"}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setBrokerForm(false)}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="card flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-buy" />
          <span className="text-sm font-medium">{conn.display_name}</span>
          <span className="text-xs text-gray-400">{conn.is_paper ? "Paper" : "Live"}</span>
        </div>
      )}

      {/* Add ticker */}
      <div className="card">
        <h2 className="font-semibold mb-3">Add Symbol</h2>
        <form onSubmit={handleSubmit(onAddTicker)} className="flex gap-2">
          <input className="input w-40 uppercase" {...reg("ticker")} placeholder="AAPL" maxLength={10} />
          <button type="submit" className="btn-primary flex items-center gap-1" disabled={addMut.isPending}>
            <Plus size={14} /> Add
          </button>
        </form>
        {addMut.isError && <p className="text-sell text-sm mt-2">{(addMut.error as any)?.response?.data?.detail}</p>}
      </div>

      {/* Watchlist + chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h2 className="font-semibold mb-3">Symbols</h2>
          {watchlist.length === 0 ? (
            <p className="text-gray-400 text-sm">No symbols yet.</p>
          ) : (
            <ul className="space-y-1">
              {watchlist.map((w: any) => (
                <li
                  key={w.ticker}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    selectedTicker === w.ticker ? "bg-brand/10 text-brand" : "hover:bg-gray-800"
                  }`}
                  onClick={() => setSelectedTicker(w.ticker)}
                >
                  <span className="font-mono font-bold text-sm">{w.ticker}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeMut.mutate(w.ticker); }}
                    className="text-gray-500 hover:text-sell transition-colors"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selectedTicker && conn && (
          <div className="card lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold font-mono">{selectedTicker}</h2>
              <div className="flex gap-1">
                {["1Hour", "1Day"].map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setChartTf(tf)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      chartTf === tf ? "bg-brand text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    {tf === "1Hour" ? "1H" : "1D"}
                  </button>
                ))}
              </div>
            </div>
            <CandleChart bars={bars} height={300} />
          </div>
        )}
      </div>
    </div>
  );
}
