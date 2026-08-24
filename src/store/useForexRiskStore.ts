import { create } from "zustand";
import {
  DEFAULT_FOREX_RISK_CONFIG,
  type ForexRiskConfig,
} from "../forex/risk/types";

const STORAGE_KEY = "xone_forex_risk_config_v1";

function loadInitial(): ForexRiskConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FOREX_RISK_CONFIG;
    return { ...DEFAULT_FOREX_RISK_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FOREX_RISK_CONFIG;
  }
}

export interface ForexRiskSettingsState {
  config: ForexRiskConfig;
  update: (partial: Partial<ForexRiskConfig>) => void;
  reset: () => void;
}

export const useForexRiskStore = create<ForexRiskSettingsState>((set, get) => ({
  config: loadInitial(),
  update: (partial) => {
    const next = { ...get().config, ...partial };
    set({ config: next });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* best effort */ }
  },
  reset: () => {
    set({ config: DEFAULT_FOREX_RISK_CONFIG });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_FOREX_RISK_CONFIG)); } catch { /* best effort */ }
  },
}));
