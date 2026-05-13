import { create } from "zustand";
import { TickData, Candle } from "../types";

interface MarketState {
  symbol: string;
  timeframe: number;
  ticks: TickData[];
  candles: Candle[];

  setSymbol: (symbol: string) => void;
  setTimeframe: (tf: number) => void;
  addTick: (tick: TickData) => void;
  resetMarketData: () => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  symbol: "R_100",
  timeframe: 1,
  ticks: [],
  candles: [],

  setSymbol: (symbol) => set({ symbol, ticks: [], candles: [] }),

  setTimeframe: (timeframe) => set({ timeframe }),

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
        newCandles = [...prev, newCandle].slice(-100);
      }

      return { ticks: newTicks, candles: newCandles };
    }),

  resetMarketData: () => set({ ticks: [], candles: [] }),
}));
