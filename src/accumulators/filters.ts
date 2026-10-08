export type AccumulatorFilterKey =
  | "tickRange"
  | "microTrend"
  | "consecutiveTicks"
  | "bollinger"
  | "simpleVolatility";

export interface AccumulatorFiltersConfig {
  tickRange: boolean;
  microTrend: boolean;
  consecutiveTicks: boolean;
  bollinger: boolean;
  simpleVolatility: boolean;
}

export const DEFAULT_ACCUMULATOR_FILTERS: AccumulatorFiltersConfig = {
  tickRange: false,
  microTrend: false,
  consecutiveTicks: false,
  bollinger: false,
  simpleVolatility: false,
};

export type AccumulatorMarketRegime = "stable" | "transition" | "explosion" | "strong_trend";

export interface AccumulatorFilterEvaluation {
  allowed: boolean;
  entryScore: number;
  marketRegime: AccumulatorMarketRegime;
  recoveryConfirmed: boolean;
  volatilityAcceleration: number | null;
  reasons: string[];
  samples: number;
  rangeRatio: number | null;
  stdRatio: number | null;
  microTrendDistance: number | null;
  consecutiveDirection: "up" | "down" | "flat" | null;
  consecutiveCount: number;
  bollingerZ: number | null;
  volatilityRatio: number | null;
}

const MIN_SAMPLES = 40;
const SCORE_THRESHOLD = 75;
const RANGE_WINDOW = 12;
const SMA_FAST = 5;
const SMA_SLOW = 20;
const BOLLINGER_WINDOW = 20;
const CONSECUTIVE_LIMIT = 4;
const MICRO_TREND_DISTANCE_LIMIT = 0.35;
const MICRO_TREND_SLOPE_LIMIT = 0.35;
const BOLLINGER_CENTER_LIMIT = 0.65;
const SIMPLE_VOLATILITY_RATIO_LIMIT = 1.25;

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]) {
  if (values.length < 2) return null;
  const avg = mean(values)!;
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return variance === null ? null : Math.sqrt(variance);
}

function range(values: number[]) {
  if (!values.length) return null;
  return Math.max(...values) - Math.min(...values);
}

function normalizedRange(values: number[]) {
  const r = range(values);
  const anchor = Math.abs(values[values.length - 1] ?? 0);
  if (r === null || anchor <= 0) return null;
  return r / anchor;
}

function slope(values: number[]) {
  if (values.length < 2) return null;
  const xMean = (values.length - 1) / 2;
  const yMean = mean(values)!;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    const dx = index - xMean;
    numerator += dx * (value - yMean);
    denominator += dx * dx;
  });
  return denominator === 0 ? 0 : numerator / denominator;
}

function direction(a: number, b: number): "up" | "down" | "flat" {
  if (b > a) return "up";
  if (b < a) return "down";
  return "flat";
}

function consecutiveRun(prices: number[]) {
  if (prices.length < 2) return { direction: null as "up" | "down" | "flat" | null, count: 0 };
  let dir: "up" | "down" | "flat" = direction(prices[prices.length - 2], prices[prices.length - 1]);
  if (dir === "flat") return { direction: dir, count: 0 };
  let count = 1;
  for (let i = prices.length - 1; i > 0; i--) {
    const current = direction(prices[i - 1], prices[i]);
    if (current !== dir) break;
    count++;
  }
  return { direction: dir, count };
}

