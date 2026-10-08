export type Parity = "even" | "odd";

export interface ParityProbabilitySignal {
  name: "block-density" | "alternating" | "anchor";
  entryContract: "DIGITEVEN" | "DIGITODD";
  reason: string;
}

const parityOf = (digit: number): Parity => digit % 2 === 0 ? "even" : "odd";

/**
 * Short-window observed-density heuristic. It intentionally describes an
 * imbalance in the sample; it does not assume that an independent RNG must
 * compensate on the next tick.
 */
export function findBlockDensitySignal(
  digits: number[],
  windowSize: number,
  thresholdPercent: number,
): ParityProbabilitySignal | null {
  const size = Math.max(2, Math.round(windowSize));
  const sample = digits.slice(-size);
  if (sample.length < size) return null;
  const even = sample.filter((d) => parityOf(d) === "even").length;
  const odd = sample.length - even;
  const threshold = Math.max(50, Math.min(100, thresholdPercent));
  const evenPct = (even / sample.length) * 100;
  const oddPct = (odd / sample.length) * 100;
  if (evenPct >= threshold && odd < even) {
    return { name: "block-density", entryContract: "DIGITODD", reason: `densidade Par ${evenPct.toFixed(1)}% (${even}/${sample.length}) ≥ ${threshold.toFixed(1)}%` };
  }
  if (oddPct >= threshold && even < odd) {
    return { name: "block-density", entryContract: "DIGITEVEN", reason: `densidade Ímpar ${oddPct.toFixed(1)}% (${odd}/${sample.length}) ≥ ${threshold.toFixed(1)}%` };
  }
  return null;
}

/** Strict P-I-P-I alternation detector. */
export function findAlternatingSignal(digits: number[], length: number): ParityProbabilitySignal | null {
  const size = Math.max(2, Math.round(length));
  const sample = digits.slice(-size);
  if (sample.length < size) return null;
  for (let i = 1; i < sample.length; i += 1) {
    if (parityOf(sample[i]) === parityOf(sample[i - 1])) return null;
  }
  const last = parityOf(sample[sample.length - 1]);
  return {
    name: "alternating",
    entryContract: last === "even" ? "DIGITEVEN" : "DIGITODD",
    reason: `alternância estrita de ${size} ticks terminou em ${last === "even" ? "Par" : "Ímpar"}`,
  };
}

/**
 * Anchor detector: after 0 or 9, inspect exactly the two preceding ticks.
 * The two preceding parities must match the anchor parity; mixed history is
 * ignored. The resulting entry is the opposite parity.
 */
export function findAnchorSignal(digits: number[]): ParityProbabilitySignal | null {
  if (digits.length < 3) return null;
  const anchor = digits[digits.length - 1];
  if (anchor !== 0 && anchor !== 9) return null;
  const anchorParity = parityOf(anchor);
  const p1 = parityOf(digits[digits.length - 2]);
  const p2 = parityOf(digits[digits.length - 3]);
  if (p1 !== anchorParity || p2 !== anchorParity) return null;
  return {
    name: "anchor",
    entryContract: anchorParity === "even" ? "DIGITODD" : "DIGITEVEN",
    reason: `âncora ${anchor} após 2 ticks ${anchorParity === "even" ? "pares" : "ímpares"} → entrada ${anchorParity === "even" ? "Ímpar" : "Par"}`,
  };
}
