import { create } from "zustand";
import { TickData, Candle } from "../types";

// Cap elevado de 100 → 1000: antes só guardávamos candles acumulados ao
// vivo desde a conexão (~100s de histórico). Com o fetch de candles
// históricos (Fix #12 da auditoria), precisamos de espaço para os manter.
const MAX_CANDLES = 1000;

interface MarketState {
  symbol: string;
  timeframe: number;
  ticks: TickData[];
  candles: Candle[];

  setSymbol: (symbol: string) => void;
  setTimeframe: (tf: number) => void;
  addTick: (tick: TickData) => void;
  resetMarketData: () => void;
  setHistoricalCandles: (candles: Candle[]) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  symbol: "R_100",
  timeframe: 1,
  ticks: [],
  candles: [],

  setSymbol: (symbol) => set({ symbol, ticks: [], candles: [] }),

  setTimeframe: (timeframe) => set({ timeframe, candles: [] }),

  addTick: (newTick) =>
    set((state) => {
      // Update ticks array (keep last 50)
      const newTicks = [...state.ticks, newTick].slice(-50);

      // Tick → Candle logic
      const currentTimestamp =
        Math.floor(newTick.time / state.timeframe) * state.timeframe;
      const prev = state.candles;
      const lastCandle = prev.length > 0 ? prev[prev.length - 1] : null;

      let newCandles: Candle[];
      if (lastCandle && lastCandle.time === currentTimestamp) {
        // Update existing candle
        const updated: Candle = {
          ...lastCandle,
          high: Math.max(lastCandle.high, newTick.price),
          low: Math.min(lastCandle.low, newTick.price),
          close: newTick.price,
        };
        newCandles = [...prev.slice(0, -1), updated];
      } else {
        // Open new candle
        const newCandle: Candle = {
          time: currentTimestamp,
          open: newTick.price,
          high: newTick.price,
          low: newTick.price,
          close: newTick.price,
        };
        newCandles = [...prev, newCandle].slice(-MAX_CANDLES);
      }

      return { ticks: newTicks, candles: newCandles };
    }),

  resetMarketData: () => set({ ticks: [], candles: [] }),

  // Carrega candles históricos vindos de requestTicksHistory.
  // Substitui o array actual — a stream de ticks ao vivo continua
  // naturalmente a partir do último candle histórico (mesmo time bucket).
  setHistoricalCandles: (candles) =>
    set(() => ({
      candles: [...candles].sort((a, b) => a.time - b.time).slice(-MAX_CANDLES),
    })),
}));
