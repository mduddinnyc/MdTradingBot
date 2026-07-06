"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Eye, EyeOff, ShieldCheck, KeyRound } from "lucide-react";
import { authApi } from "@/lib/api";
import OAuthButtons from "@/components/OAuthButtons";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
  totp_code: z.string().optional(),
});
type Form = z.infer<typeof schema>;

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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      {/* Subtle grid background */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(91,127,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(91,127,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

      <div className="w-full max-w-sm relative">
        {/* Wordmark */}
        <div className="text-center mb-8">
          <div className="font-mono text-2xl font-semibold tracking-tight mb-1">
            <span className="text-gray-100">TRADING</span>
            <span className="text-brand">AI</span>
          </div>
          <div className="text-[10px] text-gray-600 uppercase tracking-[0.2em]">
            Paper mode · Sandbox
          </div>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl shadow-black/40">
          {!needs2fa ? (
            <>
              <div className="mb-5">
                <h1 className="text-lg font-semibold text-gray-100">Sign in</h1>
                <p className="text-xs text-gray-500 mt-0.5">Access your trading dashboard</p>
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

                <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
                  {isSubmitting ? "Signing in…" : "Sign in"}
                </button>
              </form>

              <div className="mt-4">
                <OAuthButtons />
              </div>

              <p className="mt-5 text-xs text-gray-500 text-center">
                No account?{" "}
                <Link href="/auth/register" className="text-brand hover:underline">Create one</Link>
              </p>
            </>
          ) : (
            /* 2FA step */
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
              <div className="flex flex-col items-center text-center mb-2">
                <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center mb-3">
                  <KeyRound size={20} className="text-brand" />
                </div>
                <h2 className="font-semibold text-gray-100">Two-factor authentication</h2>
                <p className="text-xs text-gray-500 mt-1">Enter the 6-digit code from your authenticator app</p>
              </div>

              <div>
                <label className="label sr-only">2FA Code</label>
                <input
                  className="input text-center font-mono text-lg tracking-[0.3em]"
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

              <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
                {isSubmitting ? "Verifying…" : "Verify"}
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
        </div>

        {/* Security indicator */}
        <div className="flex items-center justify-center gap-1.5 mt-4">
          <ShieldCheck size={12} className="text-gray-700" />
          <span className="text-[10px] text-gray-700">TLS · JWT · bcrypt · Rate limited</span>
        </div>
      </div>
    </div>
  );
}
