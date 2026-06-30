"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { signalApi } from "@/lib/api";
import { fmtUsd, fmtPct, cn } from "@/lib/utils";
import { Shield, TrendingUp, Zap, ChevronLeft } from "lucide-react";

type Profile = "conservative" | "balanced" | "aggressive";

const PRESETS: Record<
  Profile,
  {
    label: string;
    icon: typeof Shield;
    blurb: string;
    min_confidence: number;
    max_position_pct: number;
    stop_loss_pct: number;
    take_profit_pct: number;
    max_open_positions: number;
    cooldown_minutes: number;
    daily_loss_pct: number;
  }
> = {
  conservative: {
    label: "Conservative", icon: Shield, blurb: "Fewer, higher-conviction trades. Tightest loss limits.",
    min_confidence: 0.55, max_position_pct: 0.05, stop_loss_pct: 0.015, take_profit_pct: 0.03,
    max_open_positions: 3, cooldown_minutes: 90, daily_loss_pct: 0.02,
  },
  balanced: {
    label: "Balanced", icon: TrendingUp, blurb: "Moderate risk and frequency. Fires on most medium-strength signals.",
    min_confidence: 0.35, max_position_pct: 0.10, stop_loss_pct: 0.02, take_profit_pct: 0.04,
    max_open_positions: 5, cooldown_minutes: 60, daily_loss_pct: 0.03,
  },
  aggressive: {
    label: "Aggressive", icon: Zap, blurb: "More trades, bigger size, widest stops. Fires on nearly all signals.",
    min_confidence: 0.20, max_position_pct: 0.15, stop_loss_pct: 0.03, take_profit_pct: 0.06,
    max_open_positions: 8, cooldown_minutes: 30, daily_loss_pct: 0.05,
  },
};

