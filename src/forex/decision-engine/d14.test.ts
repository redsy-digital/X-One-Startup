import { describe, expect, it } from 'vitest';
import { validateForexDecisionEngineV1 } from './d14';
import type { ForexDecisionEngineInput } from './engine';

const baseInput = (): ForexDecisionEngineInput => ({
  market: { market: 'forex', symbol: 'frxEURUSD', timeframeMinutes: 15, candles: [], serverTime: 1000, marketOpen: true, dataAsOf: 1000 },
  profile: 'balanced',
  features: { featureId: 'f', values: {}, calculatedAt: 1000, sourceTimeframeMinutes: 15, version: 'forex-features-v1.0.0' },
  regime: { regime: 'TRENDING', confidence: 0.8 },
  signal: { direction: 'CALL', score: 0.8, confidence: 0.8, reasonCode: 'READY_FOR_EXECUTION' },
  calendar: { state: 'CLEAR', relevantEvents: [], checkedAt: 1000 },
  contract: { candidate: { contractType: 'CALL', duration: 15, durationUnit: 'm' } },
  risk: { allowed: true, stake: 0.5, reasonCode: 'READY_FOR_EXECUTION', checkedAt: 1000 },
  now: 1000,
});

describe('D14 — final decision-engine validation', () => {
  it('passes the complete fail-closed validation matrix', () => {
    const report = validateForexDecisionEngineV1(baseInput());
    expect(report.passed).toBe(true);
    expect(report.executionEnabled).toBe(false);
    expect(report.sampleDecision.state).toBe('PROPOSAL_CHECK');
    expect(report.checks.every(c => c.status === 'PASS')).toBe(true);
  });
});
