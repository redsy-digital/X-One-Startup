import { create } from "zustand";
import { supabase } from "../lib/supabase";
import type { StrategyProfile } from "../types";
import type { DigitsContractType, DigitsTargetMode } from "../digits/types";
import { logger } from "../lib/logger";
import type { DigitsSequenceMode } from "../digits/sequenceStrategy";

export interface BotSettings {
  // Gestão de banca partilhada pela operação de Índices/Digits V1.
  stake: number;
  targetProfit: number;
  stopLoss: number;
  cooldownSeconds: number;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  maxConsecutiveLosses: number;
  cooldownAfterLoss: number;

  // Configurações antigas mantidas no schema por compatibilidade com dados já
  // existentes. Não são usadas pelo motor de Digits nem pelo runtime Forex.
  minConfidence: number;
  strategyProfile: StrategyProfile;
  useSoros: boolean;
  maxSorosLevels: number;
  contractDurationTicks: number;
  digitsChartType: "digits" | "percentage" | "candles";
  digitsSymbol: string;

  // Estratégia opcional de sequência Par/Ímpar.
  digitsSequenceStrategyEnabled: boolean;
  digitsSequenceStrategyMode: DigitsSequenceMode;
  digitsSequenceLength: number;

  // Estratégia opcional de sequência Over/Under.
  digitsOverUnderSequenceStrategyEnabled: boolean;
  digitsOverUnderSequenceLength: number;
  digitsOverUnderOverBarrier: number;
  digitsOverUnderUnderBarrier: number;

  // Estratégias estatísticas sobre a distribuição percentual dos últimos dígitos.
  digitsPercentageSaturationStrategyEnabled: boolean;
  digitsPercentageSaturationThreshold: number;
  digitsPercentageAbsenceStrategyEnabled: boolean;
  digitsPercentageAbsenceStreak: number;
  digitsPercentageWindow: number;

  // Estratégias probabilísticas de Par/Ímpar.
  digitsParityBlockDensityEnabled: boolean;
  digitsParityBlockWindow: number;
  digitsParityBlockThreshold: number;
  digitsParityAlternatingEnabled: boolean;
  digitsParityAlternatingLength: number;
  digitsParityAnchorEnabled: boolean;

  // Estratégias adicionais específicas de Digit Match.
  digitsMatchTwinEnabled: boolean;
  digitsMatchTwinRestTicks: number;
  digitsMatchMirrorEnabled: boolean;
  digitsMatchMirrorWindow: number;
  digitsMatchMirrorDominance: number;

  // Rise/Fall — direção de ticks em Índices Sintéticos.
  riseFallSymbol: string;
  riseFallDurationTicks: number;
  riseFallChartType: "candles" | "line";
  riseFallContract: "CALL" | "PUT";
  riseFallSequenceEnabled: boolean;
  riseFallSequenceLength: number;
  riseFallBlockDensityEnabled: boolean;
  riseFallBlockWindow: number;
  riseFallBlockThreshold: number;
  riseFallAlternatingEnabled: boolean;
  riseFallAlternatingLength: number;
  riseFallPercentChannelEnabled: boolean;
  riseFallPercentChannelWindow: number;
  riseFallPercentChannelThreshold: number;
  riseFallPercentChannelSequenceLength: number;
  riseFallMomentumFilterEnabled: boolean;
  riseFallTrendProtectionEnabled: boolean;
  riseFallSustainableInertiaEnabled: boolean;

  // Digits V1 — entrada fixa, sem indicadores/previsão.
  digitsContract: DigitsContractType;
  digitsTargetDigit: DigitsTargetMode;

  // Martingale Avançado — após LOSS pode mudar temporariamente o contrato/alvo.
  useAdvancedMartingale: boolean;
  advancedMartingaleContract: DigitsContractType;
  advancedMartingaleTargetDigit: number;
  maxAdvancedMartingaleSteps: number;
}

