"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authApi, signalApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Zap, ArrowLeftRight, Briefcase,
  Brain, FlaskConical, Link2, LogOut,
} from "lucide-react";
import LiveClock from "@/components/LiveClock";

const NAV_MAIN = [
  { href: "/dashboard",  label: "Dashboard",  icon: LayoutDashboard },
  { href: "/signals",    label: "Signals",    icon: Zap },
  { href: "/trade",      label: "Trade",      icon: ArrowLeftRight },
  { href: "/positions",  label: "Positions",  icon: Briefcase },
  { href: "/analysis",   label: "Analysis",   icon: Brain },
  { href: "/backtest",   label: "Backtest",   icon: FlaskConical },
];

const NAV_BOTTOM = [
  { href: "/connections", label: "Connections", icon: Link2 },
];

export default function Navbar() {
  const path = usePathname();
  const router = useRouter();

  const { data: autoStatus } = useQuery({
    queryKey: ["automation-status"],
    queryFn: signalApi.automationStatus,
    retry: false,
    staleTime: 30_000,
  });

  const autopilotOn = autoStatus?.config?.is_enabled;
  const pendingCount = (autoStatus?.today?.pending_approval ?? 0);

  const logout = async () => {
    await authApi.logout();
    router.push("/auth/login");
  };

  const navLink = (href: string, label: string, Icon: React.ElementType, badge?: number) => {
    const active =
      href === "/dashboard"
        ? path === "/dashboard"
        : path.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all",
          active
            ? "bg-brand/10 text-brand"
            : "text-gray-500 hover:text-gray-100 hover:bg-gray-800/60"
        )}
      >
        <Icon size={15} className="shrink-0" />
        <span className="flex-1">{label}</span>
        {badge != null && badge > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-hold/20 text-hold leading-none min-w-[18px] text-center">
            {badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav className="w-52 min-h-screen bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Wordmark */}
      <div className="px-4 pt-5 pb-4 border-b border-gray-800">
        <div className="font-mono text-[13px] font-semibold tracking-tight leading-none">
          <span className="text-gray-100">TRADING</span>
          <span className="text-brand">AI</span>
        </div>
        <div className="text-[9px] text-gray-600 uppercase tracking-[0.18em] mt-1">
          Paper mode · Sandbox
        </div>
      </div>

      {/* Autopilot status */}
      {autopilotOn && (
        <div className="mx-3 mt-3 px-3 py-1.5 rounded-lg bg-buy/8 border border-buy/20 flex items-center gap-2">
          <span className="dot-live" />
          <span className="text-[11px] font-medium text-buy">Autopilot on</span>
          {autoStatus?.today?.filled != null && (
            <span className="ml-auto text-[10px] text-buy/60 font-mono">
              {autoStatus.today.filled} filled
            </span>
          )}
        </div>
      )}

      {/* Main nav */}
      <div className="flex-1 px-2 pt-3 space-y-0.5">
        {NAV_MAIN.map(({ href, label, icon }) =>
          navLink(
            href,
            label,
            icon,
            href === "/trade" && pendingCount > 0 ? pendingCount : undefined
          )
        )}
      </div>

      {/* Bottom nav */}
      <div className="px-2 pb-2 space-y-0.5">
        <div className="border-t border-gray-800 my-1.5 mx-1" />
        {NAV_BOTTOM.map(({ href, label, icon }) => navLink(href, label, icon))}
      </div>

      {/* Clock + logout */}
      <div className="px-4 py-4 border-t border-gray-800 space-y-3">
        <LiveClock />
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-[13px] text-gray-500 hover:text-gray-100 hover:bg-gray-800/60 transition-all"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </nav>
  );
}
