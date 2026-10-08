export type DigitsParity = "even" | "odd";
export type DigitsSequenceMode = "fixed" | "multiple";
export type DigitsParityContract = "DIGITEVEN" | "DIGITODD";

export interface DigitsSequenceStrategyConfig {
  enabled: boolean;
  mode: DigitsSequenceMode;
  sequenceLength: number;
  entryContract: DigitsParityContract;
}

export interface DigitsSequenceState {
  parity: DigitsParity | null;
  count: number;
}

export interface DigitsOverUnderSequenceConfig {
  enabled: boolean;
  sequenceLength: number;
  overBarrier: number;
  underBarrier: number;
}

export type DigitsOverUnderGroup = "low" | "high" | "neutral";
export type DigitsOverUnderContract = "DIGITOVER" | "DIGITUNDER";

export interface DigitsOverUnderSequenceState {
  group: Exclude<DigitsOverUnderGroup, "neutral"> | null;
  count: number;
}

export const DEFAULT_DIGITS_SEQUENCE_STRATEGY: DigitsSequenceStrategyConfig = {
  enabled: false, mode: "fixed", sequenceLength: 6, entryContract: "DIGITEVEN",
};

export const DEFAULT_DIGITS_OVER_UNDER_SEQUENCE: DigitsOverUnderSequenceConfig = {
  enabled: false, sequenceLength: 5, overBarrier: 4, underBarrier: 5,
};

export const INITIAL_DIGITS_SEQUENCE_STATE: DigitsSequenceState = { parity: null, count: 0 };
export const INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE: DigitsOverUnderSequenceState = { group: null, count: 0 };

export function digitParity(digit: number): DigitsParity | null {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return null;
  return digit % 2 === 0 ? "even" : "odd";
}

export function classifyOverUnderDigit(digit: number, overBarrier: number, underBarrier: number): DigitsOverUnderGroup {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return "neutral";
  const low = Math.max(0, Math.min(9, Math.floor(Number(overBarrier))));
  const high = Math.max(0, Math.min(9, Math.floor(Number(underBarrier))));
  if (digit <= low) return "low";
  if (digit >= high) return "high";
  return "neutral";
}

/** Emits the trigger on the exact tick that completes the configured run.
 * Low digits (<= overBarrier) trigger Over overBarrier.
 * High digits (>= underBarrier) trigger Under underBarrier.
 * Neutral digits break the run.
 */
export function consumeOverUnderSequence(
  state: DigitsOverUnderSequenceState,
  digit: number,
  config: Pick<DigitsOverUnderSequenceConfig, "sequenceLength" | "overBarrier" | "underBarrier">,
): { state: DigitsOverUnderSequenceState; triggerContract: DigitsOverUnderContract | null; triggerTargetDigit: number | null } {
  const group = classifyOverUnderDigit(digit, config.overBarrier, config.underBarrier);
  const length = Math.max(1, Math.floor(Number(config.sequenceLength) || 1));
  if (group === "neutral") return { state: INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE, triggerContract: null, triggerTargetDigit: null };

  const nextCount = state.group === group ? state.count + 1 : 1;
  const nextState: DigitsOverUnderSequenceState = { group, count: nextCount };
  if (nextCount !== length) return { state: nextState, triggerContract: null, triggerTargetDigit: null };

  const triggerContract: DigitsOverUnderContract = group === "high" ? "DIGITUNDER" : "DIGITOVER";
  const triggerTargetDigit = group === "high" ? Math.max(0, Math.min(9, Math.floor(Number(config.underBarrier)))) : Math.max(0, Math.min(9, Math.floor(Number(config.overBarrier))));
  return { state: INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE, triggerContract, triggerTargetDigit };
}

export function consumeDigitsSequence(
  state: DigitsSequenceState,
  digit: number,
  config: Pick<DigitsSequenceStrategyConfig, "mode" | "sequenceLength" | "entryContract">,
): { state: DigitsSequenceState; triggerContract: DigitsParityContract | null } {
  const parity = digitParity(digit);
  const length = Math.max(1, Math.floor(Number(config.sequenceLength) || 1));
  if (!parity) return { state, triggerContract: null };
  const nextCount = state.parity === parity ? state.count + 1 : 1;
  const nextState = { parity, count: nextCount };
  if (nextCount !== length) return { state: nextState, triggerContract: null };
  if (config.mode === "fixed") {
    const sequenceParityContract: DigitsParityContract = parity === "even" ? "DIGITEVEN" : "DIGITODD";
    if (sequenceParityContract === config.entryContract) return { state: nextState, triggerContract: null };
  }
  const triggerContract: DigitsParityContract = config.mode === "multiple" ? parity === "even" ? "DIGITODD" : "DIGITEVEN" : config.entryContract;
  return { state: INITIAL_DIGITS_SEQUENCE_STATE, triggerContract };
}
