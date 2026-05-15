import { create } from "zustand";
import { TradeHistory } from "../types";
import { loadHistoryFromSupabase, getTradeHistory } from "../lib/storage";

interface HistoryState {
  history: TradeHistory[];
  historyLoading: boolean;
  loadHistory: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  history: [],
  historyLoading: false,

  loadHistory: async () => {
    set({ historyLoading: true });
    try {
      // Tenta Supabase primeiro; cai no localStorage se não houver sessão
      const history = await loadHistoryFromSupabase();
      set({ history, historyLoading: false });
    } catch {
      // Fallback garantido
      set({ history: getTradeHistory(), historyLoading: false });
    }
  },
}));
