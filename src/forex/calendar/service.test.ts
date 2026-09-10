import { describe, expect, it, vi } from "vitest";
import { ForexCalendarServiceImpl } from "./service";
import type { ForexCalendarProvider } from "./types";
import type { ForexEconomicEvent } from "../decision-engine/types";

const event = (id: string, time: number): ForexEconomicEvent => ({
  eventId: id,
  currency: "USD",
  name: "CPI",
  impact: "critical",
  eventTime: time,
});

describe("ForexCalendarServiceImpl (D11)", () => {
  it("merges, deduplicates and sorts events from multiple currencies", async () => {
    const provider: ForexCalendarProvider = {
      getEvents: vi.fn(async (currency) =>
        currency === "EUR"
          ? [event("eur", 300), event("shared", 200)]
          : [event("shared", 200), event("usd", 100)]
      ),
    };
    const service = new ForexCalendarServiceImpl(provider, { cacheTtlSeconds: 60 });
    const events = await service.getEvents(["EUR", "USD"], 0, 500);
    expect(events.map((x) => x.eventId)).toEqual(["usd", "shared", "eur"]);
    expect(provider.getEvents).toHaveBeenCalledTimes(2);
  });

  it("uses the short cache on repeated identical queries", async () => {
    const provider: ForexCalendarProvider = {
      getEvents: vi.fn(async () => [event("one", 100)]),
    };
    const service = new ForexCalendarServiceImpl(provider, { cacheTtlSeconds: 60 });
    await service.getEvents(["EUR"], 0, 500);
    await service.getEvents(["EUR"], 0, 500);
    expect(provider.getEvents).toHaveBeenCalledTimes(1);
  });

  it("builds a snapshot with the configured look-ahead window", async () => {
    const now = 100000;
    const provider: ForexCalendarProvider = {
      getEvents: vi.fn(async (_currency, from, to) => {
        expect(from).toBe(now - 30 * 60);
        expect(to).toBe(now + 180 * 60);
        return [event("future", now + 10 * 60)];
      }),
    };
    const service = new ForexCalendarServiceImpl(provider);
    const snapshot = await service.getSnapshot(["EUR", "USD"], now);
    expect(snapshot.source).toBe("deriv-native");
    expect(snapshot.state).toBe("BLOCK");
    expect(snapshot.relevantEvents).toHaveLength(1);
  });
});
