export type RiseFallContractType = "CALL" | "PUT";
export type RiseFallDirection = "UP" | "DOWN";

export interface RiseFallConfig {
  symbol: string;
  durationTicks: number;
  contract: RiseFallContractType;
  stake: number;
  targetProfit: number;
  stopLoss: number;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  maxConsecutiveLosses: number;
  cooldownAfterLoss: number;
  sequenceEnabled: boolean;
  sequenceLength: number;
  blockDensityEnabled: boolean;
  blockWindow: number;
  blockThreshold: number;
  alternatingEnabled: boolean;
  alternatingLength: number;
  isAuthorized: boolean;
  isBotRunning: boolean;
  isBotPaused: boolean;
  balance: number | null;
}

export interface RiseFallRuntimeState {
  currentStake: number;
  martingaleStep: number;
  consecutiveLosses: number;
  isProcessing: boolean;
  activeContractId: string | null;
  currentContract: RiseFallContractType | null;
  lastContract: RiseFallContractType | null;
  lastResult: "WON" | "LOST" | null;
  lastProfit: number | null;
  lastStake: number | null;
  lastTradeAt: number | null;
  entries: number;
  nextContract: RiseFallContractType | null;
  nextStake: number;
  error: string | null;
}
