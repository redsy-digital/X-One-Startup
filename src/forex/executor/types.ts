export const FOREX_TRADE_EXECUTOR_VERSION = "forex-trade-executor-v1.0.0" as const;

import type { ForexExecutionAuthorization } from "../execution-guard";
import type { ForexProposalSnapshot } from "../proposal";

export interface ForexBuyGateway {
  buyProposal(proposalId: string, price: number): Promise<ForexBuyGatewayResponse>;
}

export interface ForexBuyGatewayResponse {
  contractId: string;
  transactionId?: string;
  buyPrice?: number;
  payout?: number;
  purchaseTime?: number;
  startTime?: number;
  balanceAfter?: number;
  raw?: unknown;
}

export interface ForexTradeExecutorInput {
  authorization: ForexExecutionAuthorization;
  proposal: ForexProposalSnapshot;
  now: number;
}

export type ForexTradeExecutionCode =
  | "TRADE_EXECUTED"
  | "EXECUTION_NOT_AUTHORIZED"
  | "INVALID_PROPOSAL"
  | "PRICE_MISMATCH"
  | "DUPLICATE_EXECUTION"
  | "BUY_REJECTED"
  | "BUY_RESPONSE_INVALID";

export interface ForexTradeExecutionResult {
  executed: boolean;
  code: ForexTradeExecutionCode;
  reason: string;
  executedAt: number;
  decisionId: string;
  proposalId?: string;
  contractId?: string;
  transactionId?: string;
  buyPrice?: number;
  payout?: number;
  purchaseTime?: number;
  startTime?: number;
  balanceAfter?: number;
  raw?: unknown;
}
