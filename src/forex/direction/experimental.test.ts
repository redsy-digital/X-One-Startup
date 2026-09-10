import { describe, expect, it } from 'vitest';
import { ForexExperimentalAtrDirectionV1 } from './experimental';
import type { Candle } from '../../types';

function candles(n: number, direction: 'up' | 'down'): Candle[] {
  const out: Candle[] = [];
  let price = 1.1;
  for (let i = 0; i < n; i++) {
    const step = direction === 'up' ? 0.0002 : -0.0002;
    price += step * (1 + (i % 5) * 0.1);
    out.push({ time: 1700000000 + i * 60, open: price - step, high: price + Math.abs(step) * 0.5, low: price - Math.abs(step) * 0.5, close: price });
  }
  return out;
}

describe('ForexExperimentalAtrDirectionV1', () => {
  it('is explicitly non-executable', () => {
    const result = new ForexExperimentalAtrDirectionV1().decide(candles(100, 'up'), 1);
    expect(result.executable).toBe(false);
    expect(result.evidence).toBe('MATRIX_ATR14_INVERSE');
  });

  it('never claims production direction through this experimental engine', () => {
    const result = new ForexExperimentalAtrDirectionV1().decide(candles(100, 'up'), 1);
    expect(['CALL', 'PUT', 'NONE']).toContain(result.direction);
    expect(result.version).toContain('experimental');
  });
});
