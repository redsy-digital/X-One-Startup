import type { ForexEconomicEvent, ForexCalendarDecision } from "../decision-engine/types";
import type { ForexCalendarConfig, ForexCalendarProvider } from "./types";
import { DEFAULT_FOREX_CALENDAR_CONFIG } from "./types";
import { evaluateForexCalendar } from "./engine";

interface CacheEntry {
  expiresAt: number;
  events: ForexEconomicEvent[];
}

/**
 * D11 — Native Deriv Economic Calendar service.
 *
 * Responsibilities:
 * - fetch EUR/USD (or any supplied currencies) through the native provider;
 * - use a bounded time window around "now";
 * - cache briefly to avoid one API call per decision cycle;
 * - merge and deduplicate events;
 * - evaluate the calendar through the pure calendar engine.
 *
 * It does not execute trades and does not know about proposals/buy.
 */
export class ForexCalendarServiceImpl {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly config: ForexCalendarConfig;

  constructor(
    private readonly provider: ForexCalendarProvider,
    config?: Partial<ForexCalendarConfig>,
  ) {
    this.config = { ...DEFAULT_FOREX_CALENDAR_CONFIG, ...(config ?? {}) };
  }

  async getEvents(currencies: string[], from: number, to: number): Promise<ForexEconomicEvent[]> {
    const normalized = [...new Set(currencies.map((c) => c.trim().toUpperCase()).filter(Boolean))].sort();
    if (!normalized.length || to < from) return [];

    const results = await Promise.all(
      normalized.map((currency) => this.getCurrencyEvents(currency, from, to)),
    );

    const byId = new Map<string, ForexEconomicEvent>();
    for (const event of results.flat()) {
      const key = `${event.eventId}|${event.currency}|${event.eventTime}|${event.name}`;
      byId.set(key, event);
    }

    return [...byId.values()].sort((a, b) => a.eventTime - b.eventTime);
  }

  evaluate(events: ForexEconomicEvent[], now: number): ForexCalendarDecision {
    return evaluateForexCalendar({
      now,
      events,
      config: this.config,
    });
  }

  async getSnapshot(currencies: string[], now = Math.floor(Date.now() / 1000)) {
    const from = now - this.config.lookBehindMinutes * 60;
    const to = now + this.config.lookAheadMinutes * 60;
    const events = await this.getEvents(currencies, from, to);
    return {
      source: "deriv-native" as const,
      currencies: [...new Set(currencies.map((c) => c.toUpperCase()))],
      ...this.evaluate(events, now),
    };
  }

  clearCache() {
    this.cache.clear();
  }

  private async getCurrencyEvents(currency: string, from: number, to: number) {
    const key = `${currency}:${from}:${to}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.events;

    const events = await this.provider.getEvents(currency, from, to);
    this.cache.set(key, {
      expiresAt: now + this.config.cacheTtlSeconds * 1000,
      events,
    });
    return events;
  }
}
