import type { AccumulatorsRiskConfig } from "./types";

export interface AccumulatorsRiskState {
  currentStake: number;
  martingaleStep: number;
  consecutiveLosses: number;
  cooldownUntil: number | null;
}

export function createAccumulatorsRiskState(config: AccumulatorsRiskConfig): AccumulatorsRiskState {
  return {
    currentStake: config.stake,
    martingaleStep: 0,
    consecutiveLosses: 0,
    cooldownUntil: null,
  };
}

export function resetAccumulatorsRisk(config: AccumulatorsRiskConfig): AccumulatorsRiskState {
  return createAccumulatorsRiskState(config);
}

export function resolveAccumulatorsWin(
  _state: AccumulatorsRiskState,
  config: AccumulatorsRiskConfig,
): AccumulatorsRiskState {
  return {
    currentStake: config.stake,
    martingaleStep: 0,
    consecutiveLosses: 0,
    cooldownUntil: null,
  };
}

export function resolveAccumulatorsLoss(
  state: AccumulatorsRiskState,
  config: AccumulatorsRiskConfig,
  now: number,
): AccumulatorsRiskState {
  const consecutiveLosses = state.consecutiveLosses + 1;
  const reachedLossLimit = config.maxConsecutiveLosses > 0 && consecutiveLosses >= config.maxConsecutiveLosses;

  const nextStep = config.useMartingale && state.martingaleStep < config.maxMartingaleSteps
    ? state.martingaleStep + 1
    : 0;

  const nextStake = nextStep > 0
    ? roundMoney(config.stake * Math.pow(config.martingaleMultiplier, nextStep))
    : config.stake;

  return {
    currentStake: nextStake,
    martingaleStep: nextStep,
    consecutiveLosses,
    cooldownUntil: reachedLossLimit && config.cooldownAfterLoss > 0
      ? now + config.cooldownAfterLoss * 1000
      : null,
  };
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
