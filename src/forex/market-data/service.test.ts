import { describe, expect, it } from 'vitest';
import { findSymbolNode, isWithinSchedule } from './service';
import type { ForexTradingSchedule } from './types';

describe('ForexMarketDataService D2 helpers', () => {
  it('finds frxEURUSD inside the hierarchical New API trading_times response', () => {
    const raw = {
      trading_times: {
        markets: [
          { name: 'forex', submarkets: [{ symbols: [{ underlying_symbol: 'frxEURUSD', times: { open: ['00:00:00'], close: ['23:59:59'] } }] }] },
        ],
      },
    };
    expect(findSymbolNode(raw, 'frxEURUSD')?.underlying_symbol).toBe('frxEURUSD');
  });

  it('fails closed when there is no schedule', () => {
    expect(isWithinSchedule(null, Date.UTC(2026, 7, 24, 12, 0, 0))).toBe(false);
  });

  it('recognizes a normal UTC trading window', () => {
    const schedule: ForexTradingSchedule = {
      symbol: 'frxEURUSD',
      tradingDays: ['Monday'],
      openTimes: ['08:00:00'],
      closeTimes: ['17:00:00'],
      settlementTimes: [],
      events: [],
      raw: null,
    };
    expect(isWithinSchedule(schedule, Date.UTC(2026, 7, 24, 12, 0, 0))).toBe(true);
    expect(isWithinSchedule(schedule, Date.UTC(2026, 7, 24, 18, 0, 0))).toBe(false);
  });

  it('handles an overnight window', () => {
    const schedule: ForexTradingSchedule = {
      symbol: 'frxEURUSD',
      tradingDays: ['Sunday'],
      openTimes: ['22:00:00'],
      closeTimes: ['02:00:00'],
      settlementTimes: [],
      events: [],
      raw: null,
    };
    expect(isWithinSchedule(schedule, Date.UTC(2026, 7, 23, 23, 0, 0))).toBe(true);
    expect(isWithinSchedule(schedule, Date.UTC(2026, 7, 23, 12, 0, 0))).toBe(false);
  });
});