export const DEFAULT_SETTINGS: BotSettings = {
  stake: 0.35,
  targetProfit: 3.5,
  stopLoss: 6.0,
  cooldownSeconds: 0,
  useMartingale: true,
  martingaleMultiplier: 2.1,
  maxMartingaleSteps: 3,
  maxConsecutiveLosses: 5,
  cooldownAfterLoss: 30,

  // Compatibilidade apenas; o X-One V1 de Digits não usa estes campos.
  minConfidence: 0,
  strategyProfile: "balanced",
  useSoros: false,
  maxSorosLevels: 0,
  contractDurationTicks: 3,
  digitsChartType: "digits",
  digitsSymbol: "R_10",
  digitsSequenceStrategyEnabled: false,
  digitsSequenceStrategyMode: "fixed",
  digitsSequenceLength: 6,
  digitsOverUnderSequenceStrategyEnabled: false,
  digitsOverUnderSequenceLength: 5,
  digitsOverUnderOverBarrier: 4,
  digitsOverUnderUnderBarrier: 5,
  digitsPercentageSaturationStrategyEnabled: false,
  digitsPercentageSaturationThreshold: 18,
  digitsPercentageAbsenceStrategyEnabled: false,
  digitsPercentageAbsenceStreak: 38,
  digitsPercentageWindow: 100,
  digitsParityBlockDensityEnabled: false,
  digitsParityBlockWindow: 10,
  digitsParityBlockThreshold: 80,
  digitsParityAlternatingEnabled: false,
  digitsParityAlternatingLength: 4,
  digitsParityAnchorEnabled: false,
  digitsMatchTwinEnabled: false,
  digitsMatchTwinRestTicks: 3,
  digitsMatchMirrorEnabled: false,
  digitsMatchMirrorWindow: 15,
  digitsMatchMirrorDominance: 80,

  riseFallSymbol: "R_10",
  riseFallDurationTicks: 3,
  riseFallChartType: "candles",
  riseFallContract: "CALL",
  riseFallSequenceEnabled: false,
  riseFallSequenceLength: 4,
  riseFallBlockDensityEnabled: false,
  riseFallBlockWindow: 10,
  riseFallBlockThreshold: 80,
  riseFallAlternatingEnabled: false,
  riseFallAlternatingLength: 4,
  riseFallPercentChannelEnabled: false,
  riseFallPercentChannelWindow: 20,
  riseFallPercentChannelThreshold: 70,
  riseFallPercentChannelSequenceLength: 3,
  riseFallMomentumFilterEnabled: false,
  riseFallTrendProtectionEnabled: false,
  riseFallSustainableInertiaEnabled: false,

  digitsContract: "DIGITUNDER",
  digitsTargetDigit: 9,

  useAdvancedMartingale: false,
  advancedMartingaleContract: "DIGITOVER",
  advancedMartingaleTargetDigit: 2,
  maxAdvancedMartingaleSteps: 2,
};

