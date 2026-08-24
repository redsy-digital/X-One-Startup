import { describe, expect, it } from 'vitest';
import { detectSwings, ForexStructureEngineV1 } from './engine';
import type { Candle } from '../../types';

const c = (time: number, open: number, high: number, low: number, close: number): Candle => ({ time, open, high, low, close });

function bullishSequence(): Candle[] {
  return [
    c(1,100,101,99,100), c(2,100,103,99.5,102), c(3,102,104,101,103),
    c(4,103,102,98,99), c(5,99,100,97,98), c(6,98,103,97.5,102),
    c(7,102,106,101,105), c(8,105,104,100,101), c(9,101,107,100.5,106),
  ];
}

describe('ForexStructureEngineV1', () => {
  it('detects confirmed swing highs and lows using closed-candle pivots', () => {
    const swings = detectSwings(bullishSequence(), 1);
    expect(swings.some(s => s.type === 'HIGH')).toBe(true);
    expect(swings.some(s => s.type === 'LOW')).toBe(true);
  });

  it('labels successive highs/lows as HH/HL or LH/LL', () => {
    const snapshot = new ForexStructureEngineV1({ pivotRadius: 1, lookback: 200, levelToleranceAtr: 0.25, minimumLevelTouches: 2 })
      .analyze({ candles: bullishSequence(), timeframeMinutes: 15, atr: 2, calculatedAt: 123 });
    expect(snapshot.swings.some(s => s.label === 'HH')).toBe(true);
    expect(snapshot.swings.some(s => s.label === 'HL')).toBe(true);
  });

  it('never emits a direction as a CALL/PUT signal', () => {
    const snapshot = new ForexStructureEngineV1().analyze({ candles: bullishSequence(), timeframeMinutes: 15, atr: 2, calculatedAt: 123 });
    expect(['BULLISH','BEARISH','RANGE','TRANSITION','UNKNOWN']).toContain(snapshot.direction);
    expect(snapshot).not.toHaveProperty('signal');
  });

  it('is deterministic for the same input and timestamp', () => {
    const input = { candles: bullishSequence(), timeframeMinutes: 15, atr: 2, calculatedAt: 123 };
    const a = new ForexStructureEngineV1().analyze(input);
    const b = new ForexStructureEngineV1().analyze(input);
    expect(a).toEqual(b);
  });
});
