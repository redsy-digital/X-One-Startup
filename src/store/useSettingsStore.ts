import { create } from "zustand";
import { supabase } from "../lib/supabase";
import type { StrategyProfile } from "../types";
import type { DigitsContractType, DigitsTargetMode } from "../digits/types";
import { isAccumulatorsGrowthRate, type AccumulatorsGrowthRate } from "../accumulators/types";
import { logger } from "../lib/logger";

export interface BotSettings {
  // Gestão de banca partilhada pela operação de Índices Sintéticos — usada
  // tanto por Digits como por Accumulators (só uma aba opera de cada vez,
  // por isso partilham o mesmo perfil de risco em vez de terem cada uma o
  // seu próprio, o que evitaria duplicar colunas na tabela bot_settings).
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
  strategyProfile: StrategyProfile;
  useSoros: boolean;
  maxSorosLevels: number;

  // Digits V1 — entrada fixa, sem indicadores/previsão.
  digitsContract: DigitsContractType;
  digitsTargetDigit: DigitsTargetMode;

  // Martingale Avançado — após LOSS pode mudar temporariamente o contrato/alvo.
  useAdvancedMartingale: boolean;
  advancedMartingaleContract: DigitsContractType;
  advancedMartingaleTargetDigit: number;
  maxAdvancedMartingaleSteps: number;

  // Accumulators V1 — sem tabela própria no Supabase. Reaproveita duas
  // colunas de bot_settings que já existem no schema mas que nenhum motor
  // actual lê/escreve: min_confidence (int 0-100, pertencia à antiga
  // estratégia por score) guarda o Growth Rate como inteiro 1-5 (1%-5%);
  // contract_duration_ticks (int 1-20, nunca usado por Digits, que tem
  // duration fixa em 1 tick) guarda o número de ticks até o bot fechar o
  // contrato Accumulators.
  accumulatorsGrowthRate: AccumulatorsGrowthRate;
  accumulatorsTickCount: number;
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
  strategyProfile: "balanced",
  useSoros: false,
  maxSorosLevels: 0,

  digitsContract: "DIGITUNDER",
  digitsTargetDigit: 9,

  useAdvancedMartingale: false,
  advancedMartingaleContract: "DIGITOVER",
  advancedMartingaleTargetDigit: 2,
  maxAdvancedMartingaleSteps: 2,

  accumulatorsGrowthRate: 0.01,
  accumulatorsTickCount: 5,
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
      digits_contract: settings.digitsContract,
      // Random is persisted separately because the database target_digit column is numeric.
      digits_target_digit: typeof settings.digitsTargetDigit === "number" ? settings.digitsTargetDigit : 9,
      digits_random: settings.digitsTargetDigit === "random",
      digits_follow_up: settings.digitsTargetDigit === "follow_up",
      use_advanced_martingale: settings.useAdvancedMartingale,
      advanced_martingale_contract: settings.advancedMartingaleContract,
      advanced_martingale_target_digit: settings.advancedMartingaleTargetDigit,
      max_advanced_martingale_steps: settings.maxAdvancedMartingaleSteps,
      // Accumulators V1 — colunas reaproveitadas, ver comentário na interface.
      min_confidence: Math.round(settings.accumulatorsGrowthRate * 100),
      contract_duration_ticks: settings.accumulatorsTickCount,
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

/** min_confidence guarda o Growth Rate como inteiro 1-5 (1%-5%). Qualquer
 * valor fora desse conjunto (incluindo o 0 antigo, de quando a coluna ainda
 * não tinha uso) cai no default de 1%. */
function normalizeGrowthRate(value: unknown): AccumulatorsGrowthRate {
  const rate = Number(value) / 100;
  return isAccumulatorsGrowthRate(rate) ? rate : DEFAULT_SETTINGS.accumulatorsGrowthRate;
}

/** contract_duration_ticks tem CHECK (1-20) na base de dados. */
function normalizeTickCount(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : DEFAULT_SETTINGS.accumulatorsTickCount;
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
          strategyProfile: (data.strategy_profile as StrategyProfile) ?? "balanced",
          useMartingale: Boolean(data.use_martingale),
          martingaleMultiplier: numberOr(data.martingale_multiplier, DEFAULT_SETTINGS.martingaleMultiplier),
          maxMartingaleSteps: numberOr(data.max_martingale_steps, DEFAULT_SETTINGS.maxMartingaleSteps),
          useSoros: Boolean(data.use_soros),
          maxSorosLevels: numberOr(data.max_soros_levels, 0),
          maxConsecutiveLosses: numberOr(data.max_consecutive_losses, DEFAULT_SETTINGS.maxConsecutiveLosses),
          cooldownAfterLoss: numberOr(data.cooldown_after_loss, DEFAULT_SETTINGS.cooldownAfterLoss),
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
          accumulatorsGrowthRate: normalizeGrowthRate(data.min_confidence),
          accumulatorsTickCount: normalizeTickCount(data.contract_duration_ticks),
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
