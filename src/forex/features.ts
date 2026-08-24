import type { Candle } from '../types';
import type { ForexFeatureEngine } from './decision-engine/ports';
import type { ForexFeatureSnapshot, ForexMarketContext } from './decision-engine/types';
import { calculateADX, calculateATR, calculateBollingerBands, calculateEMA, calculateMACD, calculateRSI } from '../lib/indicators';
import { FOREX_FEATURE_CATALOG, FOREX_FEATURE_VERSION, validateForexFeatureSnapshot } from './decision-engine/featureCatalog';

const MIN_CANDLES = 60;

function returns(closes: number[]): number[] {
  const result: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    result.push(prev === 0 ? 0 : (closes[i] - prev) / Math.abs(prev));
  }
  return result;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function assertClosedCandles(candles: Candle[]): void {
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) {
      throw new Error(`Forex feature data inválida no candle ${i}.`);
    }
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.high < c.low) {
      throw new Error(`Forex candle OHLC inconsistente no índice ${i}.`);
    }
    if (i > 0 && c.time <= candles[i - 1].time) {
      throw new Error('Forex candles devem estar ordenados cronologicamente.');
    }
  }
}

/**
 * Production feature adapter for Forex V1.
 *
 * Important: this class computes features only. It does not choose direction,
 * assign trading weights, or execute a contract. The research lab remains the
 * authority for OOS evidence; this adapter only makes the frozen catalog
 * reproducible at decision time.
 */
export class ForexFeatureEngineV1 implements ForexFeatureEngine {
  calculate(market: ForexMarketContext): ForexFeatureSnapshot {
    const candles = market.candles.slice().sort((a, b) => a.time - b.time);
    assertClosedCandles(candles);
    if (candles.length < MIN_CANDLES) {
      throw new Error(`Dados insuficientes: ${candles.length}/${MIN_CANDLES} candles fechados.`);
    }

    // Never include a candle newer than the market context's dataAsOf/serverTime.
    const cutoff = market.dataAsOf ?? market.serverTime;
    const closed = cutoff == null ? candles : candles.filter(c => c.time <= cutoff);
    if (closed.length < MIN_CANDLES) throw new Error('Dados insuficientes após o corte temporal.');

    const closes = closed.map(c => c.close);
    const last = closed[closed.length - 1];
    const prev = closed[closed.length - 2];
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes, 12, 26, 9);
    const adx = calculateADX(closed, 14);
    const atr = calculateATR(closed, 14);
    const bb = calculateBollingerBands(closes, 20, 2);
    const rs = returns(closes);
    const volatility20 = standardDeviation(rs.slice(-20));
    const previousClose = prev?.close ?? last.close;
    const roc = previousClose === 0 ? 0 : (last.close - previousClose) / Math.abs(previousClose);
    const rangePct = last.close === 0 ? 0 : (last.high - last.low) / Math.abs(last.close);
    const bodyPct = last.close === 0 ? 0 : (last.close - last.open) / Math.abs(last.close);
    const closeLocation = last.high === last.low ? 0.5 : (last.close - last.low) / (last.high - last.low);

    const values = {
      emaSpread: last.close === 0 ? 0 : (ema9 - ema21) / Math.abs(last.close),
      rsiCentered: (rsi - 50) / 50,
      macdHistogram: last.close === 0 ? 0 : macd.histogram / Math.abs(last.close),
      adxDirection: (adx.plusDI - adx.minusDI) / 100,
      atrPct: last.close === 0 ? 0 : atr / Math.abs(last.close),
      bollingerPosition: bb.upper === bb.lower ? 0.5 : (last.close - bb.lower) / (bb.upper - bb.lower),
      bollingerWidthPct: bb.middle === 0 ? 0 : (bb.upper - bb.lower) / Math.abs(bb.middle),
      roc,
      bodyPct,
      rangePct,
      closeLocation,
      volatility20,
    };

    const snapshot: ForexFeatureSnapshot = {
      featureId: `forex-v1-catalog:${FOREX_FEATURE_CATALOG.join(',')}`,
      values,
      calculatedAt: Math.floor(Date.now() / 1000),
      sourceTimeframeMinutes: market.timeframeMinutes,
      version: FOREX_FEATURE_VERSION,
    };

    const validation = validateForexFeatureSnapshot(snapshot);
    if (!validation.valid) throw new Error(`Feature snapshot inválido: ${validation.reasons.join(', ')}`);
    return snapshot;
  }
}
