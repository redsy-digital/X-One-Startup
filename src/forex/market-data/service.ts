import type { Candle } from '../../types';
import type { ForexMarketContext } from '../decision-engine/types';
import { derivService } from '../../lib/deriv';
import type {
  ForexMarketDataSnapshot,
  ForexSymbolMetadata,
  ForexTradingSchedule,
} from './types';

const FOREX_SYMBOL = 'frxEURUSD';
const DEFAULT_TIMEFRAME_MINUTES = 1;
const DEFAULT_CANDLE_COUNT = 500;

/**
 * D2 — Forex market-data adapter.
 *
 * This is deliberately an adapter around the existing DerivService. It does
 * not implement a second WebSocket client and does not contain trading logic.
 * All Deriv-specific field names stay here, keeping the Decision Engine
 * independent from the New API transport.
 */
export class ForexMarketDataService {
  async getSymbolMetadata(symbol = FOREX_SYMBOL): Promise<ForexSymbolMetadata> {
    const symbols = await derivService.getActiveSymbols(['CALL', 'PUT']);
    const item = symbols.find((entry: any) => entry?.underlying_symbol === symbol);
    if (!item) throw new Error(`Símbolo Forex não encontrado em active_symbols: ${symbol}`);

    return {
      underlyingSymbol: String(item.underlying_symbol),
      name: String(item.underlying_symbol_name ?? item.underlying_symbol),
      market: String(item.market ?? ''),
      type: String(item.underlying_symbol_type ?? ''),
      pipSize: Number.isFinite(Number(item.pip_size)) ? Number(item.pip_size) : null,
      exchangeIsOpen: Number(item.exchange_is_open) === 1,
      tradingSuspended: Number(item.is_trading_suspended) === 1,
    };
  }

  async getTradingSchedule(symbol = FOREX_SYMBOL, date = 'today'): Promise<ForexTradingSchedule | null> {
    const raw = await derivService.getTradingTimes(date);
    const node = findSymbolNode(raw, symbol);
    if (!node) return null;

    const times = node?.times ?? {};
    return {
      symbol,
      tradingDays: toStringArray(node?.trading_days ?? node?.tradingDays),
      openTimes: toStringArray(times.open),
      closeTimes: toStringArray(times.close),
      settlementTimes: toStringArray(times.settlement),
      events: Array.isArray(node?.events) ? node.events : [],
      raw: node,
    };
  }

  async loadHistoricalCandles(
    symbol = FOREX_SYMBOL,
    timeframeMinutes = DEFAULT_TIMEFRAME_MINUTES,
    count = DEFAULT_CANDLE_COUNT,
  ): Promise<Candle[]> {
    const granularitySeconds = Math.round(timeframeMinutes * 60);
    if (!Number.isFinite(granularitySeconds) || granularitySeconds < 60) {
      throw new Error('Forex candles exigem timeframe mínimo de 1 minuto.');
    }
    return derivService.getHistoricalCandles(symbol, count, granularitySeconds, 'latest');
  }

  async getSnapshot(
    symbol = FOREX_SYMBOL,
    timeframeMinutes = DEFAULT_TIMEFRAME_MINUTES,
    count = DEFAULT_CANDLE_COUNT,
    now = Date.now(),
  ): Promise<ForexMarketDataSnapshot> {
    const [symbolInfo, schedule, candles] = await Promise.all([
      this.getSymbolMetadata(symbol),
      this.getTradingSchedule(symbol),
      this.loadHistoricalCandles(symbol, timeframeMinutes, count),
    ]);

    const dataAsOf = candles.length ? candles[candles.length - 1].time * 1000 : null;
    const marketOpen = Boolean(
      symbolInfo.exchangeIsOpen &&
      !symbolInfo.tradingSuspended &&
      isWithinSchedule(schedule, now),
    );

    return {
      symbol,
      timeframeMinutes,
      candles,
      symbolInfo,
      schedule,
      marketOpen,
      dataAsOf,
      fetchedAt: now,
    };
  }

  /** Convert the D2 transport snapshot into the D1 Decision Engine context. */
  toDecisionMarketContext(snapshot: ForexMarketDataSnapshot): ForexMarketContext {
    return {
      market: 'forex',
      symbol: snapshot.symbol,
      timeframeMinutes: snapshot.timeframeMinutes,
      candles: snapshot.candles,
      serverTime: snapshot.fetchedAt,
      marketOpen: snapshot.marketOpen,
      dataAsOf: snapshot.dataAsOf ?? undefined,
    };
  }

}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null || value === '') return [];
  return [String(value)];
}

/** Find a New API trading_times symbol node without assuming Legacy shape. */
export function findSymbolNode(node: any, symbol: string): any | null {
  if (!node || typeof node !== 'object') return null;
  if (node.underlying_symbol === symbol || node.symbol === symbol) return node;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findSymbolNode(child, symbol);
      if (found) return found;
    }
    return null;
  }
  for (const value of Object.values(node)) {
    const found = findSymbolNode(value, symbol);
    if (found) return found;
  }
  return null;
}

/**
 * Validate today's trading window using the schedule returned by Deriv.
 * Times are compared as UTC HH:mm:ss because trading_times is a UTC schedule.
 * If the schedule cannot be interpreted, fail closed (false).
 */
export function isWithinSchedule(schedule: ForexTradingSchedule | null, nowMs: number): boolean {
  if (!schedule) return false;
  if (!schedule.openTimes.length || !schedule.closeTimes.length) return false;

  const date = new Date(nowMs);
  const weekday = date.getUTCDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (schedule.tradingDays.length) {
    const normalizedDays = schedule.tradingDays.map(normalizeDay);
    if (!normalizedDays.includes(dayNames[weekday].toLowerCase())) return false;
  }

  const currentSeconds = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
  const opens = schedule.openTimes.map(parseTime).filter((v): v is number => v !== null);
  const closes = schedule.closeTimes.map(parseTime).filter((v): v is number => v !== null);
  if (!opens.length || !closes.length) return false;

  // Pair windows by index. If there is one close after midnight, handle it as
  // an overnight window as well. If Deriv supplies unequal arrays, fail closed.
  if (opens.length !== closes.length) return false;
  return opens.some((open, i) => {
    const close = closes[i];
    if (close >= open) return currentSeconds >= open && currentSeconds < close;
    return currentSeconds >= open || currentSeconds < close;
  });
}

function parseTime(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3] ?? 0);
  if (h > 23 || m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}

function normalizeDay(value: string): string {
  const v = value.trim().toLowerCase().replace(/\s+/g, '');
  const map: Record<string, string> = {
    sun: 'sunday', sunday: 'sunday',
    mon: 'monday', monday: 'monday',
    tue: 'tuesday', tues: 'tuesday', tuesday: 'tuesday',
    wed: 'wednesday', wednesday: 'wednesday',
    thu: 'thursday', thur: 'thursday', thurs: 'thursday', thursday: 'thursday',
    fri: 'friday', friday: 'friday',
    sat: 'saturday', saturday: 'saturday',
  };
  return map[v] ?? v;
}

export const forexMarketDataService = new ForexMarketDataService();
