import type { Candle } from '../../types';

export type ForexSwingType = 'HIGH' | 'LOW';
export type ForexMarketStructureDirection = 'BULLISH' | 'BEARISH' | 'RANGE' | 'TRANSITION' | 'UNKNOWN';
export type ForexStructureEvent = 'NONE' | 'BOS_BULLISH' | 'BOS_BEARISH' | 'CHOCH_BULLISH' | 'CHOCH_BEARISH';
export type ForexSwingLabel = 'HH' | 'HL' | 'LH' | 'LL';

export interface ForexSwingPoint {
  index: number;
  time: number;
  price: number;
  type: ForexSwingType;
  label: ForexSwingLabel | null;
}

export interface ForexStructureZone {
  price: number;
  lower: number;
  upper: number;
  touches: number;
  lastTouchIndex: number;
  kind: 'SUPPORT' | 'RESISTANCE' | 'NEUTRAL';
}

export interface ForexStructureConfig {
  pivotRadius: number;
  lookback: number;
  levelToleranceAtr: number;
  minimumLevelTouches: number;
}

export interface ForexStructureSnapshot {
  version: 'forex-structure-v1.0.0';
  direction: ForexMarketStructureDirection;
  event: ForexStructureEvent;
  eventIndex: number | null;
  swings: ForexSwingPoint[];
  recentSwingHigh: ForexSwingPoint | null;
  recentSwingLow: ForexSwingPoint | null;
  support: ForexStructureZone | null;
  resistance: ForexStructureZone | null;
  distanceToSupport: number | null;
  distanceToResistance: number | null;
  confidence: number;
  calculatedAt: number;
  sourceTimeframeMinutes: number;
}

export interface ForexStructureInput {
  candles: Candle[];
  timeframeMinutes: number;
  atr?: number;
  calculatedAt?: number;
}