export default function RiskProfileWizard({
  connId,
  equity,
  onDone,
  onUseCustom,
}: {
  connId: string;
  equity: number;
  onDone: () => void;
  onUseCustom: () => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [capitalMode, setCapitalMode] = useState<"dollar" | "percent">("percent");
  const [capitalValue, setCapitalValue] = useState("50");
  const [universe, setUniverse] = useState<"watchlist" | "day_trade_scan">("watchlist");

  const mut = useMutation({
    mutationFn: () =>
      signalApi.automationWizard({
        broker_connection_id: connId,
        risk_profile: profile!,
        capital_mode: capitalMode,
        capital_value: parseFloat(capitalValue) || 0,
        universe,
        is_enabled: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation"] });
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      onDone();
    },
  });

  const preset = profile ? PRESETS[profile] : null;
  const capitalUsd = capitalMode === "dollar" ? parseFloat(capitalValue) || 0 : (equity * (parseFloat(capitalValue) || 0)) / 100;
  const positionSize = preset ? capitalUsd / preset.max_open_positions : 0;
  const dailyLossUsd = preset ? equity * preset.daily_loss_pct : 0;

  return (
    <div className="card border-brand/30 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {step > 1 && (
            <button onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)} className="text-gray-500 hover:text-gray-300">
              <ChevronLeft size={18} />
            </button>
          )}
          <h2 className="font-semibold">Risk Profile Wizard</h2>
          <span className="text-xs text-gray-500">Step {step} of 4</span>
        </div>
        <button onClick={onUseCustom} className="text-xs text-gray-400 hover:text-gray-200 underline">
          Use advanced/custom form instead
        </button>
      </div>

      {step === 1 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-400">How much risk should autopilot take?</p>
          {(Object.keys(PRESETS) as Profile[]).map((key) => {
            const p = PRESETS[key];
            const Icon = p.icon;
            return (
              <button
                key={key}
                onClick={() => { setProfile(key); setStep(2); }}
                className="w-full flex items-start gap-3 p-4 rounded-lg border border-gray-800 hover:border-brand/50 hover:bg-brand/5 text-left transition-colors"
              >
                <Icon size={20} className="text-brand mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">{p.label}</p>
                  <p className="text-xs text-gray-400">{p.blurb}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && preset && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">How much capital should this profile use?</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setCapitalMode("percent")}
              className={cn("py-2 rounded-lg text-sm font-semibold transition-colors", capitalMode === "percent" ? "bg-brand text-white" : "bg-gray-800 text-gray-400")}
            >
              % of account
            </button>
            <button
              onClick={() => setCapitalMode("dollar")}
              className={cn("py-2 rounded-lg text-sm font-semibold transition-colors", capitalMode === "dollar" ? "bg-brand text-white" : "bg-gray-800 text-gray-400")}
            >
              Dollar amount
            </button>
          </div>
          <div>
            <label htmlFor="wizard-capital" className="label">
              {capitalMode === "percent" ? "% of account equity" : "Dollar amount"}
            </label>
            <input
              id="wizard-capital"
              className="input"
              type="number"
              min="1"
              max={capitalMode === "percent" ? 100 : undefined}
              value={capitalValue}
              onChange={(e) => setCapitalValue(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">
              ≈ {fmtUsd(capitalUsd)} of your {fmtUsd(equity)} account equity
            </p>
          </div>
          <button
            onClick={() => setStep(3)}
            disabled={!capitalValue || parseFloat(capitalValue) <= 0}
            className="w-full btn-primary disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">What should it trade?</p>
          <button
            onClick={() => { setUniverse("watchlist"); setStep(4); }}
            className={cn("w-full p-4 rounded-lg border text-left transition-colors", universe === "watchlist" ? "border-brand bg-brand/5" : "border-gray-800 hover:border-brand/50")}
          >
            <p className="font-semibold">My Watchlist</p>
            <p className="text-xs text-gray-400">Only scan symbols you've already added to Watchlist.</p>
          </button>
          <button
            onClick={() => { setUniverse("day_trade_scan"); setStep(4); }}
            className={cn("w-full p-4 rounded-lg border text-left transition-colors", universe === "day_trade_scan" ? "border-brand bg-brand/5" : "border-gray-800 hover:border-brand/50")}
          >
            <p className="font-semibold">Day-Trade Scan Universe</p>
            <p className="text-xs text-gray-400">Let it scan ~40 liquid large-caps too — adds them to your Watchlist.</p>
          </button>
        </div>
      )}

      {step === 4 && preset && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">Confirm before autopilot goes live:</p>
          <div className="space-y-2 text-sm bg-gray-900 rounded-lg p-4">
            <div className="flex justify-between">
              <span className="text-gray-400">Profile</span>
              <span className="font-semibold">{preset.label}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Capital allocated</span>
              <span className="font-semibold">{fmtUsd(capitalUsd)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Universe</span>
              <span className="font-semibold">{universe === "watchlist" ? "My Watchlist" : "Day-Trade Scan (~40 symbols)"}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-gray-800">
              <span className="text-gray-400">Min. signal confidence</span>
              <span className="font-semibold">{fmtPct(preset.min_confidence)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Max position size</span>
              <span className="font-semibold">{fmtUsd(positionSize)} ({fmtPct(preset.max_position_pct)} of equity)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Stop-loss / Take-profit</span>
              <span className="font-semibold">{fmtPct(preset.stop_loss_pct)} / {fmtPct(preset.take_profit_pct)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Max open positions</span>
              <span className="font-semibold">{preset.max_open_positions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Cooldown between trades</span>
              <span className="font-semibold">{preset.cooldown_minutes} min</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-gray-800">
              <span className="text-gray-400">Max daily loss (hard stop)</span>
              <span className="font-bold text-sell">{fmtUsd(dailyLossUsd)} ({fmtPct(preset.daily_loss_pct)} of equity)</span>
            </div>
          </div>
          <p className="text-xs text-hold bg-hold/10 border border-hold/30 rounded-lg p-3">
            Automation will start placing real paper trades immediately under these limits. Disable it or hit Emergency Stop anytime from this page.
          </p>
          {mut.isError && <p className="text-sell text-sm">{(mut.error as any)?.response?.data?.detail || "Could not save"}</p>}
          <button onClick={() => mut.mutate()} disabled={mut.isPending} className="w-full btn-primary disabled:opacity-50">
            {mut.isPending ? "Activating…" : "Confirm & Go Live"}
          </button>
        </div>
      )}
    </div>
  );
}
