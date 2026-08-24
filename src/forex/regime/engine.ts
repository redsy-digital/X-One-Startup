import type { ForexRegimeEngine } from '../decision-engine/ports';
import type { ForexMarketContext, ForexRegimeResult } from '../decision-engine/types';
import type { ForexFeatureSnapshot } from '../decision-engine/types';
import type { ForexStructureSnapshot } from '../structure';
import type { ForexSessionSnapshot } from '../session';
import { calculateADX } from '../../lib/indicators';
import type { ForexRegimeConfig, ForexRegimeInput, ForexRegimeSnapshot } from './types';

const DEFAULT_CONFIG: ForexRegimeConfig = {
  adxTrendingThreshold: 25,
  adxRangingThreshold: 18,
  squeezeWidthThreshold: 0.004,
  breakoutWidthExpansionRatio: 1.25,
  transitionConfidenceFloor: 0.55,
};

/**
 * D5 regime classifier. It classifies market state; it does not emit CALL/PUT.
 * Thresholds are conservative engineering defaults, not statistically promoted
 * trading weights. They must remain auditable and can only be promoted after OOS validation.
 */
export class ForexRegimeEngineV1 implements ForexRegimeEngine {
  constructor(private readonly config: ForexRegimeConfig = DEFAULT_CONFIG) {}

  classify(
    features: ForexFeatureSnapshot,
    market: ForexMarketContext,
    structure?: ForexStructureSnapshot,
    session: ForexSessionSnapshot = getSessionFromMarket(market),
    previousFeatures?: ForexFeatureSnapshot,
  ): ForexRegimeResult & { snapshot: ForexRegimeSnapshot } {
    const v = features.values;
    const adxResult = market.candles.length >= 28 ? calculateADX(market.candles, 14) : null;
    const adx = adxResult && Number.isFinite(adxResult.adx) ? adxResult.adx : finiteOrNull(v.adx);
    const width = finiteOrNull(v.bollingerWidthPct);
    const previousWidth = previousFeatures ? finiteOrNull(previousFeatures.values.bollingerWidthPct) : null;
    const widthExpansion = width !== null && previousWidth !== null && previousWidth > 0
      ? width / previousWidth
      : null;

    const directionalStructure = structure?.direction === 'BULLISH' || structure?.direction === 'BEARISH';
    const structuralBreak = structure?.event === 'BOS_BULLISH' || structure?.event === 'BOS_BEARISH';
    const hasData = adx !== null && width !== null;

    let regime: ForexRegimeResult['regime'] = 'UNKNOWN';
    let confidence = 0;
    let reason = 'Dados insuficientes para classificar o regime.';

    if (hasData) {
      // Breakout is a distinct regime only when expansion is accompanied by a structural break.
      if (structuralBreak && widthExpansion !== null && widthExpansion >= this.config.breakoutWidthExpansionRatio) {
        regime = 'BREAKOUT';
        confidence = clamp(0.65 + Math.min(0.25, (widthExpansion - this.config.breakoutWidthExpansionRatio) * 0.5));
        reason = 'Expansão de volatilidade acompanhada por quebra estrutural.';
      } else if (adx >= this.config.adxTrendingThreshold && directionalStructure) {
        regime = 'TRENDING';
        confidence = 0.65 + (Math.min(10, adx - this.config.adxTrendingThreshold) / 10) * 0.2;
        reason = 'ADX elevado e estrutura direcional confirmada.';
      } else if (width <= this.config.squeezeWidthThreshold) {
        regime = 'CONSOLIDATING';
        confidence = 0.7;
        reason = 'Bollinger width comprimido: mercado em consolidação.';
      } else if (adx < this.config.adxRangingThreshold && !directionalStructure) {
        regime = 'RANGING';
        confidence = 0.65;
        reason = 'ADX baixo e ausência de estrutura direcional dominante.';
      } else {
        regime = 'TRANSITION';
        confidence = 0.5;
        reason = 'Sinais de regime mistos; mercado tratado como transição.';
      }
    }

    const resultReasonCode = regime === 'UNKNOWN' ? 'REGIME_UNKNOWN' : undefined;
    const snapshot: ForexRegimeSnapshot = {
      version: 'forex-regime-v1.0.0',
      regime,
      confidence: round(confidence),
      adx,
      bollingerWidthPct: width,
      structureDirection: structure?.direction ?? null,
      structureEvent: structure?.event ?? null,
      session: session.session,
      reason,
      calculatedAt: Date.now(),
    };

    return {
      regime,
      confidence: round(confidence),
      featureSnapshot: features,
      reasonCode: resultReasonCode,
      snapshot,
    };
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function round(value: number): number { return Number(value.toFixed(4)); }

function getSessionFromMarket(market: ForexMarketContext): ForexSessionSnapshot {
  const date = new Date(market.serverTime ?? Date.now());
  const hour = date.getUTCHours();
  // Lazy import avoided intentionally: regime remains deterministic from the market timestamp.
  const names: Array<ForexSessionSnapshot['activeSessions'][number]> = [];
  const windows: Record<ForexSessionSnapshot['activeSessions'][number], [number, number]> = {
    SYDNEY: [21, 6], TOKYO: [0, 9], LONDON: [7, 16], NEW_YORK: [12, 21],
  };
  for (const [name, [start, end]] of Object.entries(windows) as Array<[ForexSessionSnapshot['activeSessions'][number], [number, number]]>) {
    const active = start < end ? hour >= start && hour < end : hour >= start || hour < end;
    if (active) names.push(name);
  }
  return {
    session: names.length > 1 ? 'OVERLAP' : names[0] ?? 'OFF_SESSION',
    activeSessions: names,
    overlap: names.length > 1,
    utcHour: hour,
    calculatedAt: market.serverTime ?? Date.now(),
    version: 'forex-session-v1.0.0',
  };
}

export const FOREX_REGIME_DEFAULT_CONFIG = DEFAULT_CONFIG;
