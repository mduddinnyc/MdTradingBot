"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { KeyRound, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { authApi } from "@/lib/api";
import PasswordStrengthChecklist from "@/components/PasswordStrengthChecklist";

const schema = z
  .object({
    new_password: z.string()
      .min(8, "Min 8 chars")
      .regex(/[A-Z]/, "Need uppercase")
      .regex(/[a-z]/, "Need lowercase")
      .regex(/[0-9]/, "Need digit")
      .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, "Need special character"),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Passwords don't match",
    path: ["confirm_password"],
  });
type Form = z.infer<typeof schema>;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { new_password: "", confirm_password: "" },
  });
  const password = watch("new_password");

  const onSubmit = async (data: Form) => {
    setError("");
    try {
      await authApi.resetPassword(token, data.new_password);
      setDone(true);
      setTimeout(() => router.push("/auth/login"), 2500);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Reset failed. The link may have expired.");
    }
  };

  if (!token) {
    return (
      <div className="card w-full max-w-sm text-center py-8">
        <p className="text-sell text-sm">Missing or invalid reset link.</p>
        <Link href="/auth/forgot-password" className="text-brand text-sm hover:underline mt-3 inline-block">
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card w-full max-w-sm text-center py-8 space-y-3">
        <CheckCircle2 size={40} className="text-buy mx-auto" />
        <p className="text-sm text-gray-300">Password reset. Redirecting to sign in…</p>
      </div>
    );
  }

  return (
    <div className="card w-full max-w-sm">
      <div className="flex items-center gap-2 mb-6">
        <div className="w-9 h-9 rounded-lg bg-brand/20 flex items-center justify-center">
          <KeyRound size={18} className="text-brand" />
        </div>
        <h1 className="text-xl font-bold">Set a new password</h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <label className="label">New password</label>
          <div className="relative">
            <input
              className="input pr-10"
              type={showPw ? "text" : "password"}
              {...register("new_password")}
              placeholder="••••••••"
              autoFocus
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
          <PasswordStrengthChecklist password={password} />
        </div>

        <div>
          <label className="label">Confirm new password</label>
          <input className="input" type={showPw ? "text" : "password"} {...register("confirm_password")} placeholder="••••••••" />
          {errors.confirm_password && <p className="text-xs text-sell mt-1">{errors.confirm_password.message}</p>}
        </div>

        {error && <p className="text-sell text-sm">{error}</p>}

        <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
          {isSubmitting ? "Resetting…" : "Reset password"}
        </button>
      </form>

      <p className="mt-4 text-sm text-gray-400 text-center">
        <Link href="/auth/login" className="text-brand hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Suspense fallback={<div className="card w-full max-w-sm text-center py-8 text-gray-400">Loading…</div>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