export function evaluateAccumulatorEntry(prices: number[], config: AccumulatorFiltersConfig): AccumulatorFilterEvaluation {
  const active = Object.values(config).some(Boolean);
  const reasons: string[] = [];
  const samples = prices.length;
  const last = prices[prices.length - 1];
  const result: AccumulatorFilterEvaluation = {
    allowed: true, entryScore: 100, marketRegime: "stable", recoveryConfirmed: true,
    volatilityAcceleration: null, reasons, samples, rangeRatio: null, stdRatio: null,
    microTrendDistance: null, consecutiveDirection: null, consecutiveCount: 0,
    bollingerZ: null, volatilityRatio: null,
  };
  if (!active) return result;
  if (samples < MIN_SAMPLES || !Number.isFinite(last)) {
    result.allowed = false; result.entryScore = 0; result.recoveryConfirmed = false;
    result.reasons.push(`Aguardando histórico (${samples}/${MIN_SAMPLES} ticks)`); return result;
  }

  const current = prices.slice(-RANGE_WINDOW);
  const prev = prices.slice(-RANGE_WINDOW * 2, -RANGE_WINDOW);
  const currentRange = normalizedRange(current);
  const prevRange = normalizedRange(prev);
  const baselineRanges: number[] = [];
  for (let i = 2; i <= 8; i++) {
    const w = prices.slice(-RANGE_WINDOW * i, -RANGE_WINDOW * (i - 1));
    const r = normalizedRange(w); if (r !== null) baselineRanges.push(r);
  }
  const baseline = mean(baselineRanges);
  const acceleration = currentRange !== null && prevRange !== null ? currentRange / Math.max(prevRange, 1e-12) : null;
  result.volatilityAcceleration = acceleration;
  const baselineRatio = currentRange !== null && baseline !== null ? currentRange / Math.max(baseline, 1e-12) : null;

  // Regime detection is intentionally conservative: an abrupt volatility jump or
  // a sustained directional move puts the market into a defensive regime.
  const fast = prices.slice(-SMA_FAST);
  const slow = prices.slice(-SMA_SLOW);
  const fastAvg = mean(fast)!;
  const slowAvg = mean(slow)!;
  const localRange = normalizedRange(slow) ?? 0;
  const distance = Math.abs(fastAvg - slowAvg) / Math.max(Math.abs(last) * Math.max(localRange, 1e-8), 1e-12);
  const fastSlope = Math.abs(slope(fast) ?? 0) / Math.max(Math.abs(last) * Math.max(localRange, 1e-8), 1e-12);
  const strongTrend = distance > MICRO_TREND_DISTANCE_LIMIT || fastSlope > MICRO_TREND_SLOPE_LIMIT;
  const explosion = (acceleration !== null && acceleration >= 1.45) || (baselineRatio !== null && baselineRatio >= 1.55);
  const transition = (acceleration !== null && acceleration >= 1.20) || (baselineRatio !== null && baselineRatio >= 1.25);
  result.marketRegime = explosion ? "explosion" : strongTrend ? "strong_trend" : transition ? "transition" : "stable";

  // The evaluator describes the current tick state. The engine separately
  // requires three consecutive live stable ticks before allowing a reopen.
  result.recoveryConfirmed = result.marketRegime === "stable"
    && (acceleration === null || acceleration < 1.12)
    && (baselineRatio === null || baselineRatio < 1.20);

  let points = 100;
  if (result.marketRegime === "transition") points -= 20;
  if (result.marketRegime === "explosion") points -= 55;
  if (result.marketRegime === "strong_trend") points -= 35;
  if (!result.recoveryConfirmed) points -= 15;

  if (config.tickRange) {
    const historicalRanges: number[] = [], historicalStd: number[] = [];
    for (let end = samples - RANGE_WINDOW; end >= RANGE_WINDOW * 6; end -= RANGE_WINDOW) {
      const window = prices.slice(end, end + RANGE_WINDOW);
      const r = normalizedRange(window); const sd = stddev(window); const anchor = Math.abs(window[window.length - 1] ?? 0);
      if (r !== null) historicalRanges.push(r);
      if (sd !== null && anchor > 0) historicalStd.push(sd / anchor);
    }
    const currentRatio = normalizedRange(current); const currentStd = stddev(current);
    const currentStdNorm = currentStd !== null && Math.abs(last) > 0 ? currentStd / Math.abs(last) : null;
    const rb = mean(historicalRanges), sb = mean(historicalStd);
    if (currentRatio !== null && rb !== null) result.rangeRatio = currentRatio / Math.max(rb, 1e-12);
    if (currentStdNorm !== null && sb !== null) result.stdRatio = currentStdNorm / Math.max(sb, 1e-12);
    if (result.rangeRatio === null || result.stdRatio === null || result.rangeRatio > 1.20 || result.stdRatio > 1.20) {
      points -= 15; reasons.push("Desvio/amplitude acima da faixa normal");
    }
  }

  if (config.microTrend) {
    result.microTrendDistance = distance;
    if (strongTrend) { points -= 20; reasons.push("Micro-tendência forte detectada"); }
  }

  if (config.consecutiveTicks) {
    const run = consecutiveRun(prices); result.consecutiveDirection = run.direction; result.consecutiveCount = run.count;
    if (run.count >= CONSECUTIVE_LIMIT) { points -= 15; reasons.push(`${run.count} ticks consecutivos em ${run.direction === "up" ? "alta" : "baixa"}`); }
  }

  if (config.bollinger) {
    const window = prices.slice(-BOLLINGER_WINDOW), avg = mean(window)!, sd = stddev(window);
    if (sd !== null && sd > 0) { const z = (last - avg) / sd; result.bollingerZ = z; if (Math.abs(z) > BOLLINGER_CENTER_LIMIT) { points -= 15; reasons.push("Preço afastado da linha central de Bollinger"); } }
  }

  if (config.simpleVolatility) {
    result.volatilityRatio = baselineRatio;
    if (baselineRatio === null || baselineRatio > 1.25) { points -= 20; reasons.push("Volatilidade dinâmica elevada"); }
  }

  if (acceleration !== null && acceleration >= 1.20) reasons.push("Aceleração de volatilidade detectada");
  if (!result.recoveryConfirmed) reasons.push("Recuperação ainda não confirmada");

  result.entryScore = Math.max(0, Math.min(100, Math.round(points)));
  result.allowed = result.entryScore >= SCORE_THRESHOLD && result.marketRegime === "stable" && result.recoveryConfirmed;
  if (!result.allowed && reasons.length === 0) reasons.push(`Score insuficiente (${result.entryScore}/100)`);
  return result;
}

