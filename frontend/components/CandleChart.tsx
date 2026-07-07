"use client";
import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";
import { cn } from "@/lib/utils";

export interface Bar { t: string; o: number; h: number; l: number; c: number; v: number; }
export type ChartType = "candle" | "line" | "area";

interface Props {
  bars: Bar[];
  signals?: { time: string; type: string }[];
  height?: number;
  showTypeToggle?: boolean;
  defaultType?: ChartType;
}

const TYPE_OPTS: { key: ChartType; label: string }[] = [
  { key: "candle", label: "Candle" },
  { key: "line",   label: "Line"   },
  { key: "area",   label: "Area"   },
];

export default function CandleChart({
  bars,
  signals = [],
  height = 360,
  showTypeToggle = false,
  defaultType = "candle",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [chartType, setChartType] = useState<ChartType>(defaultType);

  useEffect(() => {
    if (!ref.current || !bars.length) return;

    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: "#0f172a" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      crosshair: { mode: CrosshairMode.Normal },
      width: ref.current.clientWidth,
      height,
      timeScale: { borderColor: "#1e293b", timeVisible: true },
      rightPriceScale: { borderColor: "#1e293b" },
    });

    const toTime = (t: string) => Math.floor(new Date(t).getTime() / 1000) as any;

    if (chartType === "candle") {
      const series = chart.addCandlestickSeries({
        upColor: "#10D987", downColor: "#FF4D6D",
        borderUpColor: "#10D987", borderDownColor: "#FF4D6D",
        wickUpColor: "#10D987", wickDownColor: "#FF4D6D",
      });
      series.setData(bars.map((b) => ({
        time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c,
      })));

      // Signal markers
      if (signals.length) {
        series.setMarkers(
          signals
            .map((s) => ({
              time: toTime(s.time),
              position: s.type === "BUY" ? "belowBar" : "aboveBar",
              color: s.type === "BUY" ? "#10D987" : "#FF4D6D",
              shape: s.type === "BUY" ? "arrowUp" : "arrowDown",
              text: s.type,
            } as any))
            .sort((a, b) => a.time - b.time)
        );
      }
    } else if (chartType === "line") {
      const series = chart.addLineSeries({ color: "#5B7FFF", lineWidth: 2 });
      series.setData(bars.map((b) => ({ time: toTime(b.t), value: b.c })));
    } else {
      const series = chart.addAreaSeries({
        lineColor: "#5B7FFF",
        topColor: "rgba(91,127,255,0.35)",
        bottomColor: "rgba(91,127,255,0.02)",
        lineWidth: 2,
      });
      series.setData(bars.map((b) => ({ time: toTime(b.t), value: b.c })));
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);

    return () => { ro.disconnect(); chart.remove(); };
  }, [bars, height, chartType]);

  return (
    <div className="w-full">
      {showTypeToggle && (
        <div className="flex items-center gap-1 mb-2">
          {TYPE_OPTS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setChartType(key)}
              className={cn(
                "px-2.5 py-0.5 text-[11px] font-medium rounded transition-colors",
                chartType === key
                  ? "bg-brand/20 text-brand border border-brand/30"
                  : "text-gray-500 hover:text-gray-200"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div ref={ref} style={{ height }} />
    </div>
  );
}
