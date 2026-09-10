import type { DigitsRiskConfig } from "./types";

export interface DigitsRiskState {
  currentStake: number;
  martingaleStep: number;
  consecutiveLosses: number;
  cooldownUntil: number | null;
  advancedMartingaleStep: number;
  advancedMartingaleExhausted: boolean;
}

export function createDigitsRiskState(config: DigitsRiskConfig): DigitsRiskState {
  return {
    currentStake: config.stake,
    martingaleStep: 0,
    consecutiveLosses: 0,
    cooldownUntil: null,
    advancedMartingaleStep: 0,
    advancedMartingaleExhausted: false,
  };
}

export function resetDigitsRisk(config: DigitsRiskConfig): DigitsRiskState {
  return createDigitsRiskState(config);
}

export function resolveDigitsWin(
  state: DigitsRiskState,
  config: DigitsRiskConfig,
  profit: number,
): DigitsRiskState {
  void profit;
  return {
    currentStake: config.stake,
    martingaleStep: 0,
    consecutiveLosses: 0,
    cooldownUntil: null,
    advancedMartingaleStep: 0,
    advancedMartingaleExhausted: false,
  };
}

export function resolveDigitsLoss(
  state: DigitsRiskState,
  config: DigitsRiskConfig,
  now: number,
  usedAdvancedMartingale = false,
): DigitsRiskState {
  const consecutiveLosses = state.consecutiveLosses + 1;
  const reachedLossLimit = config.maxConsecutiveLosses > 0 && consecutiveLosses >= config.maxConsecutiveLosses;

  const nextStep = config.useMartingale && state.martingaleStep < config.maxMartingaleSteps
    ? state.martingaleStep + 1
    : 0;

  // The risk manager tracks the ADVANCED trade count explicitly. The loss
  // that starts an advanced sequence schedules advanced trade #1; a loss on
  // advanced trade #N exhausts the advanced sequence so the following trade
  // returns to the user's normal contract/digit. This also correctly handles
  // maxAdvancedMartingaleSteps = 1.
  let nextAdvancedStep = state.advancedMartingaleStep;
  let advancedMartingaleExhausted = state.advancedMartingaleExhausted;

  if (config.useMartingale && config.useAdvancedMartingale && config.maxAdvancedMartingaleSteps > 0) {
    if (usedAdvancedMartingale) {
      if (state.advancedMartingaleStep < config.maxAdvancedMartingaleSteps) {
        nextAdvancedStep = state.advancedMartingaleStep + 1;
        advancedMartingaleExhausted = false;
      } else {
        nextAdvancedStep = 0;
        advancedMartingaleExhausted = true;
      }
    } else if (!state.advancedMartingaleExhausted) {
      nextAdvancedStep = 1;
      advancedMartingaleExhausted = false;
    } else {
      nextAdvancedStep = 0;
      advancedMartingaleExhausted = true;
    }
  } else {
    nextAdvancedStep = 0;
    advancedMartingaleExhausted = false;
  }

  // The next stake is still controlled exclusively by the normal Martingale
  // progression. Advanced Martingale changes the contract/digit, not the
  // bankroll formula.
  const nextStake = nextStep > 0
    ? roundMoney(config.stake * Math.pow(config.martingaleMultiplier, nextStep))
    : config.stake;

  return {
    currentStake: nextStake,
    martingaleStep: nextStep,
    advancedMartingaleStep: nextAdvancedStep,
    advancedMartingaleExhausted,
    consecutiveLosses,
    cooldownUntil: reachedLossLimit && config.cooldownAfterLoss > 0
      ? now + config.cooldownAfterLoss * 1000
      : null,
  };
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
