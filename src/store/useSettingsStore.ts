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
}

export const DEFAULT_SETTINGS: BotSettings = {
  stake: 1,
  targetProfit: 10,
  stopLoss: 5,
  minConfidence: 50, // dados 04/07: conf 50-59% → 64% WR; conf 40-49% → 24% WR
  cooldownSeconds: 10, // aumentado: dados mostram clusters de 3 trades em 11s → entradas correlacionadas
  strategyProfile: "balanced",
  useMartingale: true,
  martingaleMultiplier: 2.1,
  maxMartingaleSteps: 5,
  useSoros: false,
  maxSorosLevels: 3,
  maxConsecutiveLosses: 5,
  cooldownAfterLoss: 30,
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
