import { describe, expect, it } from "vitest";
import { evaluateForexCalendar } from "./engine";
import type { ForexEconomicEvent } from "../decision-engine/types";

const event = (impact: ForexEconomicEvent["impact"], offset: number): ForexEconomicEvent => ({
  eventId: `${impact}-${offset}`,
  currency: "USD",
  name: "Test",
  impact,
  eventTime: 100000 + offset,
});

describe("Forex calendar engine", () => {
  it("blocks high impact before the event", () => {
    const result = evaluateForexCalendar({ now: 100000 - 10 * 60, events: [event("high", 0)] });
    expect(result.state).toBe("BLOCK");
    expect(result.reasonCode).toBe("NEWS_BLOCK_HIGH_IMPACT");
  });

  it("blocks high impact after the event", () => {
    const result = evaluateForexCalendar({ now: 100000 + 10 * 60, events: [event("high", 0)] });
    expect(result.state).toBe("BLOCK");
  });

  it("watches medium impact by default", () => {
    const result = evaluateForexCalendar({ now: 100000 - 10 * 60, events: [event("medium", 0)] });
    expect(result.state).toBe("WATCH");
  });

  it("can block medium impact when configured", () => {
    const result = evaluateForexCalendar({ now: 100000 - 10 * 60, events: [event("medium", 0)], config: { blockMediumImpact: true } });
    expect(result.state).toBe("BLOCK");
    expect(result.reasonCode).toBe("NEWS_BLOCK_MEDIUM_IMPACT");
  });

  it("is clear with only low impact events outside the window", () => {
    const result = evaluateForexCalendar({ now: 100000, events: [event("low", 2 * 60 * 60)] });
    expect(result.state).toBe("CLEAR");
  });
});
