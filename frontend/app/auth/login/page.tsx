"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { authApi } from "@/lib/api";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp_code: z.string().optional(),
});
type Form = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState("");

  const { register, handleSubmit, formState: { isSubmitting } } = useForm<Form>({
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
        <h1 className="text-2xl font-bold mb-6">Sign in</h1>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" {...register("email")} placeholder="you@example.com" />
          </div>

          <div>
            <label className="label">Password</label>
            <input className="input" type="password" {...register("password")} placeholder="••••••••" />
          </div>

          {needs2fa && (
            <div>
              <label className="label">2FA Code</label>
              <input className="input" {...register("totp_code")} placeholder="6-digit code" maxLength={6} />
            </div>
          )}

          {error && <p className="text-sell text-sm">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-400 text-center">
          No account?{" "}
          <Link href="/auth/register" className="text-brand hover:underline">Register</Link>
        </p>
      </div>
    </div>
  );
}
