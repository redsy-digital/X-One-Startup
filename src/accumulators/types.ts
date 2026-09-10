// Accumulators V1 — entrada fixa, sem indicadores nem previsão avançada.
// Espelha a filosofia de src/digits/types.ts: apenas um contrato (ACCU),
// o utilizador escolhe o ativo (símbolo vem do useMarketStore, partilhado
// com Digits), a percentagem de Growth Rate e o número de ticks até o
// próprio bot fechar o contrato (a Deriv não aceita "duration" para ACCU —
// o fecho por contagem de ticks é feito pela aplicação via sell()).

export const ACCUMULATORS_GROWTH_RATES = [0.01, 0.02, 0.03, 0.04, 0.05] as const;
export type AccumulatorsGrowthRate = typeof ACCUMULATORS_GROWTH_RATES[number];

export function isAccumulatorsGrowthRate(value: unknown): value is AccumulatorsGrowthRate {
  return typeof value === "number" && (ACCUMULATORS_GROWTH_RATES as readonly number[]).includes(value);
}

export function growthRateLabel(rate: AccumulatorsGrowthRate): string {
  return `${Math.round(rate * 100)}%`;
}

export interface AccumulatorsConfig {
  /** Growth rate por tick, um de 1%–5% (0.01–0.05). */
  growthRate: AccumulatorsGrowthRate;
  /** Número de ticks decorridos após os quais o bot fecha o contrato (sell). */
  tickCount: number;
}

export interface AccumulatorsRiskConfig {
  stake: number;
  targetProfit: number;
  stopLoss: number;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  maxConsecutiveLosses: number;
  cooldownAfterLoss: number;
}

export type AccumulatorsTradeResult = "WON" | "LOST";

export interface AccumulatorsRuntimeState {
  currentStake: number;
  martingaleStep: number;
  consecutiveLosses: number;
  /** Stake efetivamente usada no contrato atual em aberto (ou null se nenhum). */
  currentStakeInTrade: number | null;
  /** ID do contrato ACCU atualmente em aberto. */
  activeContractId: string | null;
  /** Ticks decorridos desde a compra do contrato atual. */
  ticksElapsed: number;
  /** Valor atual do contrato (payout corrente), reportado pela Deriv a cada tick. */
  currentContractValue: number | null;
  /** Se o contrato ativo foi comprado manualmente (fora do loop do bot). */
  isManualTrade: boolean;
  lastStake: number | null;
  lastResult: AccumulatorsTradeResult | null;
  lastTradeAt: number | null;
  lastProfit: number | null;
  lastTicks: number | null;
  isProcessing: boolean;
  entries: number;
  error: string | null;
}
