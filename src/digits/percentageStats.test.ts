import { describe, expect, it } from "vitest";
import { calculateDigitPercentageStats } from "./percentageStats";
import type { TickData } from "../types";

const tick = (time: number, price: number): TickData => ({ time, price });

function statFor(stats: ReturnType<typeof calculateDigitPercentageStats>["stats"], digit: number) {
  return stats.find((item) => item.digit === digit)!;
}

describe("digit percentage sliding window", () => {
  it("uses only the newest N ticks", () => {
    const ticks = [
      tick(1, 1.01), // 1 - leaves the window
      tick(2, 2.02), // 2 - leaves the window
      tick(3, 3.03), // 3
      tick(4, 3.03), // 3
      tick(5, 4.04), // 4
    ];

    const result = calculateDigitPercentageStats(ticks, 3);

    expect(result.sampleSize).toBe(3);
    expect(statFor(result.stats, 3).count).toBe(2);
    expect(statFor(result.stats, 3).percent).toBeCloseTo(66.6667, 3);
    expect(statFor(result.stats, 4).count).toBe(1);
    expect(statFor(result.stats, 4).percent).toBeCloseTo(33.3333, 3);
    expect(statFor(result.stats, 1).count).toBe(0);
    expect(statFor(result.stats, 2).count).toBe(0);
    expect(result.latestDigit).toBe(4);
  });

  it("keeps the denominator equal to the valid observations in a partially filled window", () => {
    const ticks = [tick(1, 1.01), tick(2, 2.02)];
    const result = calculateDigitPercentageStats(ticks, 1000);

    expect(result.sampleSize).toBe(2);
    expect(statFor(result.stats, 1).percent).toBe(50);
    expect(statFor(result.stats, 2).percent).toBe(50);
  });

  it("always returns all ten digits", () => {
    const result = calculateDigitPercentageStats([], 1000);
    expect(result.stats).toHaveLength(10);
    expect(result.stats.every((item) => item.count === 0 && item.percent === 0)).toBe(true);
    expect(result.latestDigit).toBeNull();
  });
});
