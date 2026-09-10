export const FOREX_DEMO_TRADING_VERSION = "forex-demo-trading-v1.0.0" as const;

export interface ForexDemoAccountState {
  /** Explicitly verified by the authenticated account response. */
  isDemo: boolean;
  accountId: string;
  currency: string;
  authorized: boolean;
}

export interface ForexDemoBuyInput {
  proposalId: string;
  price: number;
  account: ForexDemoAccountState;
}

export interface ForexDemoBuyGateway {
  buyProposal(proposalId: string, price: number): Promise<{
    contractId: string;
    transactionId?: string;
    buyPrice?: number;
    payout?: number;
    purchaseTime?: number;
    startTime?: number;
    balanceAfter?: number;
    raw?: unknown;
  }>;
}

export type ForexDemoExecutionCode =
  | "DEMO_BUY_EXECUTED"
  | "DEMO_ONLY_BLOCK"
  | "ACCOUNT_NOT_AUTHORIZED"
  | "INVALID_BUY_INPUT"
  | "DUPLICATE_BUY"
  | "BUY_REJECTED"
  | "BUY_RESPONSE_INVALID";

export interface ForexDemoExecutionResult {
  executed: boolean;
  code: ForexDemoExecutionCode;
  reason: string;
  accountId: string;
  contractId?: string;
  transactionId?: string;
  buyPrice?: number;
  payout?: number;
  purchaseTime?: number;
  startTime?: number;
  balanceAfter?: number;
  raw?: unknown;
}

export interface ForexContractSnapshot {
  contractId: string;
  status: "OPEN" | "WON" | "LOST" | "SOLD" | "UNKNOWN";
  isSold: boolean;
  contractType?: string;
  buyPrice?: number;
  payout?: number;
  profit?: number;
  entryPrice?: number;
  exitPrice?: number;
  dateStart?: number;
  dateExpiry?: number;
  raw?: unknown;
}

export interface ForexContractMonitorGateway {
  subscribeContract(contractId: string): void;
  onContractUpdate(listener: (snapshot: ForexContractSnapshot) => void): () => void;
}
