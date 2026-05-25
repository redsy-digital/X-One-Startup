import { create } from "zustand";
import { TradeSignal } from "../types";
interface SignalState { lastSignal: TradeSignal | null; setLastSignal: (s: TradeSignal | null) => void; }
export const useSignalStore = create<SignalState>((set) => ({ lastSignal: null, setLastSignal: (signal) => set({ lastSignal: signal }) }));
