import type { Candle } from '../../types';
import type {
  ForexMarketStructureDirection,
  ForexStructureConfig,
  ForexStructureEvent,
  ForexStructureInput,
  ForexStructureSnapshot,
  ForexStructureZone,
  ForexSwingLabel,
  ForexSwingPoint,
  ForexSwingType,
} from './types';

export const FOREX_STRUCTURE_VERSION = 'forex-structure-v1.0.0' as const;

export const DEFAULT_FOREX_STRUCTURE_CONFIG: ForexStructureConfig = {
  pivotRadius: 2,
  lookback: 200,
  levelToleranceAtr: 0.25,
  minimumLevelTouches: 2,
};

/**
 * D4: pure Forex market-structure engine.
 *
 * This is intentionally separate from src/lib/marketStructure.ts, whose logic
 * belongs to the legacy/synthetic engine. D4 computes context only: it does
 * NOT issue CALL/PUT and it does NOT assign production trading weights.
 */
export class ForexStructureEngineV1 {
  constructor(private readonly config: ForexStructureConfig = DEFAULT_FOREX_STRUCTURE_CONFIG) {}

  analyze(input: ForexStructureInput): ForexStructureSnapshot {
    const candles = normalizeCandles(input.candles, this.config.lookback);
    assertValidCandles(candles);

    const swings = detectSwings(candles, this.config.pivotRadius);
    labelSwings(swings);

    const recentSwingHigh = lastOfType(swings, 'HIGH');
    const recentSwingLow = lastOfType(swings, 'LOW');
    const structure = inferStructureDirection(swings);
    const event = detectBreakEvent(candles, swings);
    const tolerance = Math.max(
      (input.atr ?? 0) * this.config.levelToleranceAtr,
      Math.abs(candles[candles.length - 1].close) * 0.00005,
    );

    const zones = buildZones(swings, candles, tolerance, this.config.minimumLevelTouches);
    const lastClose = candles[candles.length - 1].close;
    const support = nearestZone(zones.filter(z => z.kind !== 'RESISTANCE'), lastClose, 'below');
    const resistance = nearestZone(zones.filter(z => z.kind !== 'SUPPORT'), lastClose, 'above');

    const confidence = structureConfidence(swings, structure, event, support, resistance);

    return {
      version: FOREX_STRUCTURE_VERSION,
      direction: structure,
      event: event.type,
      eventIndex: event.index,
      swings,
      recentSwingHigh,
      recentSwingLow,
      support,
      resistance,
      distanceToSupport: support ? Math.max(0, lastClose - support.upper) : null,
      distanceToResistance: resistance ? Math.max(0, resistance.lower - lastClose) : null,
      confidence,
      calculatedAt: input.calculatedAt ?? Math.floor(Date.now() / 1000),
      sourceTimeframeMinutes: input.timeframeMinutes,
    };
  }
}

function normalizeCandles(candles: Candle[], lookback: number): Candle[] {
  return candles
    .slice()
    .sort((a, b) => a.time - b.time)
    .slice(-lookback);
}

function assertValidCandles(candles: Candle[]): void {
  if (candles.length < 2) throw new Error('Forex structure requer pelo menos 2 candles.');
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) {
      throw new Error(`Candle Forex inválido no índice ${i}.`);
    }
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.high < c.low) {
      throw new Error(`OHLC Forex inconsistente no índice ${i}.`);
    }
    if (i > 0 && c.time <= candles[i - 1].time) throw new Error('Candles Forex devem ser cronológicos.');
  }
}

export function detectSwings(candles: Candle[], radius: number): ForexSwingPoint[] {
  if (!Number.isInteger(radius) || radius < 1) throw new Error('pivotRadius deve ser >= 1.');
  const result: ForexSwingPoint[] = [];
  for (let i = radius; i < candles.length - radius; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - radius; j <= i + radius; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh) result.push({ index: i, time: c.time, price: c.high, type: 'HIGH', label: null });
    if (isLow) result.push({ index: i, time: c.time, price: c.low, type: 'LOW', label: null });
  }
  return result.sort((a, b) => a.index - b.index);
}

export function labelSwings(swings: ForexSwingPoint[]): void {
  let previousHigh: ForexSwingPoint | null = null;
  let previousLow: ForexSwingPoint | null = null;
  for (const swing of swings) {
    if (swing.type === 'HIGH') {
      swing.label = previousHigh ? (swing.price > previousHigh.price ? 'HH' : 'LH') : null;
      previousHigh = swing;
    } else {
      swing.label = previousLow ? (swing.price > previousLow.price ? 'HL' : 'LL') : null;
      previousLow = swing;
    }
  }
}

