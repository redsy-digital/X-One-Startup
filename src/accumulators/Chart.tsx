import React, { useEffect, useRef } from "react";
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, LineData, UTCTimestamp } from "lightweight-charts";
import type { AccumulatorChartPoint } from "./types";
import { Candle } from "../types";

interface Props {
  candles: Candle[];
  points: AccumulatorChartPoint[];
  symbol: string;
}

export const AccumulatorChart = React.memo(({ candles, points, symbol }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<"Line"> | null>(null);
  const highRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const entryRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 300,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#6b7280", fontSize: 10, fontFamily: "monospace" },
      grid: { vertLines: { color: "#ffffff08" }, horzLines: { color: "#ffffff08" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#ffffff10", textColor: "#6b7280", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: "#ffffff10", timeVisible: true, secondsVisible: true },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
    });

    priceRef.current = chart.addLineSeries({ lineWidth: 2, title: "Preço", priceLineVisible: false, lastValueVisible: true });
    highRef.current = chart.addLineSeries({ lineWidth: 1, lineStyle: 2, title: "High", priceLineVisible: false, lastValueVisible: true });
    lowRef.current = chart.addLineSeries({ lineWidth: 1, lineStyle: 2, title: "Low", priceLineVisible: false, lastValueVisible: true });
    entryRef.current = chart.addLineSeries({ lineWidth: 1, lineStyle: 1, title: "Entrada", priceLineVisible: false, lastValueVisible: true });
    chartRef.current = chart;

    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    observer.observe(containerRef.current);
    return () => { observer.disconnect(); chart.remove(); chartRef.current = null; priceRef.current = null; highRef.current = null; lowRef.current = null; entryRef.current = null; };
  }, []);

  useEffect(() => {
    if (!priceRef.current) return;
    const fallback: LineData[] = candles.map(c => ({ time: c.time as UTCTimestamp, value: c.close }));
    const live: LineData[] = points.map(p => ({ time: p.time as UTCTimestamp, value: p.price }));
    priceRef.current.setData([...fallback, ...live].sort((a,b) => Number(a.time) - Number(b.time)).filter((v,i,a) => i === 0 || Number(v.time) !== Number(a[i-1].time)));
    highRef.current?.setData(points.filter(p => Number.isFinite(p.high)).map(p => ({ time: p.time as UTCTimestamp, value: p.high! })));
    lowRef.current?.setData(points.filter(p => Number.isFinite(p.low)).map(p => ({ time: p.time as UTCTimestamp, value: p.low! })));
    const entry = points[0]?.price;
    if (entry != null && points.length) entryRef.current?.setData(points.map(p => ({ time: p.time as UTCTimestamp, value: entry })));
    if (points.length > 1) {
      const last = points[points.length - 1];
      chartRef.current?.timeScale().scrollToPosition(0, false);
      void last;
    }
  }, [candles, points]);

  return (
    <div className="relative">
      <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-3 pointer-events-none">
        <Legend label="PREÇO" />
        <Legend label="HIGH" dashed />
        <Legend label="LOW" dashed />
        <Legend label="ENTRADA" dashed />
        <span className="text-[9px] text-muted-foreground font-mono">{symbol} · ACCU</span>
      </div>
      <div ref={containerRef} className="w-full" />
      {points.length === 0 && candles.length < 2 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-widest animate-pulse">A carregar preço...</p>
        </div>
      )}
    </div>
  );
});

const Legend = ({ label, dashed }: { label: string; dashed?: boolean }) => (
  <div className="flex items-center gap-1"><div className={`w-4 h-0.5 ${dashed ? "border-t border-dashed border-cyan-400" : "bg-cyan-400"}`} /><span className="text-[8px] text-muted-foreground font-bold font-mono">{label}</span></div>
);
