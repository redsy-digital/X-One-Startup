export const SYMBOLS = [
  { value: "R_10", label: "Volatility 10 Index" },
  { value: "R_25", label: "Volatility 25 Index" },
  { value: "R_50", label: "Volatility 50 Index" },
  { value: "R_75", label: "Volatility 75 Index" },
  { value: "R_100", label: "Volatility 100 Index" },
  { value: "1HZ10V", label: "Volatility 10 (1s) Index" },
  { value: "1HZ100V", label: "Volatility 100 (1s) Index" },
];


/**
 * Crash/Boom instruments currently offered by Deriv and intended for the
 * Accumulators selector. Keep these separate from the global SYMBOLS list so
 * Digits does not inherit Accumulator-only assets accidentally.
 */
export const ACCUMULATOR_CRASH_BOOM_SYMBOLS = [
  { value: "BOOM50", label: "Boom 50 Index" },
  { value: "BOOM100", label: "Boom 100 Index" },
  { value: "BOOM150", label: "Boom 150 Index" },
  { value: "BOOM200", label: "Boom 200 Index" },
  { value: "BOOM300", label: "Boom 300 Index" },
  { value: "BOOM500", label: "Boom 500 Index" },
  { value: "BOOM600", label: "Boom 600 Index" },
  { value: "BOOM900", label: "Boom 900 Index" },
  { value: "BOOM99", label: "Boom 99 Index" },
  { value: "BOOM1000", label: "Boom 1000 Index" },
  { value: "CRASH50", label: "Crash 50 Index" },
  { value: "CRASH100", label: "Crash 100 Index" },
  { value: "CRASH150", label: "Crash 150 Index" },
  { value: "CRASH200", label: "Crash 200 Index" },
  { value: "CRASH300", label: "Crash 300 Index" },
  { value: "CRASH500", label: "Crash 500 Index" },
  { value: "CRASH600", label: "Crash 600 Index" },
  { value: "CRASH900", label: "Crash 900 Index" },
  { value: "CRASH99", label: "Crash 99 Index" },
  { value: "CRASH1000", label: "Crash 1000 Index" },
] as const;

/** All assets selectable by Accumulators V1. */
export const ACCUMULATOR_SYMBOLS = [
  ...SYMBOLS,
  ...ACCUMULATOR_CRASH_BOOM_SYMBOLS,
];