const VALID_DIGITS_CONTRACTS: DigitsContractType[] = [
  "DIGITUNDER", "DIGITOVER", "DIGITMATCH", "DIGITDIFF", "DIGITEVEN", "DIGITODD",
];

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
      cooldown_seconds: settings.cooldownSeconds,
      use_martingale: settings.useMartingale,
      martingale_multiplier: settings.martingaleMultiplier,
      max_martingale_steps: settings.maxMartingaleSteps,
      max_consecutive_losses: settings.maxConsecutiveLosses,
      cooldown_after_loss: settings.cooldownAfterLoss,
      contract_duration_ticks: Math.max(1, Math.min(100, Math.round(settings.contractDurationTicks))),
      digits_chart_type: settings.digitsChartType,
      digits_symbol: settings.digitsSymbol,
      digits_sequence_strategy_enabled: settings.digitsSequenceStrategyEnabled,
      digits_sequence_strategy_mode: settings.digitsSequenceStrategyMode,
      digits_sequence_length: Math.max(1, Math.min(100, Math.round(settings.digitsSequenceLength))),
      digits_over_under_sequence_strategy_enabled: settings.digitsOverUnderSequenceStrategyEnabled,
      digits_over_under_sequence_length: Math.max(1, Math.min(100, Math.round(settings.digitsOverUnderSequenceLength))),
      digits_over_under_over_barrier: Math.max(0, Math.min(9, Math.round(settings.digitsOverUnderOverBarrier))),
      digits_over_under_under_barrier: Math.max(0, Math.min(9, Math.round(settings.digitsOverUnderUnderBarrier))),
      digits_percentage_saturation_strategy_enabled: settings.digitsPercentageSaturationStrategyEnabled,
      digits_percentage_saturation_threshold: Math.max(10.01, Math.min(100, Number(settings.digitsPercentageSaturationThreshold))),
      digits_percentage_absence_strategy_enabled: settings.digitsPercentageAbsenceStrategyEnabled,
      digits_percentage_absence_streak: Math.max(1, Math.min(10000, Math.round(settings.digitsPercentageAbsenceStreak))),
      digits_percentage_window: Math.max(20, Math.min(1000, Math.round(settings.digitsPercentageWindow))),
      digits_parity_block_density_enabled: settings.digitsParityBlockDensityEnabled,
      digits_parity_block_window: Math.max(2, Math.min(100, Math.round(settings.digitsParityBlockWindow))),
      digits_parity_block_threshold: Math.max(50, Math.min(100, Number(settings.digitsParityBlockThreshold))),
      digits_parity_alternating_enabled: settings.digitsParityAlternatingEnabled,
      digits_parity_alternating_length: Math.max(2, Math.min(20, Math.round(settings.digitsParityAlternatingLength))),
      digits_parity_anchor_enabled: settings.digitsParityAnchorEnabled,
      digits_match_twin_enabled: settings.digitsMatchTwinEnabled,
      digits_match_twin_rest_ticks: Math.max(0, Math.min(20, Math.round(settings.digitsMatchTwinRestTicks))),
      digits_match_mirror_enabled: settings.digitsMatchMirrorEnabled,
      digits_match_mirror_window: Math.max(4, Math.min(100, Math.round(settings.digitsMatchMirrorWindow))),
      digits_match_mirror_dominance: Math.max(50, Math.min(100, Number(settings.digitsMatchMirrorDominance))),
      rise_fall_symbol: settings.riseFallSymbol,
      rise_fall_duration_ticks: Math.max(1, Math.min(100, Math.round(settings.riseFallDurationTicks))),
      rise_fall_chart_type: settings.riseFallChartType === "line" ? "line" : "candles",
      rise_fall_contract: settings.riseFallContract === "PUT" ? "PUT" : "CALL",
      rise_fall_sequence_enabled: settings.riseFallSequenceEnabled,
      rise_fall_sequence_length: Math.max(1, Math.min(100, Math.round(settings.riseFallSequenceLength))),
      rise_fall_block_density_enabled: settings.riseFallBlockDensityEnabled,
      rise_fall_block_window: Math.max(2, Math.min(100, Math.round(settings.riseFallBlockWindow))),
      rise_fall_block_threshold: Math.max(50, Math.min(100, Number(settings.riseFallBlockThreshold))),
      rise_fall_alternating_enabled: settings.riseFallAlternatingEnabled,
      rise_fall_alternating_length: Math.max(2, Math.min(20, Math.round(settings.riseFallAlternatingLength))),
      rise_fall_percent_channel_enabled: settings.riseFallPercentChannelEnabled,
      rise_fall_percent_channel_window: Math.max(5, Math.min(500, Math.round(settings.riseFallPercentChannelWindow))),
      rise_fall_percent_channel_threshold: Math.max(1, Math.min(99, Number(settings.riseFallPercentChannelThreshold))),
      rise_fall_percent_channel_sequence_length: Math.max(1, Math.min(100, Math.round(settings.riseFallPercentChannelSequenceLength))),
      rise_fall_momentum_filter_enabled: settings.riseFallMomentumFilterEnabled,
      rise_fall_trend_protection_enabled: settings.riseFallTrendProtectionEnabled,
      rise_fall_sustainable_inertia_enabled: settings.riseFallSustainableInertiaEnabled,
      digits_contract: settings.digitsContract,
      // Random is persisted separately because the database target_digit column is numeric.
      digits_target_digit: typeof settings.digitsTargetDigit === "number" ? settings.digitsTargetDigit : 9,
      digits_random: settings.digitsTargetDigit === "random",
      digits_follow_up: settings.digitsTargetDigit === "follow_up",
      use_advanced_martingale: settings.useAdvancedMartingale,
      advanced_martingale_contract: settings.advancedMartingaleContract,
      advanced_martingale_target_digit: settings.advancedMartingaleTargetDigit,
      max_advanced_martingale_steps: settings.maxAdvancedMartingaleSteps,
    }, { onConflict: "user_id" });

    if (!error) useSettingsStore.setState({ isDirty: false });
    else logger.error(`[Settings] save failed: ${error.message}`);
  } catch (e) {
    console.error("[Settings] save failed:", e);
  }
}

