export const FOREX_PROPOSAL_ENGINE_VERSION = "forex-proposal-v1.0.0" as const;

export const VALIDATED_FOREX_DURATIONS_MINUTES = [15, 30, 60, 120] as const;
export type ValidatedForexDurationMinutes = typeof VALIDATED_FOREX_DURATIONS_MINUTES[number];

export interface ForexProposalRequest {
  symbol: string;
  direction: "CALL" | "PUT";
  stake: number;
  durationMinutes: ValidatedForexDurationMinutes;
  currency: string;
}

export interface ForexProposalSnapshot {
  id: string;
  askPrice?: number;
  payout?: number;
  spot?: number;
  displayPayout?: number;
  requested: ForexProposalRequest;
  receivedAt: number;
  expiresAt?: number;
}

export type ForexProposalValidationCode =
  | "PROPOSAL_VALID"
  | "PROPOSAL_REJECTED"
  | "INVALID_SYMBOL"
  | "INVALID_DIRECTION"
  | "INVALID_STAKE"
  | "INVALID_DURATION"
  | "PROPOSAL_MISSING_ID"
  | "PROPOSAL_MISSING_PRICE";

export interface ForexProposalResult {
  valid: boolean;
  code: ForexProposalValidationCode;
  reason: string;
  proposal?: ForexProposalSnapshot;
  raw?: unknown;
}
