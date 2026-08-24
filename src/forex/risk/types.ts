import type { ForexCalendarDecision, ForexReasonCode } from "../decision-engine/types";

/**
 * Forex V1 risk configuration.
 *
 * These are safety controls for Rise/Fall options. They are deliberately
 * independent from the synthetic-index Martingale/Soros settings.
 */
export interface ForexRiskConfig {
  /** Maximum amount at risk on one Rise/Fall contract. */
  maxStakePerTrade: number;
  /** Maximum number of simultaneously open Forex contracts. V1 is one engine. */
  maxOpenPositions: number;
  /** Maximum number of entries allowed during one bot session. */
  maxTradesPerSession: number;
  /** Maximum session loss in account currency. */
  maxSessionLoss: number;
  /** Maximum daily loss in account currency. */
  maxDailyLoss: number;
  /** Maximum consecutive losses before a temporary block. */
  maxConsecutiveLosses: number;
  /** Cooldown after a losing contract. */
  cooldownAfterLossSeconds: number;
  /** Minimum delay between two entries. */
  minEntryIntervalSeconds: number;
  /** Safety ceiling for a manually configured stake. */
  maxAccountRiskFraction: number;
}

export const DEFAULT_FOREX_RISK_CONFIG: ForexRiskConfig = {
  maxStakePerTrade: 0.50,
  maxOpenPositions: 1,
  maxTradesPerSession: 20,
  maxSessionLoss: 5,
  maxDailyLoss: 10,
  maxConsecutiveLosses: 3,
  cooldownAfterLossSeconds: 60,
  minEntryIntervalSeconds: 60,
  maxAccountRiskFraction: 0.02,
};

export interface ForexRiskState {
  sessionPnl: number;
  dailyPnl: number;
  consecutiveLosses: number;
  tradesThisSession: number;
  openPositions: number;
  lastEntryAt?: number;
  cooldownUntil?: number;
}

export interface ForexRiskEvaluationInput {
  now: number;
  stake: number;
  accountBalance: number;
  symbol: string;
  direction: "CALL" | "PUT";
  calendar: ForexCalendarDecision;
  state: ForexRiskState;
}

