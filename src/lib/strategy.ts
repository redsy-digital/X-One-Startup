import {
  Candle, TradeSignal, StrategyIndicators,
  StrategyProfile, StrategyProfileConfig
} from "../types";
import {
  calculateEMA, calculateRSI, calculateADX, calculateATR,
  calculateMACD, calculateBollingerBands
} from "./indicators";

// ─── Perfis ────────────────────────────────────────────────────────────────────
export const STRATEGY_PROFILES: Record<StrategyProfile, StrategyProfileConfig> = {
  conservative: {
    minConfidenceOverride: 78,
    requireTrending: false,        // relaxado: agora usamos mean-reversion também
    dominanceMultiplier: 1.40,
    minWinScore: 72,
    freshnessWeight: 1.5,
    timingWeight: 1.4,
    emaDistWeight: 1.3,
    rsiOverbought: 68,
    rsiOversold: 32,
    maxConsecutiveCandles: 5,
    maxExhaustionScore: 15,
  },
  balanced: {
    minConfidenceOverride: 68,
    requireTrending: false,
    dominanceMultiplier: 1.22,
    minWinScore: 58,
    freshnessWeight: 1.0,
    timingWeight: 1.0,
    emaDistWeight: 1.0,
    rsiOverbought: 72,
    rsiOversold: 28,
    maxConsecutiveCandles: 6,
    maxExhaustionScore: 18,
  },
  aggressive: {
    minConfidenceOverride: 52,
    requireTrending: false,
    dominanceMultiplier: 1.08,
    minWinScore: 42,
    freshnessWeight: 0.6,
    timingWeight: 0.6,
    emaDistWeight: 0.6,
    rsiOverbought: 78,
    rsiOversold: 22,
    maxConsecutiveCandles: 8,
    maxExhaustionScore: 24,
  },
};

