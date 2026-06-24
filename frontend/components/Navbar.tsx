"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BarChart2, List, Zap, Settings, LogOut, ShoppingCart, Brain, Layers, FlaskConical, Flame, Link2 } from "lucide-react";

const NAV = [
  { href: "/dashboard",    label: "Dashboard",    icon: BarChart2 },
  { href: "/watchlist",    label: "Watchlist",    icon: List },
  { href: "/signals",      label: "Signals",      icon: Zap },
  { href: "/day-trade",    label: "Day Trade Signal", icon: Flame },
  { href: "/orders",       label: "Orders",       icon: ShoppingCart },
  { href: "/automation",   label: "Automation",   icon: Settings },
  { href: "/analysis",     label: "AI Analysis",  icon: Brain },
  { href: "/options",      label: "Options",      icon: Layers },
  { href: "/backtest",     label: "Backtest",     icon: FlaskConical },
  { href: "/connections",  label: "Connect Your Trading Apps", icon: Link2 },
];

export default function Navbar() {
  const path = usePathname();
  const router = useRouter();

  const logout = async () => {
    await authApi.logout();
    router.push("/auth/login");
  };

  return (
    <nav className="w-56 min-h-screen bg-gray-900 border-r border-gray-800 flex flex-col p-4">
      <div className="text-lg font-bold text-brand mb-8 px-2">TradingAI</div>

      <div className="flex-1 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              path.startsWith(href)
                ? "bg-brand/10 text-brand"
                : "text-gray-400 hover:text-gray-100 hover:bg-gray-800"
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </div>

      <button
        onClick={logout}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
      >
        <LogOut size={16} />
        Sign out
      </button>
    </nav>
  );
}
