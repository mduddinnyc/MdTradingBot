import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtPct(n: number) {
  return (n * 100).toFixed(1) + "%";
}

export function fmtUsd(n: number | string) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function signalColor(type: string) {
  if (type === "BUY") return "text-buy";
  if (type === "SELL") return "text-sell";
  return "text-hold";
}

export function signalBg(type: string) {
  if (type === "BUY") return "bg-buy/10 text-buy border border-buy/30";
  if (type === "SELL") return "bg-sell/10 text-sell border border-sell/30";
  return "bg-hold/10 text-hold border border-hold/30";
}
