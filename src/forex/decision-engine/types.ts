import type { Candle, StrategyProfile } from "../../types";
import type { ForexStructureSnapshot } from "../structure";

/** Version of the frozen Forex Decision Engine contract. */
export const FOREX_DECISION_ENGINE_VERSION = "forex-v1.0.0" as const;

export type ForexDecisionState =
  | "SCANNING"
  | "WAIT_DATA"
  | "WAIT_MARKET"
  | "WAIT_REGIME"
  | "WAIT_SIGNAL"
  | "NEWS_BLOCK"
  | "WAIT_CONTRACT"
  | "RISK_BLOCK"
  | "PROPOSAL_CHECK"
  | "READY"
  | "EXECUTING"
  | "COOLDOWN";

export type ForexDirection = "CALL" | "PUT" | "NONE";
export type ForexRegime = "TRENDING" | "RANGING" | "CONSOLIDATING" | "BREAKOUT" | "TRANSITION" | "UNKNOWN";

/** Machine-readable reasons. Keep stable: they are persisted in logs/history. */
export type ForexReasonCode =
  | "ENGINE_NOT_READY"
  | "UNAUTHORIZED"
  | "MARKET_CLOSED"
  | "MARKET_DATA_STALE"
  | "INSUFFICIENT_DATA"
  | "DATA_GAP"
  | "FEATURE_INVALID"
  | "REGIME_UNKNOWN"
  | "REGIME_NOT_SUPPORTED"
  | "SIGNAL_NONE"
  | "SIGNAL_BELOW_THRESHOLD"
  | "NEWS_BLOCK_HIGH_IMPACT"
  | "NEWS_BLOCK_MEDIUM_IMPACT"
  | "NEWS_COOLDOWN"
  | "NEWS_WATCH_REQUIRES_CONFIRMATION"
  | "NO_VALID_CONTRACT"
  | "PROPOSAL_REJECTED"
  | "RISK_LIMIT"
  | "COOLDOWN_ACTIVE"
  | "READY_FOR_EXECUTION";

export interface ForexMarketContext {
  market: "forex";
  symbol: string;
  timeframeMinutes: number;
  candles: Candle[];
  serverTime?: number;
  marketOpen: boolean;
  dataAsOf?: number;
}

export interface ForexFeatureSnapshot {
  featureId: string;
  values: Record<string, number>;
  calculatedAt: number;
  sourceTimeframeMinutes: number;
  version: string;
}

export interface ForexRegimeResult {
  regime: ForexRegime;
  confidence: number;
  featureSnapshot?: ForexFeatureSnapshot;
  reasonCode?: ForexReasonCode;
}

export interface ForexSignalResult {
  direction: ForexDirection;
  score: number;
  confidence: number;
  featureSnapshot?: ForexFeatureSnapshot;
  reasonCode: ForexReasonCode;
}

export type ForexNewsImpact = "low" | "medium" | "high" | "critical";

export interface ForexEconomicEvent {
  eventId: string;
  currency: string;
  name: string;
  impact: ForexNewsImpact;
  eventTime: number;
  actual?: number | string | null;
  forecast?: number | string | null;
  previous?: number | string | null;
}

export type ForexCalendarState = "CLEAR" | "WATCH" | "BLOCK" | "COOLDOWN" | "UNKNOWN";

export interface ForexCalendarDecision {
  state: ForexCalendarState;
  reasonCode?: ForexReasonCode;
  relevantEvents: ForexEconomicEvent[];
  blockedUntil?: number;
  checkedAt: number;
}

export interface ForexContractCandidate {
  contractType: "CALL" | "PUT";
  duration: number;
  durationUnit: "m" | "h";
  askPrice?: number;
  payout?: number;
  proposalId?: string;
}

export interface ForexContractSelection {
  candidate: ForexContractCandidate | null;
  reasonCode?: ForexReasonCode;
}

export interface ForexRiskDecision {
  allowed: boolean;
  stake: number;
  reasonCode?: ForexReasonCode;
  reason?: string;
  riskFraction?: number;
  checkedAt?: number;
}

export interface ForexDecisionContext {
  market: ForexMarketContext;
  profile: StrategyProfile;
  features?: ForexFeatureSnapshot;
  structure?: ForexStructureSnapshot;
  regime?: ForexRegimeResult;
  signal?: ForexSignalResult;
  calendar?: ForexCalendarDecision;
  contract?: ForexContractSelection;
  risk?: ForexRiskDecision;
}

export interface ForexDecisionResult {
  state: ForexDecisionState;
  direction: ForexDirection;
  score: number;
  confidence: number;
  reasonCode: ForexReasonCode;
  reason: string;
  decisionId: string;
  engineVersion: typeof FOREX_DECISION_ENGINE_VERSION;
  timestamp: number;
  context: ForexDecisionContext;
}
