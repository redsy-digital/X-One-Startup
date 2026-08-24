import type { ForexReasonCode, ForexRiskDecision } from "../decision-engine/types";
import {
  DEFAULT_FOREX_RISK_CONFIG,
  type ForexRiskConfig,
  type ForexRiskEvaluationInput,
  type ForexRiskState,
} from "./types";

const fail = (
  reasonCode: ForexReasonCode,
  reason: string,
  stake: number,
  riskFraction: number,
  now: number,
): ForexRiskDecision => ({
  allowed: false,
  stake,
  reasonCode,
  reason,
  riskFraction,
  checkedAt: now,
});

/**
 * Pure Forex V1 risk gate.
 *
 * It does NOT calculate a signal, change the stake after a loss, or execute
 * a trade. Rise/Fall stake is treated as the maximum contractual loss.
 */
export class ForexRiskEngineV1 {
  constructor(private readonly config: ForexRiskConfig = DEFAULT_FOREX_RISK_CONFIG) {}

  evaluate(input: ForexRiskEvaluationInput): ForexRiskDecision {
    const { now, stake, accountBalance, calendar, state } = input;

    if (!Number.isFinite(accountBalance) || accountBalance <= 0) {
      return fail("RISK_LIMIT", "Saldo da conta inválido ou indisponível.", stake, Infinity, now);
    }

    if (!Number.isFinite(stake) || stake <= 0) {
      return fail("RISK_LIMIT", "Stake inválida.", stake, Infinity, now);
    }

    const riskFraction = stake / accountBalance;

    // Calendar is a hard gate. Risk never overrides a macro block.
    if (calendar.state === "BLOCK" || calendar.state === "COOLDOWN") {
      return fail(
        calendar.reasonCode ?? "NEWS_BLOCK_HIGH_IMPACT",
        "Entrada bloqueada pelo calendário económico.",
        stake,
        riskFraction,
        now,
      );
    }

    if (calendar.state === "UNKNOWN") {
      return fail("ENGINE_NOT_READY", "Estado do calendário económico desconhecido.", stake, riskFraction, now);
    }

    if (stake > this.config.maxStakePerTrade) {
      return fail("RISK_LIMIT", "Stake acima do limite Forex V1 por operação.", stake, riskFraction, now);
    }

    if (riskFraction > this.config.maxAccountRiskFraction) {
      return fail("RISK_LIMIT", "Stake excede a fracção máxima de risco da conta.", stake, riskFraction, now);
    }

    if (state.openPositions >= this.config.maxOpenPositions) {
      return fail("RISK_LIMIT", "Limite de posições Forex simultâneas atingido.", stake, riskFraction, now);
    }

    if (state.tradesThisSession >= this.config.maxTradesPerSession) {
      return fail("RISK_LIMIT", "Limite de operações da sessão atingido.", stake, riskFraction, now);
    }

    if (state.sessionPnl <= -Math.abs(this.config.maxSessionLoss)) {
      return fail("RISK_LIMIT", "Stop de perda da sessão atingido.", stake, riskFraction, now);
    }

    if (state.dailyPnl <= -Math.abs(this.config.maxDailyLoss)) {
      return fail("RISK_LIMIT", "Stop de perda diário atingido.", stake, riskFraction, now);
    }

    if (state.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      return fail("RISK_LIMIT", "Limite de perdas consecutivas atingido.", stake, riskFraction, now);
    }

    if (state.cooldownUntil !== undefined && now < state.cooldownUntil) {
      return fail("COOLDOWN_ACTIVE", "Cooldown de risco ainda activo.", stake, riskFraction, now);
    }

    if (state.lastEntryAt !== undefined) {
      const elapsed = (now - state.lastEntryAt) / 1000;
      if (elapsed < this.config.minEntryIntervalSeconds) {
        return fail("COOLDOWN_ACTIVE", "Intervalo mínimo entre entradas ainda não cumprido.", stake, riskFraction, now);
      }
    }

    return {
      allowed: true,
      stake,
      reasonCode: "READY_FOR_EXECUTION",
      reason: "Risco aprovado para uma operação Rise/Fall Forex.",
      riskFraction,
      checkedAt: now,
    };
  }

  static nextStateAfterLoss(state: ForexRiskState, now: number, config: ForexRiskConfig = DEFAULT_FOREX_RISK_CONFIG): ForexRiskState {
    return {
      ...state,
      consecutiveLosses: state.consecutiveLosses + 1,
      cooldownUntil: now + config.cooldownAfterLossSeconds * 1000,
    };
  }

  static nextStateAfterWin(state: ForexRiskState): ForexRiskState {
    return { ...state, consecutiveLosses: 0 };
  }
}
