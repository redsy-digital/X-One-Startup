import { Candle, TradeSignal, StrategyIndicators } from "../types";
import { calculateEMA, calculateRSI, calculateADX, calculateATR, calculateMACD, calculateBollingerBands } from "./indicators";

export const analyzeMarket = (candles: Candle[], symbol: string = "R_100"): TradeSignal => {
  if (candles.length < 50) {
    return { type: "NEUTRAL", confidence: 0, indicators: getDefaultIndicators() };
  }

  const closes = candles.map(c => c.close);
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

  // 1. ADAPTIVE VOLATILITY PROFILING
  const isLowVol = symbol.includes("10") || symbol.includes("25") || symbol.includes("50");
  const volProfile = isLowVol ? "SMOOTH" : "AGGRESSIVE";
  
  // Adaptive Thresholds
  const adxThreshold = isLowVol ? 20 : 28;
  const alternationLimit = isLowVol ? 4 : 2;
  const emaSlopeThreshold = isLowVol ? 0.00015 : 0.0003;
  const emaDistThreshold = isLowVol ? 1.4 : 2.2;

  // 2. MARKET DETECTION (RELAXED)
  const adxStrong = adx > adxThreshold;
  const diSeparation = Math.abs(plusDI - minusDI) > (isLowVol ? 10 : 18);
  const emaSlope = Math.abs(emaFast - emaSlow) / emaSlow > emaSlopeThreshold;
  
  const last8 = candles.slice(-8);
  const alternations = last8.filter((c, i) => i > 0 && (c.close > c.open) !== (last8[i-1].close > last8[i-1].open)).length;
  
  // Trending needs less strict criteria now to avoid paralysis
  const marketCondition: "TRENDING" | "CHOPPY" = (adxStrong && diSeparation && (emaSlope || adx > 35) && alternations <= alternationLimit) ? "TRENDING" : "CHOPPY";

  // 3. EXHAUSTION & SATURATION (RECALIBRATED)
  let consecutiveCount = 0;
  const currentDir = lastClose > lastOpen ? "UP" : "DOWN";
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    const dir = c.close > c.open ? "UP" : (c.close < c.open ? "DOWN" : "NEUTRAL");
    if (dir === currentDir) consecutiveCount++;
    else break;
  }

  // EMA Distance Filter (Normalized by ATR)
  const emaDist = Math.abs(lastClose - emaFast) / (atr || 0.0001);
  const isTooFarFromEMA = emaDist > emaDistThreshold;
  
  // Acceleration Detection
  const prevCandle = candles[candles.length - 2];
  const acceleration = bodySize / (Math.abs(prevCandle.close - prevCandle.open) || 1);
  
  // 4. TREND FRESHNESS ENGINE (Score 0-10) - MORE TOLERANT
  let freshness = 10;
  if (consecutiveCount > 4) freshness -= (consecutiveCount - 4) * 1.5; // Starts later, penalizes less
  if (emaDist > 1.4) freshness -= (emaDist - 1.4) * 3; // Softer penalty
  if (acceleration > 2.5) freshness -= 2;
  const trendFreshnessScore = Math.max(0, Math.min(10, freshness));

  // 5. ENTRY TIMING ENGINE - MORE FLEXIBLE
  let timingQuality = 10;
  if (emaDist > 1.6) timingQuality -= 4; // Softer penalty
  if (emaDist < 0.6) timingQuality += 1;
  if (consecutiveCount >= 5) timingQuality -= 3; // Softer penalty
  const timingScore = Math.max(0, Math.min(10, timingQuality));
  const lateEntryDetected = timingScore < 4; // Threshold reduced from 5

  // 6. EXHAUSTION ENGINE (RECALIBRATED)
  const exhaustionScore = (consecutiveCount * 2) + (emaDist * 3) + (acceleration > 2.8 ? 3 : 0);
  const isHighExhaustion = exhaustionScore > 18 || consecutiveCount >= 6; // Limits increased
  const isSaturated = trendFreshnessScore < 3;

  // 7. EMA REJECTION LOGIC
  const last4 = candles.slice(-4);
  const hadPullback = last4.some(c => (currentDir === "UP" ? c.close < c.open : c.close > c.open));
  const rejectedEMA = last4.some(c => Math.abs((currentDir === "UP" ? c.low : c.high) - emaFast) / (atr || 0.0001) < 0.6);
  const isEMARejection = (hadPullback || isLowVol) && rejectedEMA && (currentDir === "UP" ? lastClose > lastOpen : lastClose < lastOpen);

  let callScore = 0;
  let putScore = 0;
  let reason = "";

  // A. TREND CONTEXT
  if (emaFast > emaSlow) {
    callScore += 50;
    if (lastClose > emaFast) callScore += 10;
  } else {
    putScore += 50;
    if (lastClose < emaFast) putScore += 10;
  }

  // B. STRENGTH
  if (plusDI > minusDI && plusDI > (isLowVol ? 20 : 25)) callScore += 35;
  else if (minusDI > plusDI && minusDI > (isLowVol ? 20 : 25)) putScore += 35;

  // C. SATURATION PROTECTIONS (REDUCED DRASTICALLY)
  if (currentDir === "UP") {
    if (isSaturated) callScore -= 10; // Was 30
    if (isHighExhaustion) callScore -= 18; // Was 50
    if (isTooFarFromEMA) callScore -= 12; // Was 60
    if (lateEntryDetected) callScore -= 15; // Was 45
  } else {
    if (isSaturated) putScore -= 10;
    if (isHighExhaustion) putScore -= 18;
    if (isTooFarFromEMA) putScore -= 12;
    if (lateEntryDetected) putScore -= 15;
  }

  // D. RSI EXTREMES (REDUCED)
  if (rsi > 75) callScore -= 15; // Raised threshold, reduced penalty
  if (rsi < 25) putScore -= 15;

  // E. REJECTION BONUS
  if (isEMARejection) {
    if (currentDir === "UP") callScore += 25;
    else putScore += 25;
  }

  // F. LOW VOLATILITY ADAPTATION BONUS
  if (isLowVol && marketCondition === "TRENDING") {
    if (currentDir === "UP") callScore += 10;
    else putScore += 10;
  }

  // 8. DECISION ENGINE (1.25x Dominance)
  let type: "CALL" | "PUT" | "NEUTRAL" = "NEUTRAL";
  const scoreDiff = Math.abs(callScore - putScore);
  const dominanceThreshold = 1.25; // User requested 1.2x ~ 1.3x
  
  if (marketCondition === "TRENDING") {
    if (callScore > putScore * dominanceThreshold && callScore > 60) {
      type = "CALL";
      reason = isEMARejection ? "Rejeição EMA (Contexto Ideal)" : "Tendência Progressiva";
    } else if (putScore > callScore * dominanceThreshold && putScore > 60) {
      type = "PUT";
      reason = isEMARejection ? "Rejeição EMA (Contexto Ideal)" : "Tendência Progressiva";
    } else if (isTooFarFromEMA && !isEMARejection) {
      reason = "Bloqueio: Movimento muito esticado";
    } else if (isHighExhaustion) {
      reason = "Bloqueio: Exaustão elevada";
    } else {
      reason = `Sinal Fraco (Dominância < ${dominanceThreshold}x)`;
    }
  } else {
    reason = isLowVol ? "Mercado Choppy (V-Low Profile)" : "Mercado Choppy (Lateralização)";
  }

  // 9. CONTEXTUAL CONFIDENCE (0% - 95%) - MORE GRADUAL
  let confidence = 0;
  const penaltyReasons: string[] = [];

  if (type !== "NEUTRAL") {
    let conf = 88; 
    
    if (trendFreshnessScore < 7) {
      conf -= (7 - trendFreshnessScore) * 6; // Softer degradation
      penaltyReasons.push("Tendência Madura");
    }
    if (timingScore < 6) {
      conf -= (6 - timingScore) * 8;
      penaltyReasons.push("Ajuste de Timing");
    }
    if (emaDist > 1.0) {
      conf -= (emaDist - 1.0) * 10;
      penaltyReasons.push("Afastamento EMA");
    }
    if (adx < 25) {
      conf -= 5;
      penaltyReasons.push("Força Moderada");
    }

    confidence = Math.max(0, Math.min(95, Math.round(conf)));
    
    // REMOVED HARD THRESHOLD (if confidence < 78) as requested
  }

  return {
    type,
    confidence,
    indicators: {
      emaFast,
      emaSlow,
      rsi,
      adx,
      atr,
      macd: macdData,
      bollinger: bb,
      score: type === "CALL" ? callScore : putScore,
      confidence,
      marketCondition,
      callScore,
      putScore,
      scoreDiff,
      candleStrength: Number((bodySize / avgBodySize).toFixed(2)),
      lastCandlesDirection: last8.map(c => c.close > c.open ? "UP" : "DOWN"),
      reason,
      exhaustionScore: Number(exhaustionScore.toFixed(2)),
      emaDistanceNormalized: Number(emaDist.toFixed(2)),
      trendFreshnessScore: Number(trendFreshnessScore.toFixed(2)),
      entryTimingScore: Number(timingScore.toFixed(2)),
      lateEntryDetected,
      saturationDetected: isSaturated,
      timingQuality: Number(timingScore.toFixed(2)),
      confidencePenaltyReasons: penaltyReasons,
      exhaustionPenalty: isHighExhaustion ? 18 : (isSaturated ? 10 : 0),
      emaStretchLevel: Number(emaDist.toFixed(2)),
      entryDelayRisk: consecutiveCount > 4 ? (consecutiveCount - 4) * 5 : 0,
      consecutiveCandles: consecutiveCount,
      isExhausted: isHighExhaustion || isSaturated,
      blockedReason: type === "NEUTRAL" ? reason : "",
      // New Auditor Logs
      volatilityProfile: volProfile,
      adaptiveThresholds: { adx: adxThreshold, alternations: alternationLimit, emaSlope: emaSlopeThreshold },
      confidenceBeforePenalty: 88,
      totalPenaltyApplied: 88 - (type === "NEUTRAL" ? 0 : confidence)
    }
  };
};

const getDefaultIndicators = (): StrategyIndicators => ({
  emaFast: 0,
  emaSlow: 0,
  rsi: 50,
  adx: 0,
  atr: 0,
  score: 0,
  confidence: 0,
  marketCondition: "UNKNOWN"
});
