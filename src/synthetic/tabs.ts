import { create } from "zustand";
import type { AccumulatorConfig } from "../accumulators/types";
import { DEFAULT_ACCUMULATOR_FILTERS } from "../accumulators/filters";

export type SyntheticOperationKind = "digits" | "accumulators";

export interface SyntheticOperationTab {
  id: string;
  kind: SyntheticOperationKind;
  name: string;
  symbol: string;
  createdAt: number;
  accumulator?: AccumulatorConfig;
}

interface SyntheticTabsState {
  tabs: SyntheticOperationTab[];
  activeTabId: string | null;
  runningTabId: string | null;
  createTab: (kind: SyntheticOperationKind) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabSymbol: (id: string, symbol: string) => void;
  updateAccumulator: (id: string, partial: Partial<AccumulatorConfig>) => void;
  setRunningTabId: (id: string | null) => void;
}

let sequence = 0;
const makeId = () => `synthetic-tab-${Date.now()}-${++sequence}`;
const DEFAULT_ACCU: AccumulatorConfig = {
  symbol: "1HZ100V",
  durationTicks: 20,
  stake: 1,
  targetProfit: 3.5,
  stopLoss: 6,
  useMartingale: true,
  martingaleMultiplier: 2.1,
  maxMartingaleSteps: 3,
  maxConsecutiveLosses: 5,
  cooldownAfterLoss: 30,
  growthRate: 0.01,
  closeMode: "ticks",
  profitPercentTarget: 25,
  contractTakeProfit: 0.5,
  useProfitMartingale: false,
  profitMartingaleTarget: 0.5,
};

export const useSyntheticTabsStore = create<SyntheticTabsState>((set) => ({
  tabs: [], activeTabId: null, runningTabId: null,
  createTab: (kind) => {
    const id = makeId();
    const tab: SyntheticOperationTab = {
      id, kind, name: kind === "digits" ? `Digits ${sequence}` : `Accumulators ${sequence}`,
      symbol: "1HZ100V", createdAt: Date.now(),
      ...(kind === "accumulators" ? { accumulator: { ...DEFAULT_ACCU } } : {}),
    };
    set(s => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    return id;
  },
  closeTab: (id) => set(s => {
    if (s.runningTabId === id) return s;
    const tabs = s.tabs.filter(t => t.id !== id);
    return { tabs, activeTabId: s.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeTabId };
  }),
  setActiveTab: (id) => set(s => ({ activeTabId: s.tabs.some(t => t.id === id) ? id : s.activeTabId })),
  setTabSymbol: (id, symbol) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, symbol, ...(t.accumulator ? { accumulator: { ...t.accumulator, symbol } } : {}) } : t) })),
  updateAccumulator: (id, partial) => set(s => ({ tabs: s.tabs.map(t => t.id === id && t.accumulator ? { ...t, accumulator: { ...t.accumulator, ...partial }, symbol: partial.symbol ?? t.symbol } : t) })),
  setRunningTabId: (id) => set({ runningTabId: id }),
}));
