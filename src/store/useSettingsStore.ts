import { create } from "zustand";
import { supabase } from "../lib/supabase";
import { STRATEGY_PROFILES } from "../lib/strategy";
import { StrategyProfile } from "../types";
import { logger } from "../lib/logger";

export interface BotSettings {
  stake: number;
  targetProfit: number;
  stopLoss: number;
  minConfidence: number;
  cooldownSeconds: number;
  strategyProfile: StrategyProfile;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  useSoros: boolean;
  maxSorosLevels: number;
  maxConsecutiveLosses: number;
  cooldownAfterLoss: number;
  // Duração do contrato em ticks (Deriv duration_unit "t"). Usado tanto no
  // motor ao vivo (getPriceProposal) como no backtest — os dois lêem daqui,
  // para nunca poderem dessincronizar como aconteceu antes desta funcionalidade.
  contractDurationTicks: number;
}

export const DEFAULT_SETTINGS: BotSettings = {
  // $0.35 = mínimo real da Deriv para opções em Índices Sintéticos
  // (confirmado na comunidade oficial Deriv, 11/08/2026) — abaixo disso a
  // proposta é rejeitada pela API.
  stake: 0.35,
  targetProfit: 3.5,
  // $6.00 ≈ 1 ciclo completo do Martingale (3 passos, 2.1x, stake $0.35 =
  // $5.87 acumulado) + margem pequena — dimensionado por simulação Monte
  // Carlo (20.000 sessões, bootstrap de sequências reais de 7 símbolos,
  // 11/08/2026): SL mais apertado (~$4.20, proporcional ao valor antigo)
  // cortava recuperações a meio do ciclo com mais frequência, sem reduzir
  // o pior caso proporcionalmente — pior mediana E pior taxa de Take
  // Profit ao mesmo tempo. $6.00 deu a melhor taxa de TP (62.3% vs 54.9%)
  // com mediana ainda positiva; troca-se por um pior caso maior mas mais
  // previsível (menos surpresa de SL nominal vs real).
  stopLoss: 6.0,
  // 50 ≈ a taxa validada dos dois modos hoje (MR 50.11%, TREND 49.68%,
  // ver strategy.ts) — na prática deixa passar quase tudo, já que a
  // confiança deixou de ser um score gradual por trade (ver correcção da
  // fórmula de confiança, 09/08/2026). Ajusta aqui se um dos modos vier a
  // validar melhor que o outro no futuro.
  minConfidence: 50,
  cooldownSeconds: 10, // aumentado: dados mostram clusters de 3 trades em 11s → entradas correlacionadas
  strategyProfile: "balanced",
  useMartingale: true,
  martingaleMultiplier: 2.1,
  maxMartingaleSteps: 3, // step3($9.26)=0%WR; steps 0-2 têm 44-67%WR
  useSoros: false,
  maxSorosLevels: 3,
  maxConsecutiveLosses: 5,
  cooldownAfterLoss: 30,
  contractDurationTicks: 5, // valor histórico — muda explicitamente se quiseres outro
};

interface SettingsState {
  settings: BotSettings;
  isLoaded: boolean;
  isDirty: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (partial: Partial<BotSettings>) => void;
  changeProfile: (profile: StrategyProfile) => void;
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null;

async function saveToSupabase(settings: BotSettings) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("bot_settings").upsert({
      user_id: user.id,
      stake: settings.stake,
      target_profit: settings.targetProfit,
      stop_loss: settings.stopLoss,
      min_confidence: settings.minConfidence,
      cooldown_seconds: settings.cooldownSeconds,
      strategy_profile: settings.strategyProfile,
      use_martingale: settings.useMartingale,
      martingale_multiplier: settings.martingaleMultiplier,
      max_martingale_steps: settings.maxMartingaleSteps,
      use_soros: settings.useSoros,
      max_soros_levels: settings.maxSorosLevels,
      max_consecutive_losses: settings.maxConsecutiveLosses,
      cooldown_after_loss: settings.cooldownAfterLoss,
      contract_duration_ticks: settings.contractDurationTicks,
    }, { onConflict: "user_id" });
    if (!error) useSettingsStore.setState({ isDirty: false });
  } catch (e) {
    console.error("[Settings] save failed:", e);
  }
}

function scheduleSave(settings: BotSettings) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveToSupabase(settings), 1500);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  isDirty: false,

  loadSettings: async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { set({ isLoaded: true }); return; }
      const { data } = await supabase
        .from("bot_settings").select("*").eq("user_id", user.id).single();
      if (!data) { set({ isLoaded: true }); return; }
      set({
        isLoaded: true,
        settings: {
          stake: Number(data.stake),
          targetProfit: Number(data.target_profit),
          stopLoss: Number(data.stop_loss),
          minConfidence: Number(data.min_confidence),
          cooldownSeconds: Number(data.cooldown_seconds),
          strategyProfile: (data.strategy_profile as StrategyProfile) ?? "balanced",
          useMartingale: Boolean(data.use_martingale),
          martingaleMultiplier: Number(data.martingale_multiplier),
          maxMartingaleSteps: Number(data.max_martingale_steps),
          useSoros: Boolean(data.use_soros),
          maxSorosLevels: Number(data.max_soros_levels),
          maxConsecutiveLosses: Number(data.max_consecutive_losses),
          cooldownAfterLoss: Number(data.cooldown_after_loss),
          contractDurationTicks: Number(data.contract_duration_ticks) || 5,
        },
      });
      logger.system("Settings carregadas do Supabase");
    } catch { set({ isLoaded: true }); }
  },

  updateSettings: (partial) => {
    const next = { ...get().settings, ...partial };
    set({ settings: next, isDirty: true });
    scheduleSave(next);
  },

  changeProfile: (profile) => {
    const override = STRATEGY_PROFILES[profile].minConfidenceOverride;
    const next = { ...get().settings, strategyProfile: profile, minConfidence: override };
    set({ settings: next, isDirty: true });
    scheduleSave(next);
    logger.system(`Perfil: ${profile} | Conf. mínima: ${override}%`);
  },
}));
