"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { brokerApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Plus, Link2, X } from "lucide-react";

const MAX_CONNECTIONS = 10;

const BROKER_OPTIONS = [
  { value: "tradier", label: "Tradier" },
  { value: "ibkr", label: "Interactive Brokers" },
  { value: "alpaca", label: "Alpaca" },
  { value: "webull", label: "Webull" },
  { value: "tastytrade", label: "tastytrade" },
  { value: "other", label: "Other (custom)…" },
];

const FIELD_LABELS: Record<string, { key: string; keyPlaceholder: string; secret: string; secretPlaceholder: string }> = {
  tradier:    { key: "Access Token", keyPlaceholder: "Tradier access token", secret: "Account Number", secretPlaceholder: "e.g. VA12345678" },
  webull:     { key: "App Key",      keyPlaceholder: "Webull App Key",       secret: "App Secret",     secretPlaceholder: "Webull App Secret" },
  alpaca:     { key: "API Key",      keyPlaceholder: "PK...",                secret: "API Secret",     secretPlaceholder: "Enter secret…" },
  ibkr:       { key: "Gateway Host", keyPlaceholder: "127.0.0.1",            secret: "Gateway Port",   secretPlaceholder: "7497 (paper) / 7496 (live)" },
  tastytrade: { key: "Username",     keyPlaceholder: "Enter username…",      secret: "Password",       secretPlaceholder: "Enter password…" },
  other:      { key: "API Key",      keyPlaceholder: "Enter API key…",       secret: "Account Number", secretPlaceholder: "Enter account number…" },
};

type AddForm = {
  broker_name: string;
  custom_name: string;
  display_name: string;
  api_key: string;
  api_secret: string;
  is_paper: boolean;
};

