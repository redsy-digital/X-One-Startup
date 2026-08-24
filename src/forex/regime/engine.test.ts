import { describe, expect, it } from 'vitest';
import { ForexRegimeEngineV1 } from './engine';
import type { ForexFeatureSnapshot } from '../decision-engine/types';
import type { ForexMarketContext } from '../decision-engine/types';
import type { ForexStructureSnapshot } from '../structure';
import { getForexSession } from '../session';

const market: ForexMarketContext = {
  market: 'forex', symbol: 'frxEURUSD', timeframeMinutes: 15, candles: [],
  marketOpen: true, serverTime: Date.UTC(2026, 7, 24, 13, 0, 0), dataAsOf: Date.UTC(2026, 7, 24, 13, 0, 0),
};
const features = (adx: number, width: number): ForexFeatureSnapshot => ({
  featureId: 'test', version: 'forex-features-v1.0.0', calculatedAt: 1, sourceTimeframeMinutes: 15,
  values: { adx, bollingerWidthPct: width },
});
const structure = (direction: ForexStructureSnapshot['direction'], event: ForexStructureSnapshot['event']): ForexStructureSnapshot => ({
  version: 'forex-structure-v1.0.0', direction, event, eventIndex: null, swings: [], recentSwingHigh: null,
  recentSwingLow: null, support: null, resistance: null, distanceToSupport: null, distanceToResistance: null,
  confidence: 0.8, calculatedAt: 1, sourceTimeframeMinutes: 60,
});

describe('ForexRegimeEngineV1', () => {
  it('classifies directional high-ADX context as TRENDING', () => {
    const r = new ForexRegimeEngineV1().classify(features(32, 0.01), market, structure('BULLISH', 'NONE'), getForexSession(market.serverTime));
    expect(r.regime).toBe('TRENDING');
  });

  it('classifies a volatility expansion with structural break as BREAKOUT', () => {
    const previous = features(20, 0.006);
    const r = new ForexRegimeEngineV1().classify(features(24, 0.008), market, structure('BULLISH', 'BOS_BULLISH'), getForexSession(market.serverTime), previous);
    expect(r.regime).toBe('BREAKOUT');
  });

  it('classifies compressed width as CONSOLIDATING', () => {
    const r = new ForexRegimeEngineV1().classify(features(15, 0.003), market, structure('TRANSITION', 'NONE'), getForexSession(market.serverTime));
    expect(r.regime).toBe('CONSOLIDATING');
  });

  it('classifies low ADX without direction as RANGING', () => {
    const r = new ForexRegimeEngineV1().classify(features(14, 0.01), market, structure('RANGE', 'NONE'), getForexSession(market.serverTime));
    expect(r.regime).toBe('RANGING');
  });

  it('does not emit CALL or PUT', () => {
    const r = new ForexRegimeEngineV1().classify(features(28, 0.01), market, structure('BULLISH', 'NONE'), getForexSession(market.serverTime));
    expect(r).not.toHaveProperty('direction');
  });
});