function scheduleSave(settings: BotSettings) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => void saveToSupabase(settings), 1500);
}


function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeDigitsContract(value: unknown): DigitsContractType {
  return typeof value === "string" && VALID_DIGITS_CONTRACTS.includes(value as DigitsContractType)
    ? value as DigitsContractType
    : "DIGITUNDER";
}

function normalizeDigit(value: unknown): number {
  const digit = Number(value);
  return Number.isInteger(digit) && digit >= 0 && digit <= 9 ? digit : 9;
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
        .from("bot_settings")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (!data) { set({ isLoaded: true }); return; }

      set({
        isLoaded: true,
        settings: {
          ...DEFAULT_SETTINGS,
          stake: numberOr(data.stake, DEFAULT_SETTINGS.stake),
          targetProfit: numberOr(data.target_profit, DEFAULT_SETTINGS.targetProfit),
          stopLoss: numberOr(data.stop_loss, DEFAULT_SETTINGS.stopLoss),
          cooldownSeconds: numberOr(data.cooldown_seconds, 0),
          minConfidence: numberOr(data.min_confidence, 0),
          strategyProfile: (data.strategy_profile as StrategyProfile) ?? "balanced",
          useMartingale: Boolean(data.use_martingale),
          martingaleMultiplier: numberOr(data.martingale_multiplier, DEFAULT_SETTINGS.martingaleMultiplier),
          maxMartingaleSteps: numberOr(data.max_martingale_steps, DEFAULT_SETTINGS.maxMartingaleSteps),
          useSoros: Boolean(data.use_soros),
          maxSorosLevels: numberOr(data.max_soros_levels, 0),
          maxConsecutiveLosses: numberOr(data.max_consecutive_losses, DEFAULT_SETTINGS.maxConsecutiveLosses),
          cooldownAfterLoss: numberOr(data.cooldown_after_loss, DEFAULT_SETTINGS.cooldownAfterLoss),
          contractDurationTicks: Math.max(1, Math.min(100, numberOr(data.contract_duration_ticks, DEFAULT_SETTINGS.contractDurationTicks))),
          digitsChartType: data.digits_chart_type === "percentage" || data.digits_chart_type === "candles" ? data.digits_chart_type : "digits",
          digitsSymbol: typeof data.digits_symbol === "string" && data.digits_symbol ? data.digits_symbol : DEFAULT_SETTINGS.digitsSymbol,
          digitsSequenceStrategyEnabled: Boolean(data.digits_sequence_strategy_enabled),
          digitsSequenceStrategyMode: data.digits_sequence_strategy_mode === "multiple" ? "multiple" : "fixed",
          digitsSequenceLength: Math.max(1, Math.min(100, numberOr(data.digits_sequence_length, DEFAULT_SETTINGS.digitsSequenceLength))),
          digitsOverUnderSequenceStrategyEnabled: Boolean(data.digits_over_under_sequence_strategy_enabled),
          digitsOverUnderSequenceLength: Math.max(1, Math.min(100, numberOr(data.digits_over_under_sequence_length, DEFAULT_SETTINGS.digitsOverUnderSequenceLength))),
          digitsOverUnderOverBarrier: Math.max(0, Math.min(9, numberOr(data.digits_over_under_over_barrier, DEFAULT_SETTINGS.digitsOverUnderOverBarrier))),
          digitsOverUnderUnderBarrier: Math.max(0, Math.min(9, numberOr(data.digits_over_under_under_barrier, DEFAULT_SETTINGS.digitsOverUnderUnderBarrier))),
          digitsPercentageSaturationStrategyEnabled: Boolean(data.digits_percentage_saturation_strategy_enabled),
          digitsPercentageSaturationThreshold: Math.max(10.01, Math.min(100, numberOr(data.digits_percentage_saturation_threshold, DEFAULT_SETTINGS.digitsPercentageSaturationThreshold))),
          digitsPercentageAbsenceStrategyEnabled: Boolean(data.digits_percentage_absence_strategy_enabled),
          digitsPercentageAbsenceStreak: Math.max(1, Math.min(10000, Math.round(numberOr(data.digits_percentage_absence_streak, DEFAULT_SETTINGS.digitsPercentageAbsenceStreak)))),
          digitsPercentageWindow: Math.max(20, Math.min(1000, Math.round(numberOr(data.digits_percentage_window, DEFAULT_SETTINGS.digitsPercentageWindow)))),
          digitsParityBlockDensityEnabled: Boolean(data.digits_parity_block_density_enabled),
          digitsParityBlockWindow: Math.max(2, Math.min(100, Math.round(numberOr(data.digits_parity_block_window, DEFAULT_SETTINGS.digitsParityBlockWindow)))),
          digitsParityBlockThreshold: Math.max(50, Math.min(100, numberOr(data.digits_parity_block_threshold, DEFAULT_SETTINGS.digitsParityBlockThreshold))),
          digitsParityAlternatingEnabled: Boolean(data.digits_parity_alternating_enabled),
          digitsParityAlternatingLength: Math.max(2, Math.min(20, Math.round(numberOr(data.digits_parity_alternating_length, DEFAULT_SETTINGS.digitsParityAlternatingLength)))),
          digitsParityAnchorEnabled: Boolean(data.digits_parity_anchor_enabled),
          digitsMatchTwinEnabled: Boolean(data.digits_match_twin_enabled),
          digitsMatchTwinRestTicks: Math.max(0, Math.min(20, Math.round(numberOr(data.digits_match_twin_rest_ticks, DEFAULT_SETTINGS.digitsMatchTwinRestTicks)))),
          digitsMatchMirrorEnabled: Boolean(data.digits_match_mirror_enabled),
          digitsMatchMirrorWindow: Math.max(4, Math.min(100, Math.round(numberOr(data.digits_match_mirror_window, DEFAULT_SETTINGS.digitsMatchMirrorWindow)))),
          digitsMatchMirrorDominance: Math.max(50, Math.min(100, numberOr(data.digits_match_mirror_dominance, DEFAULT_SETTINGS.digitsMatchMirrorDominance))),
          riseFallSymbol: typeof data.rise_fall_symbol === "string" && data.rise_fall_symbol ? data.rise_fall_symbol : DEFAULT_SETTINGS.riseFallSymbol,
          riseFallDurationTicks: Math.max(1, Math.min(100, numberOr(data.rise_fall_duration_ticks, DEFAULT_SETTINGS.riseFallDurationTicks))),
          riseFallChartType: data.rise_fall_chart_type === "line" ? "line" : "candles",
          riseFallContract: data.rise_fall_contract === "PUT" ? "PUT" : "CALL",
          riseFallSequenceEnabled: Boolean(data.rise_fall_sequence_enabled),
          riseFallSequenceLength: Math.max(1, Math.min(100, numberOr(data.rise_fall_sequence_length, DEFAULT_SETTINGS.riseFallSequenceLength))),
          riseFallBlockDensityEnabled: Boolean(data.rise_fall_block_density_enabled),
          riseFallBlockWindow: Math.max(2, Math.min(100, numberOr(data.rise_fall_block_window, DEFAULT_SETTINGS.riseFallBlockWindow))),
          riseFallBlockThreshold: Math.max(50, Math.min(100, numberOr(data.rise_fall_block_threshold, DEFAULT_SETTINGS.riseFallBlockThreshold))),
          riseFallAlternatingEnabled: Boolean(data.rise_fall_alternating_enabled),
          riseFallAlternatingLength: Math.max(2, Math.min(20, numberOr(data.rise_fall_alternating_length, DEFAULT_SETTINGS.riseFallAlternatingLength))),
          riseFallPercentChannelEnabled: Boolean(data.rise_fall_percent_channel_enabled),
          riseFallPercentChannelWindow: Math.max(5, Math.min(500, numberOr(data.rise_fall_percent_channel_window, DEFAULT_SETTINGS.riseFallPercentChannelWindow))),
          riseFallPercentChannelThreshold: Math.max(1, Math.min(99, numberOr(data.rise_fall_percent_channel_threshold, DEFAULT_SETTINGS.riseFallPercentChannelThreshold))),
          riseFallPercentChannelSequenceLength: Math.max(1, Math.min(100, numberOr(data.rise_fall_percent_channel_sequence_length, DEFAULT_SETTINGS.riseFallPercentChannelSequenceLength))),
          riseFallMomentumFilterEnabled: Boolean(data.rise_fall_momentum_filter_enabled),
          riseFallTrendProtectionEnabled: Boolean(data.rise_fall_trend_protection_enabled),
          riseFallSustainableInertiaEnabled: Boolean(data.rise_fall_sustainable_inertia_enabled),
          digitsContract: normalizeDigitsContract(data.digits_contract),
          digitsTargetDigit: Boolean(data.digits_follow_up)
            ? "follow_up"
            : Boolean(data.digits_random)
              ? "random"
              : normalizeDigit(data.digits_target_digit),
          useAdvancedMartingale: Boolean(data.use_advanced_martingale),
          advancedMartingaleContract: normalizeDigitsContract(data.advanced_martingale_contract),
          advancedMartingaleTargetDigit: normalizeDigit(data.advanced_martingale_target_digit),
          maxAdvancedMartingaleSteps: numberOr(data.max_advanced_martingale_steps, DEFAULT_SETTINGS.maxAdvancedMartingaleSteps),
        },
      });
      logger.system("Settings carregadas do Supabase");
    } catch {
      set({ isLoaded: true });
    }
  },

  updateSettings: (partial) => {
    const current = get().settings;
    const normalizedPartial: Partial<BotSettings> = { ...partial };

    // Select emits strings. Keep the persisted/runtime value typed as a
    // number for fixed Digits targets; only the two explicit modes remain
    // strings. This prevents "8" from falling through to Random in the
    // Digits engine.
    if (Object.prototype.hasOwnProperty.call(normalizedPartial, "digitsTargetDigit")) {
      const value = normalizedPartial.digitsTargetDigit;
      if (typeof value === "string" && value !== "random" && value !== "follow_up") {
        const digit = Number(value);
        normalizedPartial.digitsTargetDigit = Number.isInteger(digit) && digit >= 0 && digit <= 9 ? digit : current.digitsTargetDigit;
      }
    }

    const next = { ...current, ...normalizedPartial };
    set({ settings: next, isDirty: true });
    scheduleSave(next);
  },

  // Mantido apenas para compatibilidade com código externo que possa chamar
  // esta action. Não altera qualquer comportamento de Forex ou Digits V1.
  changeProfile: (profile) => {
    const next = { ...get().settings, strategyProfile: profile };
    set({ settings: next, isDirty: true });
    scheduleSave(next);
  },
}));
