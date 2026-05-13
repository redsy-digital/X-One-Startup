import { create } from "zustand";

interface BotState {
  isBotRunning: boolean;
  setIsBotRunning: (val: boolean) => void;
  toggleBot: () => void;
}

export const useBotStore = create<BotState>((set, get) => ({
  isBotRunning: false,

  setIsBotRunning: (val) => set({ isBotRunning: val }),

  toggleBot: () => set((state) => ({ isBotRunning: !state.isBotRunning })),
}));
