import { create } from "zustand";

export type SyntheticTabType = "digits" | "accumulators";

export interface SyntheticTab {
  id: string;
  type: SyntheticTabType;
  label: string;
}

const TAB_LABELS: Record<SyntheticTabType, string> = {
  digits: "Digits",
  accumulators: "Accumulators",
};

interface SyntheticTabsState {
  tabs: SyntheticTab[];
  activeTabId: string | null;
  /** ID da aba "dona" da execução atual do bot (isBotRunning em useBotStore).
   *  Null quando nenhum bot de Índices Sintéticos está a operar. Usado para
   *  bloquear o botão Start nas restantes abas — nunca duas abas ativas ao
   *  mesmo tempo. */
  runningTabId: string | null;

  addTab: (type: SyntheticTabType) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setRunningTab: (id: string | null) => void;
  reset: () => void;
}

let _seq = 0;
function nextId(type: SyntheticTabType) {
  _seq += 1;
  return `${type}-${Date.now()}-${_seq}`;
}

export const useSyntheticTabsStore = create<SyntheticTabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  runningTabId: null,

  addTab: (type) => {
    const id = nextId(type);
    const existingOfType = get().tabs.filter((t) => t.type === type).length;
    const label = existingOfType > 0 ? `${TAB_LABELS[type]} ${existingOfType + 1}` : TAB_LABELS[type];
    set((state) => ({ tabs: [...state.tabs, { id, type, label }], activeTabId: id }));
    return id;
  },

  closeTab: (id) => set((state) => {
    const tabs = state.tabs.filter((t) => t.id !== id);
    const wasActive = state.activeTabId === id;
    return {
      tabs,
      activeTabId: wasActive ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId,
      // Se a aba fechada era a que estava a operar, a paragem do bot é da
      // responsabilidade de quem chama closeTab (ver SyntheticTabsBar) —
      // aqui só garantimos que não fica uma referência pendurada.
      runningTabId: state.runningTabId === id ? null : state.runningTabId,
    };
  }),

  setActiveTab: (id) => set({ activeTabId: id }),
  setRunningTab: (id) => set({ runningTabId: id }),

  reset: () => set({ tabs: [], activeTabId: null, runningTabId: null }),
}));
