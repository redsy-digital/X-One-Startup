import type {
  ForexCalendarDecision,
  ForexDecisionResult,
} from "../decision-engine/types";
import type { ForexProposalSnapshot } from "../proposal";

/** D16 safety limits. These are execution-safety bounds, not predictive assumptions. */
export interface ForexExecutionGuardConfig {
  /** Maximum age of the D13 decision accepted for execution, in seconds. */
  maxDecisionAgeSeconds: number;
  /** Maximum age of the D15 proposal accepted for execution, in seconds. */
  maxProposalAgeSeconds: number;
  /** Require a fresh calendar evaluation not older than this many seconds. */
  maxCalendarAgeSeconds: number;
}

export const DEFAULT_FOREX_EXECUTION_GUARD_CONFIG: ForexExecutionGuardConfig = {
  maxDecisionAgeSeconds: 180,
  maxProposalAgeSeconds: 15,
  maxCalendarAgeSeconds: 120,
};

export interface ForexExecutionState {
  botRunning: boolean;
  connectionOpen: boolean;
  openPositions: number;
  /** Prevents two execution paths from authorizing the same decision concurrently. */
  decisionInFlight?: boolean;
}

export interface ForexExecutionGuardInput {
  now: number;
  decision: ForexDecisionResult;
  proposal: ForexProposalSnapshot;
  calendar: ForexCalendarDecision;
  riskAllowed: boolean;
  state: ForexExecutionState;
}

export type ForexExecutionGuardCode =
  | "EXECUTION_AUTHORIZED"
  | "EXECUTION_BLOCKED"
  | "BOT_STOPPED"
  | "CONNECTION_NOT_READY"
  | "DECISION_NOT_READY"
  | "DECISION_STALE"
  | "PROPOSAL_STALE"
  | "PROPOSAL_MISSING_PRICE"
  | "PROPOSAL_MISMATCH"
  | "MARKET_CLOSED"
  | "CALENDAR_NOT_READY"
  | "CALENDAR_STALE"
  | "CALENDAR_BLOCK"
  | "CALENDAR_WATCH"
  | "RISK_BLOCK"
  | "POSITION_LIMIT"
  | "DUPLICATE_EXECUTION";

export interface ForexExecutionAuthorization {
  authorized: boolean;
  code: ForexExecutionGuardCode;
  reason: string;
  checkedAt: number;
  decisionId: string;
  proposalId?: string;
}
