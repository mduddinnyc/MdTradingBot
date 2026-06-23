"use client";
import { Check, X } from "lucide-react";

const RULES: Array<{ label: string; test: (v: string) => boolean }> = [
  { label: "At least 8 characters", test: (v) => v.length >= 8 },
  { label: "One uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { label: "One lowercase letter", test: (v) => /[a-z]/.test(v) },
  { label: "One digit", test: (v) => /[0-9]/.test(v) },
  { label: "One special character", test: (v) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(v) },
];

export default function PasswordStrengthChecklist({ password }: { password: string }) {
  return (
    <ul className="space-y-1.5 mt-2">
      {RULES.map(({ label, test }) => {
        const pass = test(password);
        return (
          <li
            key={label}
            className={`flex items-center gap-2 text-xs transition-colors ${
              pass ? "text-buy" : "text-sell"
            }`}
          >
            <span
              className={`flex items-center justify-center w-3.5 h-3.5 rounded-full shrink-0 ${
                pass ? "bg-buy/20" : "bg-sell/20"
              }`}
            >
              {pass ? <Check size={9} /> : <X size={9} />}
            </span>
            {label}
          </li>
        );
      })}
    </ul>
  );
}
