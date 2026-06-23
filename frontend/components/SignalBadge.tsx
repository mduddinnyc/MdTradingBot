import { cn, signalBg } from "@/lib/utils";

export default function SignalBadge({ type }: { type: string }) {
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-bold tracking-wide", signalBg(type))}>
      {type}
    </span>
  );
}
