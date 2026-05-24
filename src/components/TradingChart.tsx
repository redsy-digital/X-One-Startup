import React, { useEffect, useRef, useMemo } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  UTCTimestamp,
  CrosshairMode,
  ColorType,
} from "lightweight-charts";
import { Candle } from "../types";

interface TradingChartProps {
  candles: Candle[];
  symbol: string;
}

// ── EMA array (todos os valores, não apenas o último) ─────────────────────────
function emaArray(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return result;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

const TradingChartInner = ({ candles, symbol }: TradingChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaFastRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const prevLengthRef = useRef(0);

  // ── Criar chart na montagem ───────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 280,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6b7280",
        fontSize: 10,
        fontFamily: "monospace",
      },
      grid: {
        vertLines: { color: "#ffffff08" },
        horzLines: { color: "#ffffff08" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#a855f760", labelBackgroundColor: "#7c3aed" },
        horzLine: { color: "#a855f760", labelBackgroundColor: "#7c3aed" },
      },
      rightPriceScale: {
        borderColor: "#ffffff10",
        textColor: "#6b7280",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#ffffff10",
        textColor: "#6b7280",
        timeVisible: true,
        secondsVisible: true,
        tickMarkFormatter: (time: number) => {
          const d = new Date(time * 1000);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
        },
      },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
    });

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#4ade80",
      wickDownColor: "#f87171",
    });

    // EMA 9 (azul)
    const emaFast = chart.addLineSeries({
      color: "#3b82f6",
      lineWidth: 1,
      title: "EMA 9",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // EMA 21 (roxo)
    const emaSlow = chart.addLineSeries({
      color: "#a855f7",
      lineWidth: 1,
      title: "EMA 21",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    emaFastRef.current = emaFast;
    emaSlowRef.current = emaSlow;

    // Resize observer — responsivo ao container
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      emaFastRef.current = null;
      emaSlowRef.current = null;
    };
  }, []);

  // ── Actualizar dados dos candles ──────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    const isReset = candles.length < prevLengthRef.current;
    const isInitial = prevLengthRef.current === 0;

    if (isReset || isInitial) {
      // Full reload
      const data: CandlestickData[] = candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      candleSeriesRef.current.setData(data);
    } else {
      // Update incremental — mais eficiente
      const last = candles[candles.length - 1];
      candleSeriesRef.current.update({
        time: last.time as UTCTimestamp,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      });
    }

    prevLengthRef.current = candles.length;
  }, [candles]);

  // ── Actualizar EMAs ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!emaFastRef.current || !emaSlowRef.current || candles.length < 21) return;

    const closes = candles.map((c) => c.close);
    const fast = emaArray(closes, 9);
    const slow = emaArray(closes, 21);

    const fastData: LineData[] = candles
      .map((c, i) => ({ time: c.time as UTCTimestamp, value: fast[i] }))
      .filter((d) => d.value !== null) as LineData[];

    const slowData: LineData[] = candles
      .map((c, i) => ({ time: c.time as UTCTimestamp, value: slow[i] }))
      .filter((d) => d.value !== null) as LineData[];

    emaFastRef.current.setData(fastData);
    emaSlowRef.current.setData(slowData);
  }, [candles]);

  return (
    <div className="relative">
      {/* Legenda das EMAs */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-3 pointer-events-none">
        <div className="flex items-center gap-1">
          <div className="w-4 h-0.5 bg-blue-500" />
          <span className="text-[9px] text-blue-400 font-bold font-mono">EMA 9</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-0.5 bg-purple-500" />
          <span className="text-[9px] text-purple-400 font-bold font-mono">EMA 21</span>
        </div>
        <span className="text-[9px] text-muted-foreground font-mono">{symbol}</span>
      </div>

      {/* Container do chart */}
      <div ref={containerRef} className="w-full" />

      {/* Estado vazio */}
      {candles.length < 10 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-widest animate-pulse">
            A acumular candles... ({candles.length}/10)
          </p>
        </div>
      )}
    </div>
  );
};

export const TradingChart = React.memo(TradingChartInner);
