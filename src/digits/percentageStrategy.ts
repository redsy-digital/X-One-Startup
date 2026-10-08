import type { DigitPercentageStat } from "./percentageStats";

export interface PercentageStrategySignal {
  contract: "DIGITDIFF" | "DIGITMATCH";
  targetDigit: number;
  reason: string;
}

/**
 * Strict threshold gates over the observed sliding-window distribution.
 * These are statistical heuristics, not claims that the next tick must
 * compensate or revert to 10%.
 */
export function findSaturationSignal(stats: DigitPercentageStat[], thresholdPercent: number): PercentageStrategySignal | null {
  const threshold = Math.max(10.01, Math.min(100, thresholdPercent));
  const candidate = [...stats]
    .filter((item) => item.percent >= threshold)
    .sort((a, b) => b.percent - a.percent || b.count - a.count)[0];
  if (!candidate) return null;
  return {
    contract: "DIGITDIFF",
    targetDigit: candidate.digit,
    reason: `saturação ${candidate.percent.toFixed(1)}% ≥ ${threshold.toFixed(1)}%`,
  };
}

export function findAbsenceSignal(stats: DigitPercentageStat[], streakThreshold: number): PercentageStrategySignal | null {
  const threshold = Math.max(1, Math.min(10000, Math.round(streakThreshold)));
  const candidate = [...stats]
    .filter((item) => item.streakWithoutAppearing >= threshold)
    .sort((a, b) => b.streakWithoutAppearing - a.streakWithoutAppearing || a.percent - b.percent)[0];
  if (!candidate) return null;
  return {
    contract: "DIGITMATCH",
    targetDigit: candidate.digit,
    reason: `ausência ${candidate.streakWithoutAppearing} ticks ≥ ${threshold}`,
  };
}
