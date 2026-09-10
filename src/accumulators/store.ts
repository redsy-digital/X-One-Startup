import { create } from "zustand";
import type { AccumulatorsRuntimeState } from "./types";

const INITIAL_RUNTIME: AccumulatorsRuntimeState = {
  currentStake: 0,
  martingaleStep: 0,
  consecutiveLosses: 0,
  currentStakeInTrade: null,
  activeContractId: null,
  ticksElapsed: 0,
  currentContractValue: null,
  isManualTrade: false,
  lastStake: null,
  lastResult: null,
  lastTradeAt: null,
  lastProfit: null,
  lastTicks: null,
  isProcessing: false,
  entries: 0,
  error: null,
};

interface AccumulatorsRuntimeStore {
  runtime: AccumulatorsRuntimeState;
  setRuntime: (patch: Partial<AccumulatorsRuntimeState>) => void;
  resetRuntime: (stake: number) => void;
}

export const useAccumulatorsStore = create<AccumulatorsRuntimeStore>((set) => ({
  runtime: INITIAL_RUNTIME,
  setRuntime: (patch) => set((state) => ({ runtime: { ...state.runtime, ...patch } })),
  resetRuntime: (stake) => set({ runtime: { ...INITIAL_RUNTIME, currentStake: stake } }),
}));