function ConnectionCard({ conn }: { conn: any }) {
  const qc = useQueryClient();
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "failed">("idle");
  const [testError, setTestError] = useState("");

  const testMut = useMutation({
    mutationFn: () => brokerApi.account(conn.id),
    onMutate: () => setTestState("testing"),
    onSuccess: () => setTestState("ok"),
    onError: (e: any) => {
      setTestState("failed");
      setTestError(e.response?.data?.detail || "Connection test failed");
    },
  });

  const disconnectMut = useMutation({
    mutationFn: () => brokerApi.disconnect(conn.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connections"] }),
  });

  const dotColor = testState === "failed" ? "bg-hold" : "bg-buy";

  return (
    <div className="card flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", dotColor)} />
        <div className="min-w-0">
          <p className="font-semibold text-sm">{conn.display_name}</p>
          <p className="text-xs text-gray-400">
            {conn.broker_name} · {conn.is_paper ? "Paper" : "Live"}
            {conn.account_id ? ` · ${conn.account_id}` : ""}
          </p>
          {testState === "failed" && <p className="text-xs text-hold mt-1">{testError}</p>}
          {testState === "ok" && <p className="text-xs text-buy mt-1">Connection verified</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => testMut.mutate()}
          disabled={testMut.isPending}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {testMut.isPending ? "Testing…" : "Test"}
        </button>
        <button
          onClick={() => {
            if (confirm(`Disconnect ${conn.display_name}? Automation using this connection will stop working.`)) {
              disconnectMut.mutate();
            }
          }}
          disabled={disconnectMut.isPending}
          className="px-3 py-1.5 rounded text-xs font-semibold bg-sell/10 text-sell hover:bg-sell/20 disabled:opacity-50 transition-colors"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

export default function ConnectionsPage() {
  const qc = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [justConnected, setJustConnected] = useState(false);

  const { data: connections = [] } = useQuery({ queryKey: ["connections"], queryFn: brokerApi.list });

  const { register, handleSubmit, watch, reset } = useForm<AddForm>({
    defaultValues: {
      broker_name: "tradier", is_paper: true,
      custom_name: "", display_name: "", api_key: "", api_secret: "",
    },
  });
  const selectedBroker = watch("broker_name");
  const isOther = selectedBroker === "other";
  const labels = FIELD_LABELS[selectedBroker] || FIELD_LABELS.tradier;

  const connectMut = useMutation({
    mutationFn: (d: AddForm) =>
      brokerApi.connect(d.broker_name, d.api_key, d.api_secret, d.is_paper, d.display_name || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connections"] });
      setJustConnected(true);
      setTimeout(() => {
        setShowAddForm(false);
        setJustConnected(false);
        reset();
      }, 1200);
    },
  });

  const atLimit = connections.length >= MAX_CONNECTIONS;
  const connected = justConnected || connectMut.isSuccess;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Connect Your Trading Apps</h1>
        <span className="text-xs text-gray-400">{connections.length}/{MAX_CONNECTIONS} connected</span>
      </div>

      <p className="text-sm text-gray-400">
        Link your broker accounts so signals, automation, and order history can act on real data.
        Credentials are encrypted at rest and only ever sent to your broker's own API.
      </p>

      <div className="space-y-3">
        {connections.map((c: any) => <ConnectionCard key={c.id} conn={c} />)}
        {connections.length === 0 && !showAddForm && (
          <div className="card text-center py-10">
            <p className="text-gray-400">No apps connected yet.</p>
          </div>
        )}
      </div>

      {!showAddForm ? (
        <button
          onClick={() => setShowAddForm(true)}
          disabled={atLimit}
          className="btn-primary flex items-center gap-2 disabled:opacity-40"
        >
          <Plus size={14} /> {atLimit ? `Limit reached (${MAX_CONNECTIONS}/${MAX_CONNECTIONS})` : "Add another app"}
        </button>
      ) : (
        <div className="card max-w-lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2"><Link2 size={16} /> New Connection</h2>
            <button onClick={() => { setShowAddForm(false); reset(); }} className="text-gray-500 hover:text-gray-300">
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit((d) => connectMut.mutate(d))} className="space-y-3">
            <div>
              <label className="label">App</label>
              <select className="input" {...register("broker_name")}>
                {BROKER_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </div>

            {isOther && (
              <div>
                <label className="label">App Name</label>
                <input className="input" {...register("custom_name")} placeholder="e.g. Robinhood" />
              </div>
            )}

            <div>
              <label className="label">Display Name (optional)</label>
              <input className="input" {...register("display_name")} placeholder="e.g. My Tradier Sandbox" />
            </div>

            <div>
              <label className="label">{labels.key}</label>
              <input className="input font-mono text-xs" {...register("api_key")} placeholder={labels.keyPlaceholder} />
            </div>
            <div>
              <label className="label">{labels.secret}</label>
              <input
                className="input font-mono text-xs"
                type={selectedBroker === "tradier" ? "text" : "password"}
                {...register("api_secret")}
                placeholder={labels.secretPlaceholder}
              />
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="paper" {...register("is_paper")} />
              <label htmlFor="paper" className="text-sm text-gray-300">Paper / sandbox account</label>
            </div>

            {isOther && (
              <p className="text-xs text-hold bg-hold/10 border border-hold/30 rounded-lg p-3">
                No live integration for custom apps yet, so this can't be validated or used for real
                trading. The name above is saved for your own reference only — tell us which broker to
                add next and we'll build real support for it.
              </p>
            )}

            {connectMut.isError && (
              <p className="text-sell text-sm">{(connectMut.error as any)?.response?.data?.detail || "Connection failed"}</p>
            )}

            <button
              type="submit"
              disabled={isOther || connectMut.isPending}
              className={cn(
                "w-full px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors disabled:opacity-50",
                connectMut.isPending ? "bg-gray-600 text-gray-300" :
                connected ? "bg-buy text-white" :
                connectMut.isError ? "bg-hold text-white" :
                "bg-brand text-white hover:bg-brand/90"
              )}
            >
              {connectMut.isPending ? "Connecting…" : connected ? "Connected ✓" : connectMut.isError ? "Failed — Retry" : "Connect"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
