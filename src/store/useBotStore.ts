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
  // Cronómetro de sessão — vive aqui (store global) em vez de estado local
  // do DashboardPage. O motor de trading corre independentemente da página
  // visitada (TradingEngineRunner em App.tsx), então o cronómetro também
  // precisa de sobreviver à navegação, não só ao componente que o mostra.
  // sessionStartedAt marca o início (epoch ms); sessionFrozenElapsed guarda
  // o tempo decorrido (segundos) no momento em que o bot pára, para o
  // cronómetro mostrar o valor final em vez de voltar a zero ou continuar
  // a contar depois de parado.
  sessionStartedAt: number | null;
  sessionFrozenElapsed: number;
}

function transition(state: BotState, val: boolean): Partial<BotState> {
  if (val) {
    return {
      isBotRunning: true,
      // Já a correr (ex.: chamado 2x): mantém o timestamp original.
      sessionStartedAt: state.isBotRunning ? state.sessionStartedAt : Date.now(),
      sessionFrozenElapsed: 0,
    };
  }
  const frozen = state.sessionStartedAt
    ? Math.floor((Date.now() - state.sessionStartedAt) / 1000)
    : state.sessionFrozenElapsed;
  return { isBotRunning: false, sessionFrozenElapsed: frozen };
}

export const useBotStore = create<BotState>((set) => ({
  isBotRunning: false,
  sessionStartedAt: null,
  sessionFrozenElapsed: 0,

  setIsBotRunning: (val) => set((state) => transition(state, val)),

  toggleBot: () => set((state) => transition(state, !state.isBotRunning)),

  lossCooldown: null,
  setLossCooldown: (cooldown) => set({ lossCooldown: cooldown }),
}));
