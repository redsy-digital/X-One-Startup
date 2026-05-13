import { create } from "zustand";
import { TradeHistory } from "../types";
import { getTradeHistory } from "../lib/storage";

interface HistoryState {
  history: TradeHistory[];
  loadHistory: () => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  history: [],

  loadHistory: () => {
    set({ history: getTradeHistory() });
  },
}));
