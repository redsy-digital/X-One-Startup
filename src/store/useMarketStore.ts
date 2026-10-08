import { create } from "zustand";
import { TickData, Candle } from "../types";

// Cap elevado de 100 → 1000: antes só guardávamos candles acumulados ao
// vivo desde a conexão (~100s de histórico). Com o fetch de candles
// históricos (Fix #12 da auditoria), precisamos de espaço para os manter.
const MAX_CANDLES = 1000;
const MAX_TICKS = 1000;

interface MarketState {
  // null = ainda não escolhido nesta sessão (mostra o ecrã de escolha).
  // Reinicia a null em cada carregamento de página, de propósito — força
  // uma escolha consciente em vez de assumir silenciosamente o último
  // mercado usado, dado que os defaults (stake, risco, duração) diferem
  // muito entre eles.
  market: "synthetic" | "forex" | null;
  symbol: string;
  timeframe: number;
  ticks: TickData[];
  candles: Candle[];
  historicalTicksLoading: boolean;
  historicalTicksError: string | null;
  pendingLiveTicks: TickData[];

  setMarket: (market: "synthetic" | "forex" | null) => void;
  setSymbol: (symbol: string) => void;
  setTimeframe: (tf: number) => void;
  addTick: (tick: TickData) => void;
  resetMarketData: () => void;
  setHistoricalCandles: (candles: Candle[]) => void;
  setHistoricalTicks: (ticks: TickData[], timeframe: number) => void;
  setHistoricalTicksLoading: (loading: boolean) => void;
  setHistoricalTicksError: (error: string | null) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  market: null,

  // 1HZ100V: maior win rate validado (52.0%, n=867) nos 7 símbolos testados
  // com dados reais de 1s (09/08/2026) — ver /areas ou histórico do chat
  // para o comparativo completo. Estatisticamente empatado com R_50
  // (51.9%, n=1633, amostra maior) — o R_50 é a alternativa mais robusta
  // se preferires priorizar tamanho de amostra sobre o número mais alto.
  symbol: "R_10",
  timeframe: 1,
  ticks: [],
  candles: [],
  historicalTicksLoading: false,
  historicalTicksError: null,
  pendingLiveTicks: [],

  setMarket: (market) => set(() => ({
    market,
    symbol: market === "forex" ? "frxEURUSD" : "R_10",
    timeframe: market === "forex" ? 60 : 1,
    ticks: [],
    candles: [],
    historicalTicksLoading: false,
    historicalTicksError: null,
    pendingLiveTicks: [],
  })),

  setSymbol: (symbol) => set({ symbol, ticks: [], candles: [], historicalTicksLoading: false, historicalTicksError: null, pendingLiveTicks: [] }),

  setTimeframe: (timeframe) => set((state) => {
    const nextTimeframe = Math.max(1, Math.round(timeframe));
    if (state.timeframe === nextTimeframe) return state;

    // Reagrupar os ticks já presentes imediatamente. Não apagar o histórico
    // nem esperar por uma nova subscrição: o timeframe das velas é uma
    // representação local dos mesmos ticks.
    const candles: Candle[] = [];
    for (const tick of state.ticks) {
      const bucket = Math.floor(tick.time / nextTimeframe) * nextTimeframe;
      const last = candles[candles.length - 1];
      if (last && last.time === bucket) {
        last.high = Math.max(last.high, tick.price);
        last.low = Math.min(last.low, tick.price);
        last.close = tick.price;
      } else {
        candles.push({ time: bucket, open: tick.price, high: tick.price, low: tick.price, close: tick.price });
      }
    }
    return { timeframe: nextTimeframe, candles: candles.slice(-MAX_CANDLES) };
  }),

  addTick: (newTick) =>
    set((state) => {
      // During the initial history request, keep every live tick separate.
      // The history response is merged with this queue by epoch afterwards.
      if (state.historicalTicksLoading) {
        const pending = [...state.pendingLiveTicks, newTick];
        const deduped = new Map<number, TickData>();
        for (const tick of pending) deduped.set(tick.time, tick);
        return { pendingLiveTicks: Array.from(deduped.values()).sort((a, b) => a.time - b.time) };
      }

      // Update ticks array
      const newTicks = [...state.ticks, newTick].slice(-MAX_TICKS);

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

  resetMarketData: () => set({ ticks: [], candles: [], historicalTicksLoading: false, historicalTicksError: null, pendingLiveTicks: [] }),

  setHistoricalTicks: (ticks, timeframe) => {
    set((state) => {
      const byEpoch = new Map<number, TickData>();
      // Historical first, then live: live representation wins on duplicate epoch.
      for (const tick of ticks) byEpoch.set(tick.time, tick);
      for (const tick of state.pendingLiveTicks) byEpoch.set(tick.time, tick);
      const sorted = Array.from(byEpoch.values())
        .sort((a, b) => a.time - b.time)
        .slice(-MAX_TICKS);
      const candles: Candle[] = [];
      for (const tick of sorted) {
        const bucket = Math.floor(tick.time / timeframe) * timeframe;
        const last = candles[candles.length - 1];
        if (last && last.time === bucket) {
          last.high = Math.max(last.high, tick.price);
          last.low = Math.min(last.low, tick.price);
          last.close = tick.price;
        } else {
          candles.push({ time: bucket, open: tick.price, high: tick.price, low: tick.price, close: tick.price });
        }
      }
      return { ticks: sorted, candles: candles.slice(-MAX_CANDLES), historicalTicksLoading: false, historicalTicksError: null, pendingLiveTicks: [] };
    });
  },

  setHistoricalTicksLoading: (loading) => set((state) => ({ historicalTicksLoading: loading, pendingLiveTicks: loading ? [] : state.pendingLiveTicks })),
  setHistoricalTicksError: (error) => set((state) => {
    if (!state.pendingLiveTicks.length) return { historicalTicksError: error, historicalTicksLoading: false };
    const byEpoch = new Map<number, TickData>();
    for (const tick of state.ticks) byEpoch.set(tick.time, tick);
    for (const tick of state.pendingLiveTicks) byEpoch.set(tick.time, tick);
    const ticks = Array.from(byEpoch.values()).sort((a, b) => a.time - b.time).slice(-MAX_TICKS);
    return { ticks, historicalTicksError: error, historicalTicksLoading: false, pendingLiveTicks: [] };
  }),

  // Carrega candles históricos vindos de requestTicksHistory.
  // Substitui o array actual — a stream de ticks ao vivo continua
  // naturalmente a partir do último candle histórico (mesmo time bucket).
  setHistoricalCandles: (candles) =>
    set(() => ({
      candles: [...candles].sort((a, b) => a.time - b.time).slice(-MAX_CANDLES),
    })),
}));
