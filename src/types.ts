export type StrategyProfile = "conservative" | "balanced" | "aggressive";

export interface StrategyProfileConfig {
  // Confidence thresholds
  minConfidenceOverride: number;
  // Market condition
  requireTrending: boolean;
  // Score requirements
  dominanceMultiplier: number;   // How much stronger the winning side must be
  minWinScore: number;           // Minimum absolute score to trade
  // Penalty weights
  freshnessWeight: number;       // Multiplier on freshness penalty
  timingWeight: number;          // Multiplier on timing penalty
  emaDistWeight: number;         // Multiplier on EMA distance penalty
  // RSI extremes (tighter = more conservative)
  rsiOverbought: number;
  rsiOversold: number;
  // Exhaustion tolerance
  maxConsecutiveCandles: number;
  maxExhaustionScore: number;
}

export interface TickData {
  time: number;
  price: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface StrategyIndicators {
  emaFast: number;
  emaSlow: number;
  rsi: number;
  adx: number;
  atr: number;
  macd?: { macd: number; signal: number; histogram: number };
  bollinger?: { middle: number; upper: number; lower: number };
  score: number;
  confidence: number;
  marketCondition: "TRENDING" | "CHOPPY" | "UNKNOWN";
  // Extra logging
  callScore?: number;
  putScore?: number;
  scoreDiff?: number;
  candleStrength?: number;
  lastCandlesDirection?: string[];
  lossStreak?: number;
  reason?: string;
  // Structural fields
  exhaustionLevel?: number; // 0 to 10
  emaDistance?: number;
  consecutiveCandles?: number;
  isExhausted?: boolean;
  structureId?: string;
  reentryBlocked?: boolean;
  blockedReason?: string;
  // Refinement fields
  exhaustionScore?: number;
  emaDistanceNormalized?: number;
  trendFreshness?: number;
  saturationLevel?: number;
  structureResetReason?: string;
  confidencePenaltyReasons?: string[];
  // New Engine Fields
  trendFreshnessScore?: number;
  entryTimingScore?: number;
  exhaustionPenalty?: number;
  emaStretchLevel?: number;
  entryDelayRisk?: number;
  saturationDetected?: boolean;
  timingQuality?: number;
  lateEntryDetected?: boolean;
  // Auditor Logs
  volatilityProfile?: string;
  adaptiveThresholds?: { adx: number; alternations: number; emaSlope: number };
  confidenceBeforePenalty?: number;
  totalPenaltyApplied?: number;
}

export interface TradeHistory {
  id: string;
  time: number;
  symbol: string;
  type: "CALL" | "PUT";
  stake: number;
  status: "WON" | "LOST" | "PENDING";
  profit?: number;
  entryPrice?: number;
  exitPrice?: number;
  confidence?: number;
  score?: number;
  indicators?: StrategyIndicators;
}

export interface TradeSignal {
  type: "CALL" | "PUT" | "NEUTRAL";
  confidence: number;
  indicators: StrategyIndicators;
}

export interface BotSettings {
  stake: number;
  targetProfit: number;
  stopLoss: number;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  useSoros: boolean;
  sorosLevels: number;
  candleTimeframe: number; // in seconds
  minConfidence: number;
  cooldownSeconds: number;
}
