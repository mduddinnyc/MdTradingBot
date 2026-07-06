"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authApi, signalApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  BarChart2, List, Zap, Settings, LogOut, ShoppingCart,
  Brain, Layers, FlaskConical, Flame, Link2,
} from "lucide-react";
import LiveClock from "@/components/LiveClock";

const NAV_MAIN = [
  { href: "/dashboard",  label: "Dashboard",   icon: BarChart2 },
  { href: "/watchlist",  label: "Watchlist",   icon: List },
  { href: "/signals",    label: "Signals",     icon: Zap },
  { href: "/day-trade",  label: "Day Trade",   icon: Flame },
  { href: "/orders",     label: "Orders",      icon: ShoppingCart },
  { href: "/automation", label: "Automation",  icon: Settings },
  { href: "/analysis",   label: "AI Analysis", icon: Brain },
  { href: "/options",    label: "Options",     icon: Layers },
  { href: "/backtest",   label: "Backtest",    icon: FlaskConical },
];

const NAV_BOTTOM = [
  { href: "/connections", label: "Connections", icon: Link2 },
];

export default function Navbar() {
  const path = usePathname();
  const router = useRouter();

  const { data: status } = useQuery({
    queryKey: ["automation-status"],
    queryFn: signalApi.automationStatus,
    retry: false,
    staleTime: 30_000,
  });
  const autopilotOn = status?.is_enabled;

  const logout = async () => {
    await authApi.logout();
    router.push("/auth/login");
  };

  const navLink = (href: string, label: string, Icon: React.ElementType) => {
    const active = path.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors",
          active
            ? "bg-brand/10 text-brand"
            : "text-gray-400 hover:text-gray-100 hover:bg-gray-800"
        )}
      >
        <Icon size={15} />
        {label}
      </Link>
    );
  };

  return (
    <nav className="w-56 min-h-screen bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Wordmark */}
      <div className="px-4 pt-5 pb-4 border-b border-gray-800">
        <div className="font-mono text-[13px] font-semibold tracking-tight">
          <span className="text-gray-100">TRADING</span>
          <span className="text-brand">AI</span>
        </div>
        <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-0.5">
          Paper mode
        </div>
      </div>

      {/* Autopilot status pill */}
      {autopilotOn && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-buy/10 border border-buy/20 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-buy shrink-0 animate-pulse" />
          <span className="text-[11px] font-medium text-buy">Autopilot active</span>
        </div>
      )}

      {/* Main nav */}
      <div className="flex-1 px-2 pt-3 space-y-0.5">
        {NAV_MAIN.map(({ href, label, icon }) => navLink(href, label, icon))}
      </div>

      {/* Secondary nav + divider */}
      <div className="px-2 pb-2 space-y-0.5">
        <div className="border-t border-gray-800 my-1.5 mx-1" />
        {NAV_BOTTOM.map(({ href, label, icon }) => navLink(href, label, icon))}
      </div>

      {/* Bottom: clock + sign out */}
      <div className="px-4 py-4 border-t border-gray-800 space-y-3">
        <LiveClock />
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-[13px] text-gray-500 hover:text-gray-100 hover:bg-gray-800 transition-colors"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </nav>
  );
}
