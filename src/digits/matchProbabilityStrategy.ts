export interface MatchProbabilitySignal {
  name: "statistical-vacuum" | "twin-splitting" | "mirror-symmetry";
  targetDigit: number;
  reason: string;
}

/**
 * After an immediate duplicate X,X, rest exactly `restTicks` live ticks and
 * trigger Match X on the following (4th, with default rest=3) live tick.
 */
export function advanceTwinSplittingState(
  state: { targetDigit: number | null; remaining: number },
  restTicks: number,
): { state: { targetDigit: number | null; remaining: number }; signal: MatchProbabilitySignal | null } {
  const rest = Math.max(0, Math.round(restTicks));

  if (state.targetDigit !== null) {
    if (state.remaining > 0) {
      return { state: { ...state, remaining: state.remaining - 1 }, signal: null };
    }
    const target = state.targetDigit;
    return {
      state: { targetDigit: null, remaining: 0 },
      signal: {
        name: "twin-splitting",
        targetDigit: target,
        reason: `gémeo ${target}, descanso concluído (${rest} ticks) → Match ${target}`,
      },
    };
  }

  // The detector itself needs the previous digit. The caller supplies the
  // current live digit and stores it separately; this function is only the
  // countdown/trigger state machine.
  return { state, signal: null };
}

/**
 * Four logical quadrants from the requested model. For a dry quadrant, the
 * representative digit is its central member (Q2 uses the upper central
 * member because it contains only two digits).
 */
const QUADRANTS = [
  { name: "Q1 Par/Baixo", digits: [0, 2, 4], representative: 2 },
  { name: "Q2 Par/Alto", digits: [6, 8], representative: 8 },
  { name: "Q3 Ímpar/Baixo", digits: [1, 3], representative: 3 },
  { name: "Q4 Ímpar/Alto", digits: [5, 7, 9], representative: 7 },
] as const;

export function findMirrorSymmetrySignal(
  digits: number[],
  windowSize: number,
  dominanceThreshold: number,
): MatchProbabilitySignal | null {
  const size = Math.max(4, Math.round(windowSize));
  const sample = digits.slice(-size);
  if (sample.length < size) return null;

  const counts = QUADRANTS.map((quadrant) => ({
    ...quadrant,
    count: sample.filter((digit) => quadrant.digits.includes(digit as never)).length,
  }));
  const dry = counts.find((quadrant) => quadrant.count === 0);
  if (!dry) return null;

  const dominance = Math.max(50, Math.min(100, dominanceThreshold));
  const nonDryCount = sample.length - dry.count;
  const nonDryPercent = (nonDryCount / sample.length) * 100;
  if (nonDryPercent < dominance) return null;

  // A dry quadrant alone is not treated as proof of compensation. We also
  // require the observed sample to be concentrated in at least two other
  // quadrants, which matches the "massive saturation in 3 quadrants" idea
  // while avoiding a single-quadrant artefact.
  const occupied = counts.filter((quadrant) => quadrant.count > 0).sort((a, b) => b.count - a.count);
  if (occupied.length < 2) return null;
  const topTwoPercent = ((occupied[0].count + occupied[1].count) / sample.length) * 100;
  if (topTwoPercent < dominance) return null;

  return {
    name: "mirror-symmetry",
    targetDigit: dry.representative,
    reason: `${dry.name} seco em ${size} ticks | top-2 quadrantes ${topTwoPercent.toFixed(1)}% ≥ ${dominance.toFixed(1)}% → Match ${dry.representative}`,
  };
}
