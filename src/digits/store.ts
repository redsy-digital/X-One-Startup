import { create } from "zustand";
import type { DigitsRuntimeState } from "./types";

const INITIAL_RUNTIME: DigitsRuntimeState = {
  currentStake: 0,
  martingaleStep: 0,
  advancedMartingaleStep: 0,
  advancedMartingaleExhausted: false,
  currentContract: null,
  currentTargetDigit: null,
  currentStakeInTrade: null,
  lastContract: null,
  lastTargetDigit: null,
  lastExitDigit: null,
  lastStake: null,
  nextContract: null,
  nextTargetDigit: null,
  nextStake: null,
  consecutiveLosses: 0,
  isProcessing: false,
  activeContractId: null,
  lastResult: null,
  lastProfit: null,
  lastTradeAt: null,
  entries: 0,
  error: null,
};

interface DigitsRuntimeStore {
  runtime: DigitsRuntimeState;
  setRuntime: (patch: Partial<DigitsRuntimeState>) => void;
  resetRuntime: (stake: number) => void;
}

export const useDigitsStore = create<DigitsRuntimeStore>((set) => ({
  runtime: INITIAL_RUNTIME,
  setRuntime: (patch) => set((state) => ({ runtime: { ...state.runtime, ...patch } })),
  resetRuntime: (stake) => set({ runtime: { ...INITIAL_RUNTIME, currentStake: stake } }),
}));
