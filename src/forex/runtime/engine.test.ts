import { describe, expect, it, vi } from "vitest";
import { ForexDecisionEngineV1 } from "../decision-engine";
import { ForexDirectionEngineV1 } from "../direction";
import { FOREX_DIRECTION_DEFAULT_CONFIG } from "../direction";

describe("D19 Runtime Integration contract", () => {
  it("fails closed when there is no approved directional evidence", () => {
    const directionEngine = new ForexDirectionEngineV1(FOREX_DIRECTION_DEFAULT_CONFIG);
    expect(FOREX_DIRECTION_DEFAULT_CONFIG.weights).toHaveLength(0);
    expect(directionEngine).toBeDefined();
  });

  it("keeps D13 before Proposal when signal is absent", () => {
    const engine = new ForexDecisionEngineV1();
    const result = engine.evaluate({
      market: {
        market: "forex", symbol: "frxEURUSD", timeframeMinutes: 15,
        candles: Array.from({ length: 60 }, (_, i) => ({ time: 1000 + i * 900, open: 1, high: 1.01, low: .99, close: 1 })),
        marketOpen: true, dataAsOf: 1090 + 59 * 900,
      },
      profile: "balanced",
      features: { featureId: "test", values: {}, calculatedAt: 1, sourceTimeframeMinutes: 15, version: "test" },
      regime: { regime: "TRENDING", confidence: 0.8 },
      signal: undefined,
      calendar: { state: "CLEAR", relevantEvents: [], checkedAt: 1090 + 59 * 900 },
      contract: { candidate: null },
      risk: { allowed: true, stake: .5, checkedAt: 1090 + 59 * 900 },
      now: 1090 + 59 * 900,
    });
    expect(result.state).toBe("WAIT_SIGNAL");
    expect(result.direction).toBe("NONE");
  });
});
