"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft, Mail, CheckCircle2 } from "lucide-react";
import { authApi } from "@/lib/api";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
});
type Form = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: Form) => {
    setError("");
    try {
      await authApi.forgotPassword(data.email);
      setSent(true);
    } catch (e: any) {
      setError(e.response?.data?.detail || "Something went wrong. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-9 h-9 rounded-lg bg-brand/20 flex items-center justify-center">
            <Mail size={18} className="text-brand" />
          </div>
          <h1 className="text-xl font-bold">Reset your password</h1>
        </div>

        {sent ? (
          <div className="text-center py-6 space-y-3">
            <CheckCircle2 size={40} className="text-buy mx-auto" />
            <p className="text-sm text-gray-300">
              If an account exists for that email, we've sent a password reset link.
              Check your inbox — the link expires in 1 hour.
            </p>
            <Link href="/auth/login" className="text-brand text-sm hover:underline inline-flex items-center gap-1 mt-2">
              <ArrowLeft size={14} /> Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-400 mb-6">
              Enter the email on your account and we'll send you a link to reset your password.
            </p>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" {...register("email")} placeholder="you@example.com" autoFocus />
                {errors.email && <p className="text-xs text-sell mt-1">{errors.email.message}</p>}
              </div>

              {error && <p className="text-sell text-sm">{error}</p>}

              <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
                {isSubmitting ? "Sending…" : "Send reset link"}
              </button>
            </form>

            <p className="mt-4 text-sm text-gray-400 text-center">
              <Link href="/auth/login" className="text-brand hover:underline inline-flex items-center gap-1">
                <ArrowLeft size={14} /> Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
