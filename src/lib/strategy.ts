import { Candle, TradeSignal, StrategyIndicators, StrategyProfile, StrategyProfileConfig } from "../types";
import { calculateEMA, calculateRSI, calculateADX, calculateATR, calculateMACD, calculateBollingerBands } from "./indicators";

// ─── Perfis de estratégia com thresholds reais ────────────────────────────────
export const STRATEGY_PROFILES: Record<StrategyProfile, StrategyProfileConfig> = {
  conservative: {
    minConfidenceOverride: 80,
    requireTrending: true,
    dominanceMultiplier: 1.45,
    minWinScore: 75,
    freshnessWeight: 1.6,
    timingWeight: 1.5,
    emaDistWeight: 1.4,
    rsiOverbought: 70,
    rsiOversold: 30,
    maxConsecutiveCandles: 4,
    maxExhaustionScore: 14,
  },
  balanced: {
    minConfidenceOverride: 70,
    requireTrending: false,
    dominanceMultiplier: 1.25,
    minWinScore: 60,
    freshnessWeight: 1.0,
    timingWeight: 1.0,
    emaDistWeight: 1.0,
    rsiOverbought: 75,
    rsiOversold: 25,
    maxConsecutiveCandles: 6,
    maxExhaustionScore: 18,
  },
  aggressive: {
    minConfidenceOverride: 55,
    requireTrending: false,
    dominanceMultiplier: 1.10,
    minWinScore: 45,
    freshnessWeight: 0.6,
    timingWeight: 0.6,
    emaDistWeight: 0.6,
    rsiOverbought: 80,
    rsiOversold: 20,
    maxConsecutiveCandles: 8,
    maxExhaustionScore: 24,
  },
};

