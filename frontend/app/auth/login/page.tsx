"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Eye, EyeOff, LogIn } from "lucide-react";
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-lg bg-brand/20 flex items-center justify-center">
            <LogIn size={18} className="text-brand" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Welcome back</h1>
            <p className="text-xs text-gray-400">Sign in to TradingPlatform</p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" {...register("email")} placeholder="you@example.com" autoFocus />
            {errors.email && <p className="text-xs text-sell mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label">Password</label>
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
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-sell mt-1">{errors.password.message}</p>}
          </div>

          {needs2fa && (
            <div>
              <label className="label">2FA Code</label>
              <input className="input" {...register("totp_code")} placeholder="6-digit code" maxLength={6} autoFocus />
            </div>
          )}

          {error && <p className="text-sell text-sm">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-4">
          <OAuthButtons />
        </div>

        <p className="mt-4 text-sm text-gray-400 text-center">
          No account?{" "}
          <Link href="/auth/register" className="text-brand hover:underline">Register</Link>
        </p>
      </div>
    </div>
  );
}
