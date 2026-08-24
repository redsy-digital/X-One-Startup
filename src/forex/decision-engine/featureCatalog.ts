import type { ForexFeatureSnapshot } from './types';

/** Frozen research catalog from the Forex V1 investigation. Values are diagnostics,
 * not production weights. No feature is promoted automatically by this registry. */
export const FOREX_FEATURE_CATALOG = [
  'emaSpread',
  'rsiCentered',
  'macdHistogram',
  'adxDirection',
  'atrPct',
  'bollingerPosition',
  'bollingerWidthPct',
  'roc',
  'bodyPct',
  'rangePct',
  'closeLocation',
  'volatility20',
] as const;

export type ForexFeatureKey = typeof FOREX_FEATURE_CATALOG[number];

export const FOREX_FEATURE_VERSION = 'forex-features-v1.0.0' as const;

export interface ForexFeatureValidation {
  valid: boolean;
  reasons: string[];
  featureVersion: typeof FOREX_FEATURE_VERSION;
  featureId: string;
}

export function validateForexFeatureSnapshot(snapshot: ForexFeatureSnapshot): ForexFeatureValidation {
  const reasons: string[] = [];
  for (const key of FOREX_FEATURE_CATALOG) {
    const value = snapshot.values[key];
    if (!Number.isFinite(value)) reasons.push(`INVALID_VALUE:${key}`);
  }
  if (snapshot.version !== FOREX_FEATURE_VERSION) reasons.push('VERSION_MISMATCH');
  if (!Number.isFinite(snapshot.calculatedAt) || snapshot.calculatedAt <= 0) reasons.push('INVALID_TIMESTAMP');
  if (!Number.isFinite(snapshot.sourceTimeframeMinutes) || snapshot.sourceTimeframeMinutes <= 0) reasons.push('INVALID_TIMEFRAME');
  return {
    valid: reasons.length === 0,
    reasons,
    featureVersion: FOREX_FEATURE_VERSION,
    featureId: snapshot.featureId,
  };
}
