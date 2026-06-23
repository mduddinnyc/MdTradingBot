"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Eye, EyeOff, UserPlus } from "lucide-react";
import { authApi } from "@/lib/api";
import OAuthButtons from "@/components/OAuthButtons";
import PasswordStrengthChecklist from "@/components/PasswordStrengthChecklist";

const schema = z
  .object({
    full_name: z.string().min(1, "Required"),
    email: z.string().min(1, "Email is required").email("Enter a valid email"),
    password: z.string()
      .min(8, "Min 8 chars")
      .regex(/[A-Z]/, "Need uppercase")
      .regex(/[a-z]/, "Need lowercase")
      .regex(/[0-9]/, "Need digit")
      .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, "Need special character"),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Passwords don't match",
    path: ["confirm_password"],
  });
type Form = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", email: "", password: "", confirm_password: "" },
  });
  const password = watch("password");

  const onSubmit = async (data: Form) => {
    setError("");
    try {
      await authApi.register(data.email, data.password, data.full_name);
      router.push("/auth/login");
    } catch (e: any) {
      setError(e.response?.data?.detail || "Registration failed");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-lg bg-brand/20 flex items-center justify-center shrink-0">
            <UserPlus size={18} className="text-brand" />
          </div>
          <h1 className="text-2xl font-bold leading-tight">Create your account</h1>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label className="label">Full name</label>
            <input className="input" {...register("full_name")} placeholder="Jane Smith" autoFocus />
            {errors.full_name && <p className="text-xs text-sell mt-1">{errors.full_name.message}</p>}
          </div>

          <div>
            <label className="label">Email</label>
            <input className="input" type="email" {...register("email")} placeholder="you@example.com" />
            {errors.email && <p className="text-xs text-sell mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label">Password</label>
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="flex items-center gap-1 text-xs text-brand hover:underline"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
            <input
              className="input"
              type={showPw ? "text" : "password"}
              {...register("password")}
              placeholder="••••••••"
            />
            <PasswordStrengthChecklist password={password} />
          </div>

          <div>
            <label className="label">Confirm password</label>
            <input
              className="input"
              type={showPw ? "text" : "password"}
              {...register("confirm_password")}
              placeholder="••••••••"
            />
            {errors.confirm_password && <p className="text-xs text-sell mt-1">{errors.confirm_password.message}</p>}
          </div>

          {error && <p className="text-sell text-sm">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create account"}
          </button>
        </form>

        <div className="mt-4">
          <OAuthButtons />
        </div>

        <p className="mt-4 text-sm text-gray-400 text-center">
          Already have an account?{" "}
          <Link href="/auth/login" className="text-brand hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
