"use client";
import { useEffect, useState } from "react";

export default function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  return (
    <div className="px-2 text-xs text-gray-400 leading-tight">
      <div className="font-mono text-gray-200">
        {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </div>
      <div>{now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
    </div>
  );
}
