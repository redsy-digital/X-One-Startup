import { describe, expect, it } from 'vitest';
import { ForexExperimentalDirectionBridgeV1 } from './bridge';
import { ForexExperimentalAtrDirectionV1 } from './experimental';
import type { Candle } from '../../types';

function candles(n: number): Candle[] {
  const out: Candle[] = [];
  let price = 1.1;
  for (let i = 0; i < n; i++) {
    const step = 0.0002;
    price += step * (1 + (i % 5) * 0.1);
    out.push({ time: 1700000000 + i * 60, open: price - step, high: price + step * 0.5, low: price - step * 0.5, close: price });
  }
  return out;
}

describe('ForexExperimentalDirectionBridgeV1', () => {
  it('exposes the experimental CALL/PUT as a candidate only', () => {
    const experimental = new ForexExperimentalAtrDirectionV1().decide(candles(100), 1, 1700009999);
    const bridge = new ForexExperimentalDirectionBridgeV1().publish(experimental, 1, 1700009999);

    expect(bridge.direction).toBe(experimental.direction);
    expect(bridge.candidate).toBe(['CALL', 'PUT'].includes(experimental.direction));
    expect(bridge.executable).toBe(false);
    expect(bridge.productionEligible).toBe(false);
    expect(bridge.sourceEvidence).toBe('MATRIX_ATR14_INVERSE');
  });

  it('does not manufacture a direction when the experimental engine returns NONE', () => {
    const experimental = new ForexExperimentalAtrDirectionV1().decide(candles(100), 1, 1700009999);
    const none = { ...experimental, direction: 'NONE' as const, score: 0, confidence: 0 };
    const bridge = new ForexExperimentalDirectionBridgeV1().publish(none, 1, 1700009999);

    expect(bridge.direction).toBe('NONE');
    expect(bridge.candidate).toBe(false);
    expect(bridge.executable).toBe(false);
    expect(bridge.productionEligible).toBe(false);
  });
});
