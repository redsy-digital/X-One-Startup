import { create } from "zustand";
import type { ForexDecisionResult } from "../forex/decision-engine";
import type { ForexProposalSnapshot } from "../forex/proposal";
import type { ForexExecutionAuthorization } from "../forex/execution-guard";
import type { ForexContractSnapshot } from "../forex/demo";
import type { ExperimentalDirectionSnapshot } from "../forex/direction/experimental";
import type { ExperimentalDirectionBridgeSnapshot } from "../forex/direction/bridge";

export type ForexRuntimeStage =
  | "STOPPED" | "SCANNING" | "WAIT_MARKET" | "WAIT_DATA" | "WAIT_SIGNAL"
  | "NEWS_BLOCK" | "RISK_BLOCK" | "WAIT_CONTRACT" | "PROPOSAL"
  | "GUARD" | "EXECUTING" | "OPEN" | "CLOSED" | "ERROR";

export interface ForexRuntimeState {
  stage: ForexRuntimeStage;
  message: string;
  lastDecision: ForexDecisionResult | null;
  experimentalDirection: ExperimentalDirectionSnapshot | null;
  experimentalBridge: ExperimentalDirectionBridgeSnapshot | null;
  lastProposal: ForexProposalSnapshot | null;
  lastAuthorization: ForexExecutionAuthorization | null;
  activeContract: ForexContractSnapshot | null;
  lastResult: ForexContractSnapshot | null;
  lastError: string | null;
  evaluations: number;
  lastEvaluationAt: number | null;
  demoVerified: boolean;
  executionEnabled: boolean;
}

const initial: ForexRuntimeState = {
  stage: "STOPPED",
  message: "Bot parado.",
  lastDecision: null,
  experimentalDirection: null,
  experimentalBridge: null,
  lastProposal: null,
  lastAuthorization: null,
  activeContract: null,
  lastResult: null,
  lastError: null,
  evaluations: 0,
  lastEvaluationAt: null,
  demoVerified: false,
  executionEnabled: false,
};

export const useForexRuntimeStore = create<ForexRuntimeState & {
  patch: (partial: Partial<ForexRuntimeState>) => void;
  reset: () => void;
}>((set) => ({
  ...initial,
  patch: (partial) => set((state) => ({ ...state, ...partial })),
  reset: () => set(initial),
}));
