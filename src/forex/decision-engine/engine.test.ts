import { describe, expect, it } from 'vitest';
import { ForexDecisionEngineV1 } from './engine';
import type { ForexDecisionEngineInput } from './engine';

const baseInput = (): ForexDecisionEngineInput => ({
  market: {
    market: 'forex', symbol: 'frxEURUSD', timeframeMinutes: 15, candles: [],
    serverTime: 1000, marketOpen: true, dataAsOf: 1000,
  },
  profile: 'balanced',
  features: { featureId: 'f', values: {}, calculatedAt: 1000, sourceTimeframeMinutes: 15, version: 'forex-features-v1.0.0' },
  regime: { regime: 'TRENDING', confidence: 0.8 },
  signal: { direction: 'CALL', score: 0.8, confidence: 0.8, reasonCode: 'READY_FOR_EXECUTION' },
  calendar: { state: 'CLEAR', relevantEvents: [], checkedAt: 1000 },
  contract: { candidate: { contractType: 'CALL', duration: 15, durationUnit: 'm' } },
  risk: { allowed: true, stake: 0.5, reasonCode: 'READY_FOR_EXECUTION', checkedAt: 1000 },
  now: 1000,
});

describe('ForexDecisionEngineV1 — D13', () => {
  it('approves all gates up to Proposal without executing', () => {
    const result = new ForexDecisionEngineV1().evaluate(baseInput());
    expect(result.state).toBe('PROPOSAL_CHECK');
    expect(result.direction).toBe('CALL');
    expect(result.reasonCode).toBe('READY_FOR_EXECUTION');
  });

  it('calendar BLOCK is a hard gate', () => {
    const input = baseInput();
    input.calendar = { state: 'BLOCK', reasonCode: 'NEWS_BLOCK_HIGH_IMPACT', relevantEvents: [], checkedAt: 1000 };
    const result = new ForexDecisionEngineV1().evaluate(input);
    expect(result.state).toBe('NEWS_BLOCK');
    expect(result.direction).toBe('NONE');
  });

  it('calendar WATCH requires explicit additional confirmation', () => {
    const input = baseInput();
    input.calendar = { state: 'WATCH', relevantEvents: [], checkedAt: 1000 };
    const result = new ForexDecisionEngineV1().evaluate(input);
    expect(result.reasonCode).toBe('NEWS_WATCH_REQUIRES_CONFIRMATION');
    expect(result.state).toBe('NEWS_BLOCK');
  });

  it('does not allow a contract with the opposite direction', () => {
    const input = baseInput();
    input.contract = { candidate: { contractType: 'PUT', duration: 15, durationUnit: 'm' } };
    const result = new ForexDecisionEngineV1().evaluate(input);
    expect(result.state).toBe('WAIT_CONTRACT');
  });

  it('fails closed when risk is denied', () => {
    const input = baseInput();
    input.risk = { allowed: false, stake: 0.5, reasonCode: 'RISK_LIMIT', reason: 'limite', checkedAt: 1000 };
    const result = new ForexDecisionEngineV1().evaluate(input);
    expect(result.state).toBe('RISK_BLOCK');
  });

  it('fails closed when market data is stale', () => {
    const input = baseInput();
    input.now = 1201;
    const result = new ForexDecisionEngineV1().evaluate(input);
    expect(result.reasonCode).toBe('MARKET_DATA_STALE');
  });
});
