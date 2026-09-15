import { describe, expect, it } from "vitest";
import { calculateAccumulatorTickStats, evaluateAccumulatorEntry, type AccumulatorFiltersConfig } from "./filters";

const off: AccumulatorFiltersConfig = {
  tickRange: false,
  microTrend: false,
  consecutiveTicks: false,
  bollinger: false,
  simpleVolatility: false,
};

describe("Accumulator entry filters", () => {
  it("allows the original mechanical cycle when all filters are disabled", () => {
    const result = evaluateAccumulatorEntry([100, 101, 99, 100, 101], off);
    expect(result.allowed).toBe(true);
  });

  it("blocks a long directional run with the consecutive-ticks filter", () => {
    const result = evaluateAccumulatorEntry(
      Array.from({ length: 25 }, (_, i) => 100 + i),
      { ...off, consecutiveTicks: true },
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons.some((reason) => reason.includes("consecutivos"))).toBe(true);
  });

  it("uses growth rate when calculating historical safe runs", () => {
    const prices = [100, 100.5, 100.8, 100.9, 102, 102.2, 100.1];
    const conservative = calculateAccumulatorTickStats("TEST", 0.01, prices);
    const wider = calculateAccumulatorTickStats("TEST", 0.05, prices);
    expect(wider.maxSafeRun).toBeGreaterThanOrEqual(conservative.maxSafeRun);
    expect(conservative.growthRate).toBe(0.01);
  });
});