export interface AccumulatorTickHistoryStats {
  symbol: string;
  growthRate: number;
  samples: number;
  analyzedTicks: number;
  maxSafeRun: number;
  averageSafeRun: number;
  medianSafeRun: number;
  shortestSafeRun: number;
  knockoutCount: number;
  knockoutRate: number;
  longestUpRun: number;
  longestDownRun: number;
  largestAbsoluteTickMovePercent: number;
  calculatedAt: number;
}

/**
 * Replays historical ticks using Deriv's accumulator rule: each new tick is
 * evaluated against the previous tick with a +/- growthRate range. A breach
 * ends the simulated accumulator run. This is a historical diagnostic, not a
 * prediction or guarantee of future contract behaviour.
 */
export function calculateAccumulatorTickStats(symbol: string, growthRate: number, prices: number[]): AccumulatorTickHistoryStats {
  const safeRuns: number[] = [];
  let safeRun = 0;
  let knockouts = 0;
  let longestUp = 0;
  let longestDown = 0;
  let up = 0;
  let down = 0;
  let largestMove = 0;

  for (let i = 1; i < prices.length; i++) {
    const previous = prices[i - 1];
    const current = prices[i];
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) continue;
    const movePct = Math.abs((current - previous) / previous) * 100;
    largestMove = Math.max(largestMove, movePct);

    if (current > previous) { up++; down = 0; } else if (current < previous) { down++; up = 0; } else { up = 0; down = 0; }
    longestUp = Math.max(longestUp, up);
    longestDown = Math.max(longestDown, down);

    const upper = previous * (1 + growthRate);
    const lower = previous * (1 - growthRate);
    const safe = current < upper && current > lower;
    if (safe) {
      safeRun++;
    } else {
      safeRuns.push(safeRun);
      safeRun = 0;
      knockouts++;
    }
  }
  if (safeRun > 0) safeRuns.push(safeRun);

  const sorted = [...safeRuns].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const average = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
  const shortest = sorted.length ? sorted[0] : 0;
  const analyzedTicks = Math.max(0, prices.length - 1);

  return {
    symbol,
    growthRate,
    samples: prices.length,
    analyzedTicks,
    maxSafeRun: sorted.length ? sorted[sorted.length - 1] : 0,
    averageSafeRun: average,
    medianSafeRun: median,
    shortestSafeRun: shortest,
    knockoutCount: knockouts,
    knockoutRate: analyzedTicks > 0 ? knockouts / analyzedTicks : 0,
    longestUpRun: longestUp,
    longestDownRun: longestDown,
    largestAbsoluteTickMovePercent: largestMove,
    calculatedAt: Date.now(),
  };
}
