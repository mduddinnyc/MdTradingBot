"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Eye, EyeOff, KeyRound, TrendingUp, ShieldCheck, Zap } from "lucide-react";
import { authApi } from "@/lib/api";
import OAuthButtons from "@/components/OAuthButtons";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
  totp_code: z.string().optional(),
});
type Form = z.infer<typeof schema>;

// Animated SVG chart for the hero panel
function HeroChart() {
  return (
    <svg viewBox="0 0 400 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full max-w-sm opacity-90">
      {/* Area fill */}
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5B7FFF" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#5B7FFF" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#10D987" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Grid lines */}
      {[40, 80, 120, 160].map((y) => (
        <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="#1e293b" strokeWidth="1" />
      ))}
      {[80, 160, 240, 320].map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2="200" stroke="#1e293b" strokeWidth="1" />
      ))}

      {/* Area */}
      <path
        d="M0 160 L40 145 L80 130 L120 110 L160 95 L200 80 L240 65 L280 55 L320 40 L360 30 L400 20 L400 200 L0 200 Z"
        fill="url(#areaGrad)"
      />

      {/* Line */}
      <path
        d="M0 160 L40 145 L80 130 L120 110 L160 95 L200 80 L240 65 L280 55 L320 40 L360 30 L400 20"
        stroke="url(#lineGrad)"
        strokeWidth="2.5"
        fill="none"
        filter="url(#glow)"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Candlesticks scattered along the trend */}
      {[
        { x: 40,  open: 150, close: 140, high: 135, low: 158 },
        { x: 120, open: 115, close: 105, high: 100, low: 120 },
        { x: 200, open: 85,  close: 75,  high: 70,  low: 90  },
        { x: 280, open: 60,  close: 50,  high: 45,  low: 65  },
        { x: 360, open: 35,  close: 25,  high: 20,  low: 40  },
      ].map(({ x, open, close, high, low }, i) => {
        const isGreen = close < open;
        const color = isGreen ? "#10D987" : "#FF4D6D";
        const bodyTop = Math.min(open, close);
        const bodyH = Math.abs(open - close);
        return (
          <g key={i}>
            <line x1={x} y1={high} x2={x} y2={low} stroke={color} strokeWidth="1" opacity="0.6" />
            <rect x={x - 4} y={bodyTop} width={8} height={Math.max(bodyH, 2)} fill={color} opacity="0.8" rx="1" />
          </g>
        );
      })}

      {/* Glowing dot at the tip */}
      <circle cx="400" cy="20" r="5" fill="#10D987" filter="url(#glow)" />
      <circle cx="400" cy="20" r="3" fill="#10D987" />
    </svg>
  );
}

// Scrolling ticker tape
const TICKERS = ["AAPL +2.3%", "NVDA +4.1%", "TSLA −1.2%", "META +3.5%", "GOOGL +0.8%", "MSFT +1.6%", "AMZN +2.9%", "COIN +5.4%"];

