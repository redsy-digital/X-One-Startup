import { create } from "zustand";
import type { AccumulatorRuntimeState } from "./types";

const INITIAL: AccumulatorRuntimeState = {
  currentStake: 1,
  martingaleStep: 0,
  consecutiveLosses: 0,
  isProcessing: false,
  activeContractId: null,
  ticksElapsed: 0,
  ticksTarget: 20,
  currentValue: null,
  currentProfit: null,
  currentProfitPercent: null,
  currentSpot: null,
  currentHighBarrier: null,
  currentLowBarrier: null,
  lastContractId: null,
  lastStake: null,
  lastResult: null,
  lastProfit: null,
  lastTradeAt: null,
  entries: 0,
  error: null,
  isManualContract: false,
  activeCloseMode: null,
  activeProfitTarget: null,
  closeReason: null,
  lastWasKnockout: false,
  profitMartingaleActive: false,
  sessionLimitReached: null,
  chartPoints: [],
  filterBlocked: false,
  filterReasons: [],
  filterWaitTicksRemaining: 0,
  filterSamples: 0,
};

interface AccumulatorStore {
  runtime: AccumulatorRuntimeState;
  setRuntime: (patch: Partial<AccumulatorRuntimeState>) => void;
  resetRuntime: (stake: number, ticksTarget: number) => void;
}

export const useAccumulatorStore = create<AccumulatorStore>((set) => ({
  runtime: INITIAL,
  setRuntime: (patch) => set((s) => ({ runtime: { ...s.runtime, ...patch } })),
  resetRuntime: (stake, ticksTarget) => set({ runtime: { ...INITIAL, currentStake: stake, ticksTarget } }),
}));
