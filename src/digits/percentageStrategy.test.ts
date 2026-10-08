import { describe, expect, it } from "vitest";
import { findAbsenceSignal, findSaturationSignal } from "./percentageStrategy";
import type { DigitPercentageStat } from "./percentageStats";

const stat = (digit: number, percent: number, streakWithoutAppearing = 0): DigitPercentageStat => ({
  digit, count: Math.round(percent), percent, streakWithoutAppearing,
});

describe("percentage strategy gates", () => {
  it("selects the most saturated digit above threshold", () => {
    const signal = findSaturationSignal([stat(2, 17), stat(7, 18), stat(4, 21)], 18);
    expect(signal).toEqual({ contract: "DIGITDIFF", targetDigit: 4, reason: "saturação 21.0% ≥ 18.0%" });
  });

  it("does not signal saturation at or below theoretical baseline", () => {
    expect(findSaturationSignal([stat(2, 10), stat(7, 10)], 18)).toBeNull();
  });

  it("selects the longest absence streak", () => {
    const signal = findAbsenceSignal([stat(2, 31, 31), stat(7, 35, 28), stat(4, 12, 40)], 30);
    expect(signal).toEqual({ contract: "DIGITMATCH", targetDigit: 4, reason: "ausência 40 ticks ≥ 30" });
  });
});
