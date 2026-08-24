import type { ForexFeatureSnapshot, ForexRegime } from '../decision-engine/types';
import type { ForexStructureSnapshot } from '../structure';
import type { ForexSessionSnapshot } from '../session';

export interface ForexRegimeConfig {
  adxTrendingThreshold: number;
  adxRangingThreshold: number;
  squeezeWidthThreshold: number;
  breakoutWidthExpansionRatio: number;
  transitionConfidenceFloor: number;
}

export interface ForexRegimeSnapshot {
  version: 'forex-regime-v1.0.0';
  regime: ForexRegime;
  confidence: number;
  adx: number | null;
  bollingerWidthPct: number | null;
  structureDirection: ForexStructureSnapshot['direction'] | null;
  structureEvent: ForexStructureSnapshot['event'] | null;
  session: ForexSessionSnapshot['session'];
  reason: string;
  calculatedAt: number;
}

export interface ForexRegimeInput {
  features: ForexFeatureSnapshot;
  structure?: ForexStructureSnapshot;
  session: ForexSessionSnapshot;
  previousFeatures?: ForexFeatureSnapshot;
  calculatedAt?: number;
}