// ─── Função principal ─────────────────────────────────────────────────────────
export const analyzeMarket = (
  candles: Candle[],
  symbol: string = "R_100",
  profile: StrategyProfile = "balanced"
): TradeSignal => {
  if (candles.length < 50) {
    return { type: "NEUTRAL", confidence: 0, indicators: getDefaultIndicators() };
  }

  const cfg = STRATEGY_PROFILES[profile];
  const closes = candles.map((c) => c.close);
  const emaFast = calculateEMA(closes, 9);
  const emaSlow = calculateEMA(closes, 21);
  const rsi = calculateRSI(closes, 14);
  const { adx, plusDI, minusDI } = calculateADX(candles, 14);
  const macdData = calculateMACD(closes);
  const bb = calculateBollingerBands(closes);
  const atr = calculateATR(candles, 14);

  const lastCandle = candles[candles.length - 1];
  const lastClose = lastCandle.close;
  const lastOpen = lastCandle.open;
  const bodySize = Math.abs(lastClose - lastOpen);
  const avgBodySize = candles.slice(-20).reduce((acc, c) => acc + Math.abs(c.close - c.open), 0) / 20;

  // 1. Perfil de Volatilidade Adaptativo
  const isLowVol = symbol.includes("10") || symbol.includes("25") || symbol.includes("50");
  const volProfile = isLowVol ? "SMOOTH" : "AGGRESSIVE";
  const adxThreshold = isLowVol ? 20 : 28;
  const alternationLimit = isLowVol ? 4 : 2;
  const emaSlopeThreshold = isLowVol ? 0.00015 : 0.0003;
  const emaDistThreshold = isLowVol ? 1.4 : 2.2;

  // 2. Detecção de Condição de Mercado
  const adxStrong = adx > adxThreshold;
  const diSeparation = Math.abs(plusDI - minusDI) > (isLowVol ? 10 : 18);
  const emaSlope = Math.abs(emaFast - emaSlow) / emaSlow > emaSlopeThreshold;
  const last8 = candles.slice(-8);
  const alternations = last8.filter(
    (c, i) => i > 0 && (c.close > c.open) !== (last8[i - 1].close > last8[i - 1].open)
  ).length;
  const marketCondition: "TRENDING" | "CHOPPY" =
    adxStrong && diSeparation && (emaSlope || adx > 35) && alternations <= alternationLimit
      ? "TRENDING" : "CHOPPY";

  // Perfil conservador requer TRENDING obrigatoriamente
  if (cfg.requireTrending && marketCondition !== "TRENDING") {
    return {
      type: "NEUTRAL", confidence: 0,
      indicators: {
        ...getDefaultIndicators(), emaFast, emaSlow, rsi, adx, atr, marketCondition,
        reason: `Bloqueio ${profile}: requer mercado TRENDING`,
        blockedReason: `Perfil ${profile} bloqueado em Choppy`,
        volatilityProfile: volProfile,
      },
    };
  }

  // 3. Contagem de candles consecutivos
  let consecutiveCount = 0;
  const currentDir = lastClose > lastOpen ? "UP" : "DOWN";
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    const dir = c.close > c.open ? "UP" : c.close < c.open ? "DOWN" : "NEUTRAL";
    if (dir === currentDir) consecutiveCount++;
    else break;
  }

  // 4. Filtros de exaustão
  const emaDist = Math.abs(lastClose - emaFast) / (atr || 0.0001);
  const isTooFarFromEMA = emaDist > emaDistThreshold;
  const prevCandle = candles[candles.length - 2];
  const acceleration = bodySize / (Math.abs(prevCandle.close - prevCandle.open) || 1);

  // 5. Freshness Engine (peso do perfil)
  let freshness = 10;
  if (consecutiveCount > 4) freshness -= (consecutiveCount - 4) * 1.5 * cfg.freshnessWeight;
  if (emaDist > 1.4) freshness -= (emaDist - 1.4) * 3 * cfg.emaDistWeight;
  if (acceleration > 2.5) freshness -= 2 * cfg.freshnessWeight;
  const trendFreshnessScore = Math.max(0, Math.min(10, freshness));

  // 6. Timing Engine (peso do perfil)
  let timingQuality = 10;
  if (emaDist > 1.6) timingQuality -= 4 * cfg.timingWeight;
  if (emaDist < 0.6) timingQuality += 1;
  if (consecutiveCount >= 5) timingQuality -= 3 * cfg.timingWeight;
  const timingScore = Math.max(0, Math.min(10, timingQuality));
  const lateEntryDetected = timingScore < 4;

  // 7. Exaustão (limites do perfil)
  const exhaustionScore = consecutiveCount * 2 + emaDist * 3 + (acceleration > 2.8 ? 3 : 0);
  const isHighExhaustion = exhaustionScore > cfg.maxExhaustionScore || consecutiveCount >= cfg.maxConsecutiveCandles;
  const isSaturated = trendFreshnessScore < 3;

  // 8. EMA Rejection
  const last4 = candles.slice(-4);
  const hadPullback = last4.some((c) => (currentDir === "UP" ? c.close < c.open : c.close > c.open));
  const rejectedEMA = last4.some(
    (c) => Math.abs((currentDir === "UP" ? c.low : c.high) - emaFast) / (atr || 0.0001) < 0.6
  );
  const isEMARejection =
    (hadPullback || isLowVol) && rejectedEMA &&
    (currentDir === "UP" ? lastClose > lastOpen : lastClose < lastOpen);

  // 9. Scoring
  let callScore = 0;
  let putScore = 0;
  let reason = "";

  if (emaFast > emaSlow) { callScore += 50; if (lastClose > emaFast) callScore += 10; }
  else { putScore += 50; if (lastClose < emaFast) putScore += 10; }

  if (plusDI > minusDI && plusDI > (isLowVol ? 20 : 25)) callScore += 35;
  else if (minusDI > plusDI && minusDI > (isLowVol ? 20 : 25)) putScore += 35;

  if (currentDir === "UP") {
    if (isSaturated) callScore -= 10;
    if (isHighExhaustion) callScore -= 18;
    if (isTooFarFromEMA) callScore -= 12;
    if (lateEntryDetected) callScore -= 15;
  } else {
    if (isSaturated) putScore -= 10;
    if (isHighExhaustion) putScore -= 18;
    if (isTooFarFromEMA) putScore -= 12;
    if (lateEntryDetected) putScore -= 15;
  }

  // RSI com thresholds do perfil
  if (rsi > cfg.rsiOverbought) callScore -= 15;
  if (rsi < cfg.rsiOversold) putScore -= 15;

  if (isEMARejection) {
    if (currentDir === "UP") callScore += 25;
    else putScore += 25;
  }
  if (isLowVol && marketCondition === "TRENDING") {
    if (currentDir === "UP") callScore += 10;
    else putScore += 10;
  }

  // 10. Decisão (dominância + score mínimo do perfil)
  let type: "CALL" | "PUT" | "NEUTRAL" = "NEUTRAL";
  const scoreDiff = Math.abs(callScore - putScore);
  const { dominanceMultiplier, minWinScore } = cfg;

  if (callScore > putScore * dominanceMultiplier && callScore > minWinScore) {
    type = "CALL";
    reason = isEMARejection ? "Rejeição EMA (Contexto Ideal)" : "Tendência Progressiva";
  } else if (putScore > callScore * dominanceMultiplier && putScore > minWinScore) {
    type = "PUT";
    reason = isEMARejection ? "Rejeição EMA (Contexto Ideal)" : "Tendência Progressiva";
  } else if (isTooFarFromEMA && !isEMARejection) {
    reason = "Bloqueio: Movimento muito esticado";
  } else if (isHighExhaustion) {
    reason = "Bloqueio: Exaustão elevada";
  } else {
    reason = `Sinal Fraco — ${profile} (${dominanceMultiplier}x req.)`;
  }

  // 11. Confiança contextual (pesos do perfil)
  let confidence = 0;
  const penaltyReasons: string[] = [];

  if (type !== "NEUTRAL") {
    let conf = 88;
    if (trendFreshnessScore < 7) { conf -= (7 - trendFreshnessScore) * 6 * cfg.freshnessWeight; penaltyReasons.push("Tendência Madura"); }
    if (timingScore < 6) { conf -= (6 - timingScore) * 8 * cfg.timingWeight; penaltyReasons.push("Ajuste de Timing"); }
    if (emaDist > 1.0) { conf -= (emaDist - 1.0) * 10 * cfg.emaDistWeight; penaltyReasons.push("Afastamento EMA"); }
    if (adx < 25) { conf -= 5; penaltyReasons.push("Força Moderada"); }
    confidence = Math.max(0, Math.min(95, Math.round(conf)));
  }

  return {
    type,
    confidence,
    indicators: {
      emaFast, emaSlow, rsi, adx, atr, macd: macdData, bollinger: bb,
      score: type === "CALL" ? callScore : putScore,
      confidence, marketCondition, callScore, putScore, scoreDiff,
      candleStrength: Number((bodySize / avgBodySize).toFixed(2)),
      lastCandlesDirection: last8.map((c) => (c.close > c.open ? "UP" : "DOWN")),
      reason, exhaustionScore: Number(exhaustionScore.toFixed(2)),
      emaDistanceNormalized: Number(emaDist.toFixed(2)),
      trendFreshnessScore: Number(trendFreshnessScore.toFixed(2)),
      entryTimingScore: Number(timingScore.toFixed(2)),
      lateEntryDetected, saturationDetected: isSaturated,
      timingQuality: Number(timingScore.toFixed(2)),
      confidencePenaltyReasons: penaltyReasons,
      exhaustionPenalty: isHighExhaustion ? 18 : isSaturated ? 10 : 0,
      emaStretchLevel: Number(emaDist.toFixed(2)),
      entryDelayRisk: consecutiveCount > 4 ? (consecutiveCount - 4) * 5 : 0,
      consecutiveCandles: consecutiveCount,
      isExhausted: isHighExhaustion || isSaturated,
      blockedReason: type === "NEUTRAL" ? reason : "",
      volatilityProfile: volProfile,
      adaptiveThresholds: { adx: adxThreshold, alternations: alternationLimit, emaSlope: emaSlopeThreshold },
      confidenceBeforePenalty: 88,
      totalPenaltyApplied: 88 - (type === "NEUTRAL" ? 0 : confidence),
    },
  };
};

const getDefaultIndicators = (): StrategyIndicators => ({
  emaFast: 0, emaSlow: 0, rsi: 50, adx: 0, atr: 0,
  score: 0, confidence: 0, marketCondition: "UNKNOWN",
});