// ─── Função principal ──────────────────────────────────────────────────────────
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

  // ── Indicadores base ─────────────────────────────────────────────────────────
  const emaFast      = calculateEMA(closes, 9);
  const emaSlow      = calculateEMA(closes, 21);
  const rsi          = calculateRSI(closes, 14);
  const { adx, plusDI, minusDI } = calculateADX(candles, 14);
  const atr          = calculateATR(candles, 14);
  const macdData     = calculateMACD(closes);      // Fix #11: MACD agora utilizado
  const bb           = calculateBollingerBands(closes, 20, 2); // Bollinger agora utilizado

  const lastCandle   = candles[candles.length - 1];
  const prevCandle   = candles[candles.length - 2];
  const lastClose    = lastCandle.close;
  const lastOpen     = lastCandle.open;
  const bodySize     = Math.abs(lastClose - lastOpen);
  const avgBodySize  = candles.slice(-20).reduce((a, c) => a + Math.abs(c.close - c.open), 0) / 20;

  // ── Perfil do símbolo ────────────────────────────────────────────────────────
  const isLowVol        = symbol.includes("10") || symbol.includes("25") || symbol.includes("50");
  const adxThreshold    = isLowVol ? 18 : 25;
  const alternationLimit= isLowVol ? 4 : 3;

  // ── 1. Condição de mercado ────────────────────────────────────────────────────
  const adxStrong    = adx > adxThreshold;
  const diSeparation = Math.abs(plusDI - minusDI) > (isLowVol ? 8 : 15);
  const emaSlope     = Math.abs(emaFast - emaSlow) / (emaSlow || 1) > (isLowVol ? 0.00012 : 0.00025);
  const last8        = candles.slice(-8);
  const alternations = last8.filter(
    (c, i) => i > 0 && (c.close > c.open) !== (last8[i - 1].close > last8[i - 1].open)
  ).length;
  const marketCondition: "TRENDING" | "CHOPPY" =
    adxStrong && diSeparation && (emaSlope || adx > 32) && alternations <= alternationLimit
      ? "TRENDING" : "CHOPPY";

  // ── 2. Direcção do momento actual ────────────────────────────────────────────
  let consecutiveCount = 0;
  const currentDir = lastClose >= lastOpen ? "UP" : "DOWN";
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    const dir = c.close > c.open ? "UP" : c.close < c.open ? "DOWN" : "NEUTRAL";
    if (dir === currentDir || dir === "NEUTRAL") consecutiveCount++;
    else break;
  }

  // ── 3. Distância EMA e exaustão ───────────────────────────────────────────────
  const emaDist        = Math.abs(lastClose - emaFast) / (atr || 0.0001);
  const emaDistThresh  = isLowVol ? 1.3 : 2.0;
  const isTooFarEMA    = emaDist > emaDistThresh;
  const acceleration   = bodySize / (Math.abs(prevCandle.close - prevCandle.open) || 0.0001);
  const exhaustionScore= consecutiveCount * 2 + emaDist * 2.5 + (acceleration > 2.5 ? 2.5 : 0);
  const isHighExhaustion = exhaustionScore > cfg.maxExhaustionScore
    || consecutiveCount >= cfg.maxConsecutiveCandles;

  // ── 4. Bollinger %B ── onde está o preço dentro das bandas ───────────────────
  // %B = 0 = na banda inferior, %B = 1 = na banda superior, %B = 0.5 = na média
  const bbWidth  = (bb.upper - bb.lower) || 0.0001;
  const bbPctB   = (lastClose - bb.lower) / bbWidth;
  const bbIsNarrow = bbWidth < atr * 1.5; // bandas muito apertadas = pouca volatilidade

  // ── 5. MACD histogram — confirma se momentum está a CRESCER ou DECRESCER ─────
  // Positivo = momentum de alta a crescer, Negativo = momentum de baixa a crescer
  const macdHist     = macdData.histogram;
  const macdTrend    = macdHist > 0 ? "UP" : "DOWN";
  const macdStrong   = Math.abs(macdHist) > (atr * 0.3);

  // ── 6. Detecção de setup de Mean Reversion (novo) ────────────────────────────
  // Quando preço está em extremo de Bollinger + RSI extremo + 4+ candles na mesma dir
  // → alta probabilidade de reversão para a média
  const isMeanReversionSetup =
    !isHighExhaustion &&
    consecutiveCount >= 4 &&
    (
      (currentDir === "UP" && bbPctB > 0.85 && rsi > cfg.rsiOverbought) ||
      (currentDir === "DOWN" && bbPctB < 0.15 && rsi < cfg.rsiOversold)
    );

  // ── 7. Freshness e timing ─────────────────────────────────────────────────────
  let freshness = 10;
  if (consecutiveCount > 3) freshness -= (consecutiveCount - 3) * 1.2 * cfg.freshnessWeight;
  if (emaDist > 1.2) freshness -= (emaDist - 1.2) * 2.5 * cfg.emaDistWeight;
  if (acceleration > 2.2) freshness -= 1.5 * cfg.freshnessWeight;
  const trendFreshnessScore = Math.max(0, Math.min(10, freshness));

  let timingQuality = 10;
  if (emaDist > 1.4) timingQuality -= 3.5 * cfg.timingWeight;
  if (emaDist < 0.5) timingQuality += 1.5;
  if (consecutiveCount >= 5) timingQuality -= 2.5 * cfg.timingWeight;
  if (macdTrend === currentDir) timingQuality += 1.5; // MACD confirma direcção
  const timingScore   = Math.max(0, Math.min(10, timingQuality));
  const lateEntry     = timingScore < 4;

  // ── 8. EMA Rejection ─────────────────────────────────────────────────────────
  const last4 = candles.slice(-4);
  const hadPullback = last4.some((c) =>
    currentDir === "UP" ? c.close < c.open : c.close > c.open
  );
  const touchedEMA = last4.some((c) =>
    Math.abs((currentDir === "UP" ? c.low : c.high) - emaFast) / (atr || 0.0001) < 0.7
  );
  const isEMARejection =
    (hadPullback || isLowVol) && touchedEMA &&
    (currentDir === "UP" ? lastClose > lastOpen : lastClose < lastOpen);

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. SCORING — dois modos: Trend Following e Mean Reversion
  // ─────────────────────────────────────────────────────────────────────────────
  let callScore = 0;
  let putScore  = 0;
  let signalMode: "TREND" | "MEAN_REVERSION" = "TREND";
  let reason = "";

  // ── Modo A: Mean Reversion (nova lógica) ─────────────────────────────────────
  // Opera no mercado CHOPPY usando extremos de preço para entrar contra o movimento
  if (isMeanReversionSetup && marketCondition === "CHOPPY") {
    signalMode = "MEAN_REVERSION";

    if (currentDir === "UP") {
      // Preço muito esticado para cima → apostar na descida (PUT)
      putScore += 55;                        // sinal principal
      if (rsi > cfg.rsiOverbought + 5) putScore += 15;  // RSI muito extremo
      if (bbPctB > 0.92) putScore += 15;    // preço na extremidade da banda
      if (macdHist < 0) putScore += 15;     // MACD confirma perda de momentum
      else callScore += 5;                   // MACD ainda positivo = cautela
      if (adx < adxThreshold) putScore += 8; // mercado sem força direcional
      reason = "Mean Reversion: Extremo Superior";
    } else {
      // Preço muito esticado para baixo → apostar na subida (CALL)
      callScore += 55;
      if (rsi < cfg.rsiOversold - 5) callScore += 15;
      if (bbPctB < 0.08) callScore += 15;
      if (macdHist > 0) callScore += 15;
      else putScore += 5;
      if (adx < adxThreshold) callScore += 8;
      reason = "Mean Reversion: Extremo Inferior";
    }

  // ── Modo B: Trend Following (lógica melhorada) ───────────────────────────────
  } else {
    signalMode = "TREND";

    // EMA crossover — direcção base (reduzido de 50 para 40, mais espaço para confirmações)
    if (emaFast > emaSlow) { callScore += 40; if (lastClose > emaFast) callScore += 8; }
    else { putScore += 40; if (lastClose < emaFast) putScore += 8; }

    // DI — força da tendência
    if (plusDI > minusDI && plusDI > (isLowVol ? 18 : 22)) callScore += 30;
    else if (minusDI > plusDI && minusDI > (isLowVol ? 18 : 22)) putScore += 30;

    // MACD histogram — confirma momentum (novo, era ignorado)
    if (macdHist > 0 && macdStrong) callScore += 22;
    else if (macdHist < 0 && macdStrong) putScore += 22;
    else if (macdHist > 0) callScore += 10;
    else if (macdHist < 0) putScore += 10;

    // RSI — viés direcional (corrigido: agora ADICIONA, não só penaliza)
    // RSI > 50 = momentum bullish; < 50 = momentum bearish
    if (rsi > 58) callScore += 12;
    else if (rsi < 42) putScore += 12;
    else if (rsi > 52) callScore += 5;
    else if (rsi < 48) putScore += 5;

    // RSI extremo: penalizar na direcção do extremo (mean reversion mild)
    if (rsi > cfg.rsiOverbought) callScore -= 8;
    if (rsi < cfg.rsiOversold) putScore -= 8;

    // Bollinger Band position — preço perto da média é bom para trend entry
    if (bbPctB > 0.4 && bbPctB < 0.6) { callScore += 6; putScore += 6; } // perto da média = bom
    if (bbPctB > 0.88) callScore -= 10;   // muito perto da banda superior = risco call
    if (bbPctB < 0.12) putScore -= 10;    // muito perto da banda inferior = risco put

    // EMA Rejection (existente, mantido)
    if (isEMARejection) {
      if (currentDir === "UP") callScore += 22;
      else putScore += 22;
      reason = "Rejeição EMA";
    }

    // Bonus trending forte
    if (marketCondition === "TRENDING" && isLowVol) {
      if (currentDir === "UP") callScore += 10;
      else putScore += 10;
    }

    // Penalizações de exaustão e timing
    if (currentDir === "UP") {
      if (isHighExhaustion) callScore -= 16;
      if (isTooFarEMA) callScore -= 10;
      if (lateEntry) callScore -= 12;
    } else {
      if (isHighExhaustion) putScore -= 16;
      if (isTooFarEMA) putScore -= 10;
      if (lateEntry) putScore -= 12;
    }

    // Bandas de Bollinger muito estreitas = evitar (pouca volatilidade = risco)
    if (bbIsNarrow) { callScore -= 8; putScore -= 8; }

    if (!reason) reason = "Tendência Progressiva";
  }

  // ── 10. Decisão final ────────────────────────────────────────────────────────
  let type: "CALL" | "PUT" | "NEUTRAL" = "NEUTRAL";
  const { dominanceMultiplier, minWinScore } = cfg;
  const scoreDiff = Math.abs(callScore - putScore);

  if (callScore > putScore * dominanceMultiplier && callScore >= minWinScore) {
    type = "CALL";
  } else if (putScore > callScore * dominanceMultiplier && putScore >= minWinScore) {
    type = "PUT";
  } else if (isTooFarEMA && !isEMARejection) {
    reason = "Bloqueio: Movimento esticado";
  } else if (isHighExhaustion) {
    reason = "Bloqueio: Exaustão";
  } else {
    reason = `Sinal fraco — ${profile} (${dominanceMultiplier}x req.)`;
  }

  // ── 11. Confiança (sistema de confirmações, não penalizações) ─────────────────
  // Antes: começava em 88 e só baixava. Agora: começa em base e sobe com confirmações.
  let confidence = 0;
  const penaltyReasons: string[] = [];

  if (type !== "NEUTRAL") {
    const dominantScore = type === "CALL" ? callScore : putScore;
    const weakScore = type === "CALL" ? putScore : callScore;

    // Base proporcional ao score dominante (0-60)
    let conf = Math.min(60, (dominantScore / 130) * 60);

    // Confirmações adicionam confiança
    if (marketCondition === "TRENDING" && signalMode === "TREND") conf += 10;
    if (signalMode === "MEAN_REVERSION") conf += 8; // mean reversion é bom sinal
    if (macdTrend === (type === "CALL" ? "UP" : "DOWN") && macdStrong) conf += 8;
    if (trendFreshnessScore > 7) conf += 5;
    else if (trendFreshnessScore < 4) { conf -= 8; penaltyReasons.push("Freshness baixo"); }
    if (timingScore > 7) conf += 5;
    else if (timingScore < 4) { conf -= 10; penaltyReasons.push("Timing fraco"); }
    if (isEMARejection) conf += 7;
    if (adx > 35) conf += 5;
    if (scoreDiff > 30) conf += 5; // sinal muito claro
    if (lateEntry) { conf -= 8; penaltyReasons.push("Entrada tardia"); }
    if (bbIsNarrow) { conf -= 5; penaltyReasons.push("Volatilidade baixa"); }

    confidence = Math.max(0, Math.min(95, Math.round(conf)));
  }

  return {
    type,
    confidence,
    indicators: {
      emaFast, emaSlow, rsi, adx, atr,
      score: type === "CALL" ? callScore : putScore,
      confidence, marketCondition, callScore, putScore, scoreDiff,
      candleStrength: Number((bodySize / (avgBodySize || 0.0001)).toFixed(2)),
      lastCandlesDirection: last8.map((c) => (c.close > c.open ? "UP" : "DOWN")),
      reason: `[${signalMode}] ${reason}`,
      exhaustionScore: Number(exhaustionScore.toFixed(2)),
      trendFreshnessScore: Number(trendFreshnessScore.toFixed(2)),
      lateEntryDetected: lateEntry,
      saturationDetected: isHighExhaustion,
      timingQuality: Number(timingScore.toFixed(2)),
      confidencePenaltyReasons: penaltyReasons,
      exhaustionPenalty: isHighExhaustion ? 16 : 0,
      emaStretchLevel: Number(emaDist.toFixed(2)),
      entryDelayRisk: consecutiveCount > 4 ? (consecutiveCount - 4) * 5 : 0,
      consecutiveCandles: consecutiveCount,
      isExhausted: isHighExhaustion,
      blockedReason: type === "NEUTRAL" ? reason : "",
      volatilityProfile: isLowVol ? "SMOOTH" : "AGGRESSIVE",
      adaptiveThresholds: { adx: adxThreshold, alternations: alternationLimit, emaSlope: 0 },
      confidenceBeforePenalty: confidence,
      totalPenaltyApplied: 0,
    },
  };
};

const getDefaultIndicators = (): StrategyIndicators => ({
  emaFast: 0, emaSlow: 0, rsi: 50, adx: 0, atr: 0,
  score: 0, confidence: 0, marketCondition: "UNKNOWN",
});
