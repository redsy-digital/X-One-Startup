import { create } from "zustand";
import { supabase } from "../lib/supabase";
import { logger } from "../lib/logger";
import { ACCUMULATORS_GROWTH_RATES, isAccumulatorsGrowthRate, type AccumulatorsGrowthRate } from "../accumulators/types";

export interface AccumulatorsSettings {
  growthRate: AccumulatorsGrowthRate;
  tickCount: number;
  stake: number;
  targetProfit: number;
  stopLoss: number;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  maxConsecutiveLosses: number;
  cooldownAfterLoss: number;
}

export const DEFAULT_ACCUMULATORS_SETTINGS: AccumulatorsSettings = {
  growthRate: 0.01,
  tickCount: 5,
  stake: 0.35,
  targetProfit: 3.5,
  stopLoss: 6.0,
  useMartingale: true,
  martingaleMultiplier: 2.1,
  maxMartingaleSteps: 3,
  maxConsecutiveLosses: 5,
  cooldownAfterLoss: 30,
};

interface AccumulatorsSettingsState {
  settings: AccumulatorsSettings;
  isLoaded: boolean;
  isDirty: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (partial: Partial<AccumulatorsSettings>) => void;
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null;

async function saveToSupabase(settings: AccumulatorsSettings) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("accumulators_settings").upsert({
      user_id: user.id,
      growth_rate: settings.growthRate,
      tick_count: settings.tickCount,
      stake: settings.stake,
      target_profit: settings.targetProfit,
      stop_loss: settings.stopLoss,
      use_martingale: settings.useMartingale,
      martingale_multiplier: settings.martingaleMultiplier,
      max_martingale_steps: settings.maxMartingaleSteps,
      max_consecutive_losses: settings.maxConsecutiveLosses,
      cooldown_after_loss: settings.cooldownAfterLoss,
    }, { onConflict: "user_id" });

    if (!error) useAccumulatorsSettingsStore.setState({ isDirty: false });
    else logger.error(`[Accumulators Settings] save failed: ${error.message}`);
  } catch (e) {
    console.error("[Accumulators Settings] save failed:", e);
  }
}

function scheduleSave(settings: AccumulatorsSettings) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => void saveToSupabase(settings), 1500);
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeGrowthRate(value: unknown): AccumulatorsGrowthRate {
  const n = Number(value);
  return isAccumulatorsGrowthRate(n) ? n : DEFAULT_ACCUMULATORS_SETTINGS.growthRate;
}

export const useAccumulatorsSettingsStore = create<AccumulatorsSettingsState>((set, get) => ({
  settings: DEFAULT_ACCUMULATORS_SETTINGS,
  isLoaded: false,
  isDirty: false,

  loadSettings: async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { set({ isLoaded: true }); return; }

      const { data } = await supabase
        .from("accumulators_settings")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (!data) { set({ isLoaded: true }); return; }

      set({
        isLoaded: true,
        settings: {
          growthRate: normalizeGrowthRate(data.growth_rate),
          tickCount: Math.max(1, Math.round(numberOr(data.tick_count, DEFAULT_ACCUMULATORS_SETTINGS.tickCount))),
          stake: numberOr(data.stake, DEFAULT_ACCUMULATORS_SETTINGS.stake),
          targetProfit: numberOr(data.target_profit, DEFAULT_ACCUMULATORS_SETTINGS.targetProfit),
          stopLoss: numberOr(data.stop_loss, DEFAULT_ACCUMULATORS_SETTINGS.stopLoss),
          useMartingale: Boolean(data.use_martingale),
          martingaleMultiplier: numberOr(data.martingale_multiplier, DEFAULT_ACCUMULATORS_SETTINGS.martingaleMultiplier),
          maxMartingaleSteps: numberOr(data.max_martingale_steps, DEFAULT_ACCUMULATORS_SETTINGS.maxMartingaleSteps),
          maxConsecutiveLosses: numberOr(data.max_consecutive_losses, DEFAULT_ACCUMULATORS_SETTINGS.maxConsecutiveLosses),
          cooldownAfterLoss: numberOr(data.cooldown_after_loss, DEFAULT_ACCUMULATORS_SETTINGS.cooldownAfterLoss),
        },
      });
      logger.system("Settings Accumulators carregadas do Supabase");
    } catch {
      set({ isLoaded: true });
    }
  },

  updateSettings: (partial) => {
    const current = get().settings;
    const next = { ...current, ...partial };
    set({ settings: next, isDirty: true });
    scheduleSave(next);
  },
}));

export { ACCUMULATORS_GROWTH_RATES };
