import { describe, expect, it } from 'vitest';
import { ForexDirectionEngineV1 } from './engine';
import type { ForexFeatureSnapshot, ForexMarketContext, ForexRegimeResult } from '../decision-engine/types';
import type { ForexStructureSnapshot } from '../structure';

const features: ForexFeatureSnapshot = {
  featureId: 'test',
  calculatedAt: Date.now(),
  sourceTimeframeMinutes: 15,
  version: 'forex-features-v1.0.0',
  values: {
    emaSpread: 0.8, rsiCentered: 0.6, macdHistogram: 0.4, adxDirection: 0.7,
    atrPct: 0.01, bollingerPosition: 0.7, bollingerWidthPct: 0.01, roc: 0.2,
    bodyPct: 0.001, rangePct: 0.002, closeLocation: 0.8, volatility20: 0.01,
  },
};

const market: ForexMarketContext = {
  market: 'forex', symbol: 'frxEURUSD', timeframeMinutes: 15, candles: [], marketOpen: true,
};

const regime: ForexRegimeResult = {
  regime: 'TRENDING', confidence: 0.8, featureSnapshot: features,
};

const structure = {
  version: 'forex-structure-v1.0.0', direction: 'BULLISH', event: 'NONE', eventIndex: null,
  swings: [], recentSwingHigh: null, recentSwingLow: null, support: null, resistance: null,
  distanceToSupport: null, distanceToResistance: null, confidence: 0.8, calculatedAt: Date.now(),
  sourceTimeframeMinutes: 15,
} satisfies ForexStructureSnapshot;

describe('ForexDirectionEngineV1', () => {
  it('does not promote a feature merely because its raw value is directional', () => {
    const result = new ForexDirectionEngineV1().decide(features, regime, market, structure);
    expect(result.direction).toBe('NONE');
    expect(result.snapshot.tradable).toBe(false);
    expect(result.reasonCode).toBe('SIGNAL_NONE');
  });

  it('accepts only explicitly approved evidence', () => {
    const engine = new ForexDirectionEngineV1({
      version: 'forex-direction-v1.0.0', minimumAbsoluteScore: 0.55, minimumConfidence: 0.55,
      minimumVotes: 2, allowUnapprovedWeights: false,
      weights: [
        { feature: 'emaSpread', weight: 0.4, approved: true, evidenceId: 'OOS-EMA-01' },
        { feature: 'adxDirection', weight: 0.4, approved: true, evidenceId: 'OOS-ADX-01' },
        { feature: 'rsiCentered', weight: 0.2, approved: false },
      ],
    });
    const result = engine.decide(features, regime, market, structure);
    expect(result.direction).toBe('CALL');
    expect(result.snapshot.tradable).toBe(true);
    expect(result.snapshot.evidence).toHaveLength(2);
  });

  it('rejects a directional candidate when structure contradicts it', () => {
    const engine = new ForexDirectionEngineV1({
      version: 'forex-direction-v1.0.0', minimumAbsoluteScore: 0.55, minimumConfidence: 0.55,
      minimumVotes: 2, allowUnapprovedWeights: false,
      weights: [
        { feature: 'emaSpread', weight: 0.4, approved: true, evidenceId: 'OOS-EMA-01' },
        { feature: 'adxDirection', weight: 0.4, approved: true, evidenceId: 'OOS-ADX-01' },
      ],
    });
    const bearish = { ...structure, direction: 'BEARISH' } satisfies ForexStructureSnapshot;
    const result = engine.decide(features, regime, market, bearish);
    expect(result.direction).toBe('NONE');
    expect(result.reasonCode).toBe('SIGNAL_BELOW_THRESHOLD');
  });
});
