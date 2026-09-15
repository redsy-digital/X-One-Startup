export interface AccumulatorRiskState {
  currentStake: number;
  martingaleStep: number;
  consecutiveLosses: number;
  cooldownUntil: number | null;
}

export interface AccumulatorRiskConfig {
  stake: number;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  maxConsecutiveLosses: number;
  cooldownAfterLoss: number;
}

export function createAccumulatorRisk(config: AccumulatorRiskConfig): AccumulatorRiskState {
  return { currentStake: config.stake, martingaleStep: 0, consecutiveLosses: 0, cooldownUntil: null };
}

export function resolveAccumulatorWin(config: AccumulatorRiskConfig): AccumulatorRiskState {
  return createAccumulatorRisk(config);
}

export function resolveAccumulatorLoss(
  state: AccumulatorRiskState,
  config: AccumulatorRiskConfig,
  now: number,
): AccumulatorRiskState {
  const consecutiveLosses = state.consecutiveLosses + 1;
  const step = config.useMartingale && state.martingaleStep < config.maxMartingaleSteps
    ? state.martingaleStep + 1
    : 0;
  const currentStake = step > 0
    ? roundMoney(config.stake * Math.pow(config.martingaleMultiplier, step))
    : config.stake;

  return {
    currentStake,
    martingaleStep: step,
    consecutiveLosses,
    cooldownUntil:
      config.maxConsecutiveLosses > 0 && consecutiveLosses >= config.maxConsecutiveLosses && config.cooldownAfterLoss > 0
        ? now + config.cooldownAfterLoss * 1000
        : null,
  };
}

export function roundMoney(value: number) { return Math.round(value * 100) / 100; }
