import { Candle } from "../types";

/**
 * Candles SINTÉTICOS e determinísticos — usados apenas para testar a
 * CORRECÇÃO da lógica (matemática dos indicadores, máquina de estados
 * da estrutura, mecânica do backtest).
 *
 * IMPORTANTE: isto não substitui dados reais da Deriv para validar a
 * PERFORMANCE/assertividade da estratégia. Para isso é preciso o
 * dataset de referência real — ver src/lib/dataset.ts e a nota sobre
 * a Fase 2 no relatório da auditoria.
 */

// PRNG determinístico simples (mulberry32), para candles "ruidosos"
// mas reprodutíveis entre execuções — sem depender de Math.random().
function mulberry32(seed: number) {
  let s = seed;
  return function (): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Candles totalmente planos (open=high=low=close constante). */
export function makeFlatCandles(count: number, price = 100, startTime = 1_700_000_000): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    candles.push({ time: startTime + i * 60, open: price, high: price, low: price, close: price });
  }
  return candles;
}

/** Candles em tendência constante (cada candle sobe/desce `step`). */
export function makeTrendingCandles(
  count: number,
  opts: { start?: number; step?: number; startTime?: number; intervalSec?: number } = {}
): Candle[] {
  const { start = 100, step = 0.05, startTime = 1_700_000_000, intervalSec = 60 } = opts;
  const candles: Candle[] = [];
  let price = start;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price + step;
    const high = Math.max(open, close) + Math.abs(step) * 0.2;
    const low = Math.min(open, close) - Math.abs(step) * 0.2;
    candles.push({ time: startTime + i * intervalSec, open, high, low, close });
    price = close;
  }
  return candles;
}

/**
 * Candles de "1 tick": open sempre igual a close (como os que a Deriv
 * devolve para símbolos que tickam mais devagar que o timeframe pedido,
 * ex. R_100 a 1s — achado real da Fase 3). Ainda assim há uma tendência
 * real entre candles consecutivos (o preço move-se de candle para candle,
 * só não DENTRO de cada candle).
 */
export function makeSingleTickTrendingCandles(
  count: number,
  opts: { start?: number; step?: number; startTime?: number; intervalSec?: number } = {}
): Candle[] {
  const { start = 100, step = 0.05, startTime = 1_700_000_000, intervalSec = 60 } = opts;
  const candles: Candle[] = [];
  let price = start;
  for (let i = 0; i < count; i++) {
    price += step;
    candles.push({ time: startTime + i * intervalSec, open: price, high: price, low: price, close: price });
  }
  return candles;
}
export function makeChoppyCandles(
  count: number,
  opts: { base?: number; amplitude?: number; startTime?: number; intervalSec?: number; seed?: number } = {}
): Candle[] {
  const { base = 100, amplitude = 0.3, startTime = 1_700_000_000, intervalSec = 60, seed = 42 } = opts;
  const rand = mulberry32(seed);
  const candles: Candle[] = [];
  let price = base;
  for (let i = 0; i < count; i++) {
    const open = price;
    const delta = (rand() - 0.5) * 2 * amplitude;
    const close = base + delta;
    const high = Math.max(open, close) + amplitude * 0.3;
    const low = Math.min(open, close) - amplitude * 0.3;
    candles.push({ time: startTime + i * intervalSec, open, high, low, close });
    price = close;
  }
  return candles;
}
