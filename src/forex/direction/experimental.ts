import type { Candle } from '../../types';
import { calculateATR } from '../../lib/indicators';
import type { ForexDirection } from '../decision-engine/types';

/**
 * Experimental research signal based on the frozen ATR14-price hypothesis.
 *
 * IMPORTANT: the holdout was inconclusive, so this engine is deliberately NOT
 * connected to D13/D16/D17/D19 BUY authorization. It exists to make the
 * candidate CALL/PUT observable in Demo/Research mode without pretending the
 * evidence is production-approved.
 */
export const FOREX_EXPERIMENTAL_DIRECTION_VERSION = 'forex-direction-experimental-atr14-inverse-v1.0.0' as const;

export interface ExperimentalDirectionSnapshot {
  version: typeof FOREX_EXPERIMENTAL_DIRECTION_VERSION;
  feature: 'atrPct';
  direction: ForexDirection;
  score: number;
  confidence: number;
  atrPct: number;
  percentile: number;
  sampleSize: number;
  thresholdLow: number;
  thresholdHigh: number;
  evidence: 'MATRIX_ATR14_INVERSE';
  executable: false;
  reason: string;
  calculatedAt: number;
}

export class ForexExperimentalAtrDirectionV1 {
  constructor(
    private readonly thresholdLow = 0.40,
    private readonly thresholdHigh = 0.60,
    private readonly lookback = 120,
  ) {}

  decide(candles: Candle[], timeframeMinutes: number, now = Math.floor(Date.now() / 1000)): ExperimentalDirectionSnapshot {
    if (candles.length < 40) return this.none(0, 0, 0, 0, 'Histórico insuficiente para o sinal experimental ATR14.');

    const ordered = candles.slice().sort((a, b) => a.time - b.time);
    const start = Math.max(28, ordered.length - this.lookback);
    const atrs: number[] = [];

    for (let i = start; i < ordered.length; i++) {
      const window = ordered.slice(0, i + 1);
      if (window.length < 28) continue;
      const atr = calculateATR(window, 14);
      const close = window.at(-1)?.close ?? 0;
      if (Number.isFinite(atr) && close > 0) atrs.push(atr / Math.abs(close));
    }

    const atr = calculateATR(ordered, 14);
    const close = ordered.at(-1)?.close ?? 0;
    const atrPct = close > 0 ? atr / Math.abs(close) : 0;
    if (!Number.isFinite(atrPct) || !atrs.length) {
      return this.none(atrPct, 0, 0, atrs.length, 'ATR14 indisponível para o sinal experimental.');
    }

    const belowOrEqual = atrs.filter(v => v <= atrPct).length;
    const percentile = belowOrEqual / atrs.length;
    const distance = percentile < 0.5 ? 0.5 - percentile : percentile - 0.5;
    const score = Math.min(1, distance * 2);

    let direction: ForexDirection = 'NONE';
    let reason = 'ATR14 na zona central; nenhuma direção experimental emitida.';
    if (percentile <= this.thresholdLow) {
      // Frozen relationship is INVERSE: lower ATR rank maps to higher target-UP rank.
      direction = 'CALL';
      reason = 'Sinal experimental ATR14 INVERSE: ATR14 em percentil baixo.';
    } else if (percentile >= this.thresholdHigh) {
      direction = 'PUT';
      reason = 'Sinal experimental ATR14 INVERSE: ATR14 em percentil alto.';
    }

    return {
      version: FOREX_EXPERIMENTAL_DIRECTION_VERSION,
      feature: 'atrPct',
      direction,
      score: round(score),
      confidence: round(score),
      atrPct: round(atrPct),
      percentile: round(percentile),
      sampleSize: atrs.length,
      thresholdLow: this.thresholdLow,
      thresholdHigh: this.thresholdHigh,
      evidence: 'MATRIX_ATR14_INVERSE',
      executable: false,
      reason,
      calculatedAt: now,
    };
  }

  private none(atrPct: number, percentile: number, score: number, sampleSize: number, reason: string): ExperimentalDirectionSnapshot {
    return {
      version: FOREX_EXPERIMENTAL_DIRECTION_VERSION,
      feature: 'atrPct', direction: 'NONE', score, confidence: score,
      atrPct: round(atrPct), percentile: round(percentile), sampleSize,
      thresholdLow: this.thresholdLow, thresholdHigh: this.thresholdHigh,
      evidence: 'MATRIX_ATR14_INVERSE', executable: false, reason,
      calculatedAt: Math.floor(Date.now() / 1000),
    };
  }
}

function round(v: number): number { return Number(v.toFixed(6)); }
