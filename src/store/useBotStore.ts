import { create } from "zustand";

export interface LossCooldown {
  reason: string;
  until: number; // epoch ms — quando o cooldown termina
}

interface BotState {
  isBotRunning: boolean;
  setIsBotRunning: (val: boolean) => void;
  toggleBot: () => void;
  lossCooldown: LossCooldown | null;
  setLossCooldown: (cooldown: LossCooldown | null) => void;
}

export const useBotStore = create<BotState>((set, get) => ({
  isBotRunning: false,

  setIsBotRunning: (val) => set({ isBotRunning: val }),

  toggleBot: () => set((state) => ({ isBotRunning: !state.isBotRunning })),

  lossCooldown: null,
  setLossCooldown: (cooldown) => set({ lossCooldown: cooldown }),
}));
