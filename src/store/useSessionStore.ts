import { create } from "zustand";

interface ModalState { show: boolean; type: "profit" | "loss"; amount: number; }

interface SessionState {
  wins: number; losses: number; pnl: number; consecutiveLosses: number;
  modal: ModalState;
  recordWin: (profit: number) => void;
  recordLoss: (loss: number) => void;
  resetSession: () => void;
  setModal: (modal: ModalState) => void;
  closeModal: () => void;
}

const INITIAL = { wins: 0, losses: 0, pnl: 0, consecutiveLosses: 0, modal: { show: false, type: "profit" as const, amount: 0 } };

export const useSessionStore = create<SessionState>((set) => ({
  ...INITIAL,
  recordWin: (profit) => set(s => ({ wins: s.wins + 1, pnl: s.pnl + profit, consecutiveLosses: 0 })),
  recordLoss: (loss) => set(s => ({ losses: s.losses + 1, pnl: s.pnl + loss, consecutiveLosses: s.consecutiveLosses + 1 })),
  resetSession: () => set(INITIAL),
  setModal: (modal) => set({ modal }),
  closeModal: () => set(s => ({ modal: { ...s.modal, show: false } })),
}));
