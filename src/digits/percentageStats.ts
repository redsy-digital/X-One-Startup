import type { TickData } from "../types";
import { extractLastDigitFromTick } from "./digit";

export const DIGIT_PERCENTAGE_WINDOW = 100;
export const MIN_DIGIT_PERCENTAGE_WINDOW = 20;
export const MAX_DIGIT_PERCENTAGE_WINDOW = 1000;

export interface DigitPercentageStat {
  digit: number;
  count: number;
  percent: number;
  streakWithoutAppearing: number;
}

/**
 * Calculates the observed last-digit distribution over a fixed sliding window.
 * The window contains only the newest `windowSize` valid digits, so adding a
 * live tick automatically pushes the oldest observation out of the sample.
 */
export function calculateDigitPercentageStats(
  ticks: TickData[],
  windowSize = DIGIT_PERCENTAGE_WINDOW,
): { stats: DigitPercentageStat[]; sampleSize: number; latestDigit: number | null } {
  const size = Math.max(1, Math.round(windowSize));
  const recentTicks = ticks.slice(-size);
  const counts = Array.from({ length: 10 }, () => 0);
  let latestDigit: number | null = null;

  for (const tick of recentTicks) {
    const digit = extractLastDigitFromTick(tick);
    if (digit == null) continue;
    counts[digit] += 1;
    latestDigit = digit;
  }

  const sampleSize = counts.reduce((sum, count) => sum + count, 0);
  const stats = counts.map((count, digit) => {
    let streakWithoutAppearing = 0;
    for (let i = recentTicks.length - 1; i >= 0; i -= 1) {
      const current = extractLastDigitFromTick(recentTicks[i]);
      if (current == null) continue;
      if (current === digit) break;
      streakWithoutAppearing += 1;
    }
    return {
      digit,
      count,
      percent: sampleSize > 0 ? (count / sampleSize) * 100 : 0,
      streakWithoutAppearing,
    };
  });

  return { stats, sampleSize, latestDigit };
}
