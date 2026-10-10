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
  chartType?: "candles" | "line";
  showIndicators?: boolean;
  showSymbolLabel?: boolean;
  percentChannel?: { upper: number; lower: number; center: number } | null;
  sustainableInertia?: { resistance: number; support: number; trendline: { time: number; value: number }[] } | null;
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

const TradingChartInner = ({ candles, symbol, chartType = "candles", showIndicators = true, showSymbolLabel = true, percentChannel = null, sustainableInertia = null }: TradingChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaFastRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSlowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const channelLinesRef = useRef<{ upper: any; lower: any; center: any } | null>(null);
  const inertiaLinesRef = useRef<{ resistance: any; support: any } | null>(null);
  const inertiaTrendRef = useRef<ISeriesApi<"Line"> | null>(null);
  const prevLengthRef = useRef(0);
  const prevFirstTimeRef = useRef<number | null>(null);
  const prevLastTimeRef = useRef<number | null>(null);
  const prevIntervalRef = useRef<number | null>(null);

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

    const lineSeries = chart.addLineSeries({
      color: "#22c55e",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      visible: chartType === "line",
    });

    candleSeries.applyOptions({ visible: chartType === "candles" });

    // EMA 9 (azul)
    const emaFast = chart.addLineSeries({
      color: "#3b82f6",
      lineWidth: 1,
      title: "EMA 9",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // EMA 21 (roxo)
    const inertiaTrend = chart.addLineSeries({ color: "#3b82f6", lineWidth: 1, lineStyle: 0, title: "Gradiente de Inércia", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    inertiaTrend.setData([]);

    const emaSlow = chart.addLineSeries({
      color: "#a855f7",
      lineWidth: 1,
      title: "EMA 21",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    emaFastRef.current = emaFast;
    emaSlowRef.current = emaSlow;
    inertiaTrendRef.current = inertiaTrend;

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
      lineSeriesRef.current = null;
      emaFastRef.current = null;
      emaSlowRef.current = null;
      inertiaTrendRef.current = null;
    };
  }, [chartType]);

  useEffect(() => {
    const series: any = chartType === "candles" ? candleSeriesRef.current : lineSeriesRef.current;
    if (!series) return;
    if (channelLinesRef.current) {
      try { series.removePriceLine(channelLinesRef.current.upper); series.removePriceLine(channelLinesRef.current.lower); series.removePriceLine(channelLinesRef.current.center); } catch {}
      channelLinesRef.current = null;
    }
    if (percentChannel) {
      channelLinesRef.current = {
        upper: series.createPriceLine({ price: percentChannel.upper, color: "#22c55e", lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: "Highest High" }),
        lower: series.createPriceLine({ price: percentChannel.lower, color: "#ef4444", lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: "Lowest Low" }),
        center: series.createPriceLine({ price: percentChannel.center, color: "#3b82f6", lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: "Center Line" }),
      };
    }
    return () => { if (channelLinesRef.current) { try { series.removePriceLine(channelLinesRef.current.upper); series.removePriceLine(channelLinesRef.current.lower); series.removePriceLine(channelLinesRef.current.center); } catch {} channelLinesRef.current = null; } };
  }, [percentChannel?.upper, percentChannel?.lower, percentChannel?.center, chartType, candles.length]);

  useEffect(() => {
    const series: any = chartType === "candles" ? candleSeriesRef.current : lineSeriesRef.current;
    if (!series || !inertiaTrendRef.current) return;
    if (inertiaLinesRef.current) {
      try { series.removePriceLine(inertiaLinesRef.current.resistance); series.removePriceLine(inertiaLinesRef.current.support); } catch {}
      inertiaLinesRef.current = null;
    }
    if (sustainableInertia) {
      inertiaLinesRef.current = {
        resistance: series.createPriceLine({ price: sustainableInertia.resistance, color: "#22c55e", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Resistência HH" }),
        support: series.createPriceLine({ price: sustainableInertia.support, color: "#ef4444", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Suporte LL" }),
      };
      const sortedTrend = sustainableInertia.trendline.filter(p => Number.isFinite(p.time) && Number.isFinite(p.value)).slice(-5);
      const points: LineData[] = [];
      let lastTime = Number.NEGATIVE_INFINITY;
      for (const point of sortedTrend) {
        // Deriv can emit multiple ticks with the same epoch second. Lightweight
        // Charts requires strictly increasing times, so keep the tick order
        // while disambiguating same-second points for this visual overlay.
        const time = Math.max(Math.floor(point.time), lastTime + 1);
        points.push({ time: time as UTCTimestamp, value: point.value });
        lastTime = time;
      }
      inertiaTrendRef.current.setData(points);
    } else inertiaTrendRef.current.setData([]);
    return () => {
      if (inertiaLinesRef.current) { try { series.removePriceLine(inertiaLinesRef.current.resistance); series.removePriceLine(inertiaLinesRef.current.support); } catch {} inertiaLinesRef.current = null; }
      inertiaTrendRef.current?.setData([]);
    };
  }, [sustainableInertia?.resistance, sustainableInertia?.support, sustainableInertia?.trendline, chartType, candles.length]);

  // ── Actualizar dados dos candles ──────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    if (candles.length === 0) {
      prevLengthRef.current = 0;
      prevFirstTimeRef.current = null;
      prevLastTimeRef.current = null;
      prevIntervalRef.current = null;
      candleSeriesRef.current.setData([]);
      lineSeriesRef.current?.setData([]);
      emaFastRef.current?.setData([]);
      emaSlowRef.current?.setData([]);
      return;
    }

    const firstTime = candles[0]?.time ?? null;
    const lastTime = candles[candles.length - 1]?.time ?? null;
    const currentInterval = candles.length >= 2 ? candles[1].time - candles[0].time : null;
    const timeframeChanged =
      prevIntervalRef.current !== null &&
      currentInterval !== null &&
      prevIntervalRef.current !== currentInterval;
    const datasetReset =
      timeframeChanged ||
      (prevFirstTimeRef.current !== null && firstTime !== null && prevFirstTimeRef.current !== firstTime) ||
      candles.length < prevLengthRef.current;
    const isInitial = prevLengthRef.current === 0;

    if (datasetReset || isInitial) {
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

    lineSeriesRef.current?.setData(candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.close,
    })));

    prevLengthRef.current = candles.length;
    prevFirstTimeRef.current = firstTime;
    prevLastTimeRef.current = lastTime;
    prevIntervalRef.current = currentInterval;
  }, [candles]);

  // ── Actualizar EMAs ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!showIndicators || chartType !== "candles") {
      emaFastRef.current?.setData([]);
      emaSlowRef.current?.setData([]);
      return;
    }
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
  }, [candles, chartType, showIndicators]);

  return (
    <div className="relative">
      {showSymbolLabel && (
        <div className="absolute top-2 left-2 z-10 pointer-events-none">
          <span className="text-[9px] text-muted-foreground font-mono">{symbol}</span>
        </div>
      )}

      {/* Container do chart */}
      <div ref={containerRef} className="w-full" />

      {/* Estado vazio */}
      {candles.length < 10 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-widest animate-pulse">
            A carregar histórico... ({candles.length})
          </p>
        </div>
      )}
    </div>
  );
};

export const TradingChart = React.memo(TradingChartInner);
