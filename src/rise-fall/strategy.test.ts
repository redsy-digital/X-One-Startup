import { describe, expect, it } from "vitest";
import { findAlternatingSignal, findBlockDensitySignal, findSequenceSignal, findPercentChannelSignal, findSustainableInertiaSignal } from "./strategy";

describe("Rise/Fall mathematical strategies", () => {
  it("reverses a directional sequence", () => {
    expect(findSequenceSignal(["UP", "UP", "UP", "UP"], 4)?.contract).toBe("PUT");
    expect(findSequenceSignal(["DOWN", "DOWN", "DOWN", "DOWN"], 4)?.contract).toBe("CALL");
  });
  it("selects the minority direction after density", () => {
    expect(findBlockDensitySignal(["DOWN","DOWN","DOWN","DOWN","DOWN","DOWN","DOWN","DOWN","UP","UP"], 10, 80)?.contract).toBe("CALL");
  });
  it("breaks strict alternation by repeating the last direction", () => {
    expect(findAlternatingSignal(["UP","DOWN","UP","DOWN"], 4)?.contract).toBe("PUT");
  });
});

describe("Percent channel", () => {
  it("respects the configured channel sequence length", () => {
    const signal = findPercentChannelSignal({ prices: [1, 2, 3, 4, 5, 6], directions: ["UP", "UP", "UP"], thresholdPercent: 70, sequenceLength: 4, momentumFilter: false });
    expect(signal).toBeNull();
  });
});

describe("Sustainable directional inertia", () => {
  it("signals CALL when price breaks observation high with 4/5 upward directions", () => {
    const prices = [1,2,3,4,5,6,7,8,9,10, 9,10,11,12,13];
    const directions = ["UP","UP","DOWN","UP","UP"] as const;
    expect(findSustainableInertiaSignal(prices, [...directions])?.contract).toBe("CALL");
  });
  it("signals PUT when price breaks observation low with 4/5 downward directions", () => {
    const prices = [10,9,8,7,6,5,4,3,2,1, 2,1,0,-1,-2];
    const directions = ["DOWN","DOWN","UP","DOWN","DOWN"] as const;
    expect(findSustainableInertiaSignal(prices, [...directions])?.contract).toBe("PUT");
  });
  it("does not signal without a breakout or 4/5 directional confirmation", () => {
    expect(findSustainableInertiaSignal([1,2,3,4,5,6,7,8,9,10, 8,9,10,9,9], ["UP","UP","DOWN","UP","DOWN"])).toBeNull();
  });
});