function lastOfType(swings: ForexSwingPoint[], type: ForexSwingType): ForexSwingPoint | null {
  for (let i = swings.length - 1; i >= 0; i--) if (swings[i].type === type) return swings[i];
  return null;
}

function inferStructureDirection(swings: ForexSwingPoint[]): ForexMarketStructureDirection {
  const highs = swings.filter(s => s.type === 'HIGH' && s.label);
  const lows = swings.filter(s => s.type === 'LOW' && s.label);
  const lastHigh = highs[highs.length - 1]?.label;
  const lastLow = lows[lows.length - 1]?.label;
  if ((lastHigh === 'HH' && lastLow === 'HL')) return 'BULLISH';
  if ((lastHigh === 'LH' && lastLow === 'LL')) return 'BEARISH';
  if (lastHigh && lastLow) return 'TRANSITION';
  return 'UNKNOWN';
}

function detectBreakEvent(candles: Candle[], swings: ForexSwingPoint[]): { type: ForexStructureEvent; index: number | null } {
  const last = candles[candles.length - 1];
  const previousClose = candles[candles.length - 2]?.close ?? last.close;
  const priorHigh = [...swings].reverse().find(s => s.type === 'HIGH' && s.index < candles.length - 1);
  const priorLow = [...swings].reverse().find(s => s.type === 'LOW' && s.index < candles.length - 1);
  if (priorHigh && previousClose <= priorHigh.price && last.close > priorHigh.price) {
    const priorDirection = directionBeforeBreak(swings, priorHigh.index);
    return { type: priorDirection === 'BEARISH' ? 'CHOCH_BULLISH' : 'BOS_BULLISH', index: candles.length - 1 };
  }
  if (priorLow && previousClose >= priorLow.price && last.close < priorLow.price) {
    const priorDirection = directionBeforeBreak(swings, priorLow.index);
    return { type: priorDirection === 'BULLISH' ? 'CHOCH_BEARISH' : 'BOS_BEARISH', index: candles.length - 1 };
  }
  return { type: 'NONE', index: null };
}

function directionBeforeBreak(swings: ForexSwingPoint[], breakIndex: number): ForexMarketStructureDirection {
  const prior = swings.filter(s => s.index < breakIndex);
  return inferStructureDirection(prior);
}

function buildZones(
  swings: ForexSwingPoint[],
  candles: Candle[],
  tolerance: number,
  minTouches: number,
): ForexStructureZone[] {
  const candidates = swings.map(s => ({ price: s.price, index: s.index }));
  const clusters: { prices: number[]; indices: number[] }[] = [];
  for (const point of candidates) {
    const cluster = clusters.find(c => Math.abs(point.price - average(c.prices)) <= tolerance);
    if (cluster) { cluster.prices.push(point.price); cluster.indices.push(point.index); }
    else clusters.push({ prices: [point.price], indices: [point.index] });
  }
  const lastClose = candles[candles.length - 1].close;
  return clusters
    .filter(c => c.prices.length >= minTouches)
    .map(c => {
      const price = average(c.prices);
      const lower = price - tolerance;
      const upper = price + tolerance;
      const kind: ForexStructureZone['kind'] = upper < lastClose ? 'SUPPORT' : lower > lastClose ? 'RESISTANCE' : 'NEUTRAL';
      return { price, lower, upper, touches: c.prices.length, lastTouchIndex: Math.max(...c.indices), kind };
    });
}

function nearestZone(zones: ForexStructureZone[], close: number, side: 'below' | 'above'): ForexStructureZone | null {
  const eligible = zones.filter(z => side === 'below' ? z.upper <= close : z.lower >= close);
  if (!eligible.length) return null;
  return eligible.reduce((best, zone) => {
    const bestDistance = side === 'below' ? close - best.upper : best.lower - close;
    const zoneDistance = side === 'below' ? close - zone.upper : zone.lower - close;
    return zoneDistance < bestDistance ? zone : best;
  });
}

function structureConfidence(
  swings: ForexSwingPoint[],
  direction: ForexMarketStructureDirection,
  event: { type: ForexStructureEvent },
  support: ForexStructureZone | null,
  resistance: ForexStructureZone | null,
): number {
  let score = 0;
  if (swings.length >= 4) score += 0.25;
  if (direction === 'BULLISH' || direction === 'BEARISH') score += 0.35;
  if (event.type !== 'NONE') score += 0.15;
  if (support || resistance) score += 0.15;
  if ((support?.touches ?? 0) >= 3 || (resistance?.touches ?? 0) >= 3) score += 0.10;
  return Math.min(1, Number(score.toFixed(4)));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
