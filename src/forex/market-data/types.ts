import type { Candle } from '../../types';

export interface ForexSymbolMetadata {
  underlyingSymbol: string;
  name: string;
  market: string;
  type: string;
  pipSize: number | null;
  exchangeIsOpen: boolean;
  tradingSuspended: boolean;
}

export interface ForexTradingSchedule {
  symbol: string;
  tradingDays: string[];
  openTimes: string[];
  closeTimes: string[];
  settlementTimes: string[];
  events: unknown[];
  raw: unknown;
}

export interface ForexMarketDataSnapshot {
  symbol: string;
  timeframeMinutes: number;
  candles: Candle[];
  symbolInfo: ForexSymbolMetadata | null;
  schedule: ForexTradingSchedule | null;
  marketOpen: boolean;
  dataAsOf: number | null;
  fetchedAt: number;
}
