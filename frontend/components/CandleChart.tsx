"use client";
import { useEffect, useRef } from "react";
import { createChart, ColorType } from "lightweight-charts";

interface Bar { t: string; o: number; h: number; l: number; c: number; v: number; }

interface Props {
  bars: Bar[];
  signals?: { time: string; type: string }[];
  height?: number;
}

export default function CandleChart({ bars, signals = [], height = 360 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !bars.length) return;

    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "#0f172a" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      width: ref.current.clientWidth,
      height,
      timeScale: { borderColor: "#1e293b", timeVisible: true },
      rightPriceScale: { borderColor: "#1e293b" },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const data = bars.map((b) => ({
      time: Math.floor(new Date(b.t).getTime() / 1000) as any,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));
    candleSeries.setData(data);
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: ref.current!.clientWidth });
    });
    resizeObserver.observe(ref.current);

    return () => { resizeObserver.disconnect(); chart.remove(); };
  }, [bars, height]);

  return <div ref={ref} className="w-full" style={{ height }} />;
}