function TickerTape() {
  return (
    <div className="relative overflow-hidden w-full">
      <div className="flex gap-8 animate-scroll whitespace-nowrap">
        {[...TICKERS, ...TICKERS].map((t, i) => {
          const isNeg = t.includes("−");
          return (
            <span key={i} className={`text-[11px] font-mono font-medium ${isNeg ? "text-red-400" : "text-emerald-400"}`}>
              {t}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: Form) => {
    setError("");
    try {
      const res = await authApi.login(data.email, data.password, data.totp_code);
      if (res.requires_2fa) { setNeeds2fa(true); return; }
      router.push("/dashboard");
    } catch (e: any) {
      setError(e.response?.data?.detail || "Login failed");
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left Hero Panel ── */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 flex-col justify-between bg-gray-950 relative overflow-hidden p-12">
        {/* Background glow orbs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-brand/10 blur-[120px] animate-pulse" />
          <div className="absolute bottom-1/3 right-1/4 w-64 h-64 rounded-full bg-emerald-500/8 blur-[100px] animate-pulse [animation-delay:1.5s]" />
        </div>

        {/* Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(91,127,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(91,127,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />

        {/* Wordmark */}
        <div className="relative z-10">
          <div className="font-mono text-2xl font-bold tracking-tight">
            <span className="text-gray-100">TRADING</span>
            <span className="text-brand">AI</span>
          </div>
          <p className="text-xs text-gray-600 mt-1 uppercase tracking-[0.2em]">Paper mode · Sandbox</p>
        </div>

        {/* Chart + headline */}
        <div className="relative z-10 space-y-8">
          <div>
            <h2 className="text-4xl font-bold text-gray-100 leading-tight">
              Trade smarter<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand to-emerald-400">
                with AI signals
              </span>
            </h2>
            <p className="mt-3 text-gray-500 text-sm max-w-xs">
              Real-time market analysis, automated execution, and risk management — all in one platform.
            </p>
          </div>

          <HeroChart />

          {/* Feature list */}
          <div className="space-y-3">
            {[
              { icon: Zap, label: "AI-powered buy/sell signals across 500+ tickers" },
              { icon: ShieldCheck, label: "Hard risk guardrails — confidence, PDT, daily-loss cap" },
              { icon: TrendingUp, label: "Strategies: Trend, Momentum, Mean Reversion & more" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0">
                  <Icon size={14} className="text-brand" />
                </div>
                <span className="text-sm text-gray-400">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Ticker tape at bottom */}
        <div className="relative z-10 border-t border-gray-800/60 pt-4">
          <TickerTape />
        </div>
      </div>

      {/* ── Right Form Panel ── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 p-8 relative">
        {/* Mobile wordmark */}
        <div className="lg:hidden text-center mb-8">
          <div className="font-mono text-2xl font-bold tracking-tight">
            <span className="text-gray-100">TRADING</span>
            <span className="text-brand">AI</span>
          </div>
          <p className="text-[10px] text-gray-600 uppercase tracking-[0.2em] mt-1">Paper mode · Sandbox</p>
        </div>

        <div className="w-full max-w-sm">
          {!needs2fa ? (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-bold text-gray-100">Welcome back</h1>
                <p className="text-sm text-gray-500 mt-1">Sign in to your trading dashboard</p>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input"
                    type="email"
                    {...register("email")}
                    placeholder="you@example.com"
                    autoFocus
                    autoComplete="email"
                  />
                  {errors.email && <p className="text-xs text-sell mt-1">{errors.email.message}</p>}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label mb-0">Password</label>
                    <Link href="/auth/forgot-password" className="text-xs text-brand hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <input
                      className="input pr-10"
                      type={showPw ? "text" : "password"}
                      {...register("password")}
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                      tabIndex={-1}
                      aria-label={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-sell mt-1">{errors.password.message}</p>}
                </div>

                {error && (
                  <div className="px-3 py-2 rounded-lg bg-sell/10 border border-sell/20">
                    <p className="text-sell text-xs">{error}</p>
                  </div>
                )}

                <button type="submit" className="btn-primary w-full py-2.5" disabled={isSubmitting}>
                  {isSubmitting ? "Signing in…" : "Sign in"}
                </button>
              </form>

              <div className="mt-5">
                <OAuthButtons />
              </div>

              <p className="mt-6 text-xs text-gray-500 text-center">
                No account?{" "}
                <Link href="/auth/register" className="text-brand hover:underline font-medium">Create one</Link>
              </p>
            </>
          ) : (
            /* 2FA step */
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
              <div className="flex flex-col items-center text-center mb-4">
                <div className="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mb-4">
                  <KeyRound size={24} className="text-brand" />
                </div>
                <h2 className="text-xl font-bold text-gray-100">Two-factor auth</h2>
                <p className="text-sm text-gray-500 mt-1">Enter the 6-digit code from your authenticator app</p>
              </div>

              <div>
                <label className="label sr-only">2FA Code</label>
                <input
                  className="input text-center font-mono text-2xl tracking-[0.4em] py-4"
                  {...register("totp_code")}
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  inputMode="numeric"
                />
              </div>

              {error && (
                <div className="px-3 py-2 rounded-lg bg-sell/10 border border-sell/20">
                  <p className="text-sell text-xs text-center">{error}</p>
                </div>
              )}

              <button type="submit" className="btn-primary w-full py-2.5" disabled={isSubmitting}>
                {isSubmitting ? "Verifying…" : "Verify code"}
              </button>

              <button
                type="button"
                onClick={() => setNeeds2fa(false)}
                className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                ← Back to login
              </button>
            </form>
          )}

          {/* Security footer */}
          <div className="flex items-center justify-center gap-1.5 mt-8">
            <ShieldCheck size={12} className="text-gray-700" />
            <span className="text-[10px] text-gray-700">TLS · JWT · bcrypt · Rate limited</span>
          </div>
        </div>
      </div>

    </div>
  );
}
