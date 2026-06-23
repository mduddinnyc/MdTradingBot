"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { authApi } from "@/lib/api";

const schema = z.object({
  full_name: z.string().min(1, "Required"),
  email: z.string().email(),
  password: z.string()
    .min(8, "Min 8 chars")
    .regex(/[A-Z]/, "Need uppercase")
    .regex(/[a-z]/, "Need lowercase")
    .regex(/[0-9]/, "Need digit")
    .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, "Need special character"),
});
type Form = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
  });

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
        <h1 className="text-2xl font-bold mb-6">Create account</h1>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Full name</label>
            <input className="input" {...register("full_name")} placeholder="Jane Smith" />
            {errors.full_name && <p className="text-sell text-xs mt-1">{errors.full_name.message}</p>}
          </div>

          <div>
            <label className="label">Email</label>
            <input className="input" type="email" {...register("email")} placeholder="you@example.com" />
            {errors.email && <p className="text-sell text-xs mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label className="label">Password</label>
            <input className="input" type="password" {...register("password")} placeholder="Min 8 chars, uppercase, digit" />
            {errors.password && <p className="text-sell text-xs mt-1">{errors.password.message}</p>}
          </div>

          {error && <p className="text-sell text-sm">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-400 text-center">
          Already have an account?{" "}
          <Link href="/auth/login" className="text-brand hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
