export type AccumulatorCloseMode = "ticks" | "profit_percent" | "contract_take_profit";
import type { AccumulatorFiltersConfig } from "./filters";

export interface AccumulatorConfig {
  symbol: string;
  /** Tick threshold used when closeMode === "ticks". ACCU itself has no expiry. */
  durationTicks: number;
  /** Base stake used by the normal risk progression. */
  stake: number;
  /** Session-level take profit (kept separate from contract-level TP). */
  targetProfit: number;
  stopLoss: number;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  maxConsecutiveLosses: number;
  cooldownAfterLoss: number;
  growthRate: number;

  /** How X-One decides when to sell the current ACCU. */
  closeMode: AccumulatorCloseMode;
  /** Close when contract profit_percentage reaches this value. 25 = 25%, 200 = 200%. */
  profitPercentTarget: number;
  /** Close when contract profit reaches this amount in account currency. */
  contractTakeProfit: number;

  /** After an ACCU knockout, temporarily use the configured profit target on the next contract. */
  useProfitMartingale: boolean;
  profitMartingaleTarget: number;
  filters: AccumulatorFiltersConfig;
}

export type AccumulatorTradeResult = "WON" | "LOST";
export type AccumulatorSessionLimitType = "take_profit" | "stop_loss";

export interface AccumulatorSessionLimitReached {
  type: AccumulatorSessionLimitType;
  amount: number;
  reason: string;
}

export interface AccumulatorChartPoint {
  time: number;
  price: number;
  high: number | null;
  low: number | null;
}

export interface AccumulatorRuntimeState {
  currentStake: number;
  martingaleStep: number;
  consecutiveLosses: number;
  isProcessing: boolean;
  activeContractId: string | null;
  ticksElapsed: number;
  ticksTarget: number;
  currentValue: number | null;
  currentProfit: number | null;
  currentProfitPercent: number | null;
  currentSpot: number | null;
  currentHighBarrier: number | null;
  currentLowBarrier: number | null;
  lastContractId: string | null;
  lastStake: number | null;
  lastResult: AccumulatorTradeResult | null;
  lastProfit: number | null;
  lastTradeAt: number | null;
  entries: number;
  error: string | null;
  isManualContract: boolean;
  activeCloseMode: AccumulatorCloseMode | null;
  activeProfitTarget: number | null;
  closeReason: string | null;
  lastWasKnockout: boolean;
  profitMartingaleActive: boolean;
  sessionLimitReached: AccumulatorSessionLimitReached | null;
  chartPoints: AccumulatorChartPoint[];
  filterBlocked: boolean;
  filterReasons: string[];
  filterWaitTicksRemaining: number;
  filterSamples: number;
}
