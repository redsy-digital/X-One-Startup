import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import type { ForexMarketContext } from './decision-engine/types';
import { ForexFeatureEngineV1 } from './features';

function candles(count = 100): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 1.08 + i * 0.0001 + Math.sin(i / 7) * 0.0005;
    return {
      time: 1_700_000_000 + i * 900,
      open: base,
      high: base + 0.0004,
      low: base - 0.0003,
      close: base + Math.sin(i / 3) * 0.0001,
    };
  });
}

function context(overrides: Partial<ForexMarketContext> = {}): ForexMarketContext {
  const data = candles();
  return {
    market: 'forex', symbol: 'frxEURUSD', timeframeMinutes: 15,
    candles: data, marketOpen: true, dataAsOf: data[data.length - 1].time,
    ...overrides,
  };
}

describe('ForexFeatureEngineV1', () => {
  it('calculates the frozen 12-feature catalog without NaN/Infinity', () => {
    const snapshot = new ForexFeatureEngineV1().calculate(context());
    expect(Object.keys(snapshot.values)).toHaveLength(12);
    for (const value of Object.values(snapshot.values)) expect(Number.isFinite(value)).toBe(true);
    expect(snapshot.version).toBe('forex-features-v1.0.0');
  });

  it('does not use candles newer than dataAsOf', () => {
    const data = candles();
    const snapshot = new ForexFeatureEngineV1().calculate(context({ candles: data, dataAsOf: data[89].time }));
    expect(snapshot.calculatedAt).toBeGreaterThan(0);
  });

  it('rejects malformed chronology', () => {
    const data = candles();
    data[50].time = data[49].time;
    expect(() => new ForexFeatureEngineV1().calculate(context({ candles: data }))).toThrow(/ordenados/);
  });

  it('rejects insufficient data', () => {
    expect(() => new ForexFeatureEngineV1().calculate(context({ candles: candles(59) }))).toThrow(/Dados insuficientes/);
  });
});
