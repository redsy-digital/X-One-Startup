import { describe, expect, it } from "vitest";
import { evaluateForexCalendar } from "./engine";
import { extractEvents } from "./deriv";
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

describe("Deriv economic calendar adapter", () => {
  it("parses the exact native response shape captured in the API Lab", () => {
    const response = {
      economic_calendar: {
        events: [{
          currency: "USD",
          event_name: "U. of Mich. Sentiment",
          impact: 5,
          release_date: 1787925600,
          actual: { display_value: "" },
          forecast: { display_value: "51.0" },
          previous: { display_value: "51.000000" },
        }],
      },
      msg_type: "economic_calendar",
      req_id: 1002,
    };

    const [result] = extractEvents(response, "USD");
    expect(result).toMatchObject({
      currency: "USD",
      name: "U. of Mich. Sentiment",
      impact: "critical",
      eventTime: 1787925600,
      forecast: "51.0",
      previous: "51.000000",
    });
  });
});
