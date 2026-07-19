/**
 * X-ONE Strategy v4 — Data-driven
 *
 * Findings from 01/07/2026 session (22 trades):
 * - EMA 0.7-1.4% in CHOPPY → 67% WR  ← sweet spot
 * - EMA < 0.35% in CHOPPY  → 0%  WR  ← block
 * - TREND mode in CHOPPY   → 41% WR  ← problem fixed here
 * - MR mode NEVER triggered (RSI>72 AND BB>0.85 too strict)
 *
 * Fix: In CHOPPY, ALWAYS use Mean Reversion (bet against direction).
 */

import {
  Candle, TradeSignal, StrategyIndicators,
  StrategyProfile, StrategyProfileConfig
} from "../types";
import {
  calculateEMA, calculateRSI, calculateADX, calculateATR,
  calculateMACD, calculateBollingerBands
} from "./indicators";

export const STRATEGY_PROFILES: Record<StrategyProfile, StrategyProfileConfig> = {
  conservative: {
    minConfidenceOverride: 74,
    requireTrending: true,
    dominanceMultiplier: 1.30,
    minWinScore: 60,
    freshnessWeight: 1.2,
    timingWeight: 1.2,
    emaDistWeight: 1.0,
    rsiOverbought: 62,
    rsiOversold: 38,
    maxConsecutiveCandles: 4,
    maxExhaustionScore: 14,
  },
  balanced: {
    minConfidenceOverride: 63,
    requireTrending: false,
    dominanceMultiplier: 1.18,
    minWinScore: 52,
    freshnessWeight: 1.0,
    timingWeight: 1.0,
    emaDistWeight: 1.0,
    rsiOverbought: 65,
    rsiOversold: 35,
    maxConsecutiveCandles: 5,
    maxExhaustionScore: 18,
  },
  aggressive: {
    minConfidenceOverride: 52,
    requireTrending: false,
    dominanceMultiplier: 1.08,
    minWinScore: 40,
    freshnessWeight: 0.7,
    timingWeight: 0.7,
    emaDistWeight: 0.7,
    rsiOverbought: 70,
    rsiOversold: 30,
    maxConsecutiveCandles: 7,
    maxExhaustionScore: 22,
  },
};

export const analyzeMarket = (
  candles: Candle[],
  symbol: string = "R_100",
  profile: StrategyProfile = "balanced"
): TradeSignal => {

  if (candles.length < 50) {
    return makeNeutral("Aguardando dados", "CHOPPY");
  }

  const cfg = STRATEGY_PROFILES[profile];
  const closes = candles.map(c => c.close);
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];

  // ── Indicadores ────────────────────────────────────────────────────────────
  const emaFast = calculateEMA(closes, 9);
  const emaSlow = calculateEMA(closes, 21);
  const rsi     = calculateRSI(closes, 14);
  const { adx, plusDI, minusDI } = calculateADX(candles, 14);
  const atr     = calculateATR(candles, 14);
  const macd    = calculateMACD(closes);
  const bb      = calculateBollingerBands(closes, 20, 2);

  const lastClose  = lastCandle.close;
  const lastOpen   = lastCandle.open;
  const bodySize   = Math.abs(lastClose - lastOpen);
  const avgBody    = candles.slice(-20).reduce((a, c) => a + Math.abs(c.close - c.open), 0) / 20;
  const bbWidth    = (bb.upper - bb.lower) || 0.0001;
  const bbPctB     = (lastClose - bb.lower) / bbWidth;
  const macdHist   = macd.histogram;
  const macdStrong = Math.abs(macdHist) > atr * 0.3;

  // ── Geometria ──────────────────────────────────────────────────────────────
  const isLowVol     = symbol.includes("10") || symbol.includes("25") || symbol.includes("50");
  const adxThreshold = isLowVol ? 18 : 25;
  const emaDistPct   = Math.abs(lastClose - emaFast) / (lastClose || 1) * 100;
  const currentDir   = lastClose >= lastOpen ? "UP" : "DOWN";
  const macdDir      = macdHist > 0 ? "UP" : "DOWN";

  let consecutiveCount = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    const d = c.close > c.open ? "UP" : c.close < c.open ? "DOWN" : "NEUTRAL";
    if (d === currentDir || d === "NEUTRAL") consecutiveCount++;
    else break;
  }

  const last8        = candles.slice(-8);
  const alternations = last8.filter(
    (c, i) => i > 0 && (c.close > c.open) !== (last8[i-1].close > last8[i-1].open)
  ).length;

  // ── Condição de mercado ────────────────────────────────────────────────────
  const adxStrong    = adx > adxThreshold;
  const diSep        = Math.abs(plusDI - minusDI) > (isLowVol ? 8 : 15);
  const emaSlope     = Math.abs(emaFast - emaSlow) / (emaSlow || 1) > (isLowVol ? 0.00012 : 0.00025);
  const altLimit     = isLowVol ? 4 : 3;
  const mktCond: "TRENDING" | "CHOPPY" =
    adxStrong && diSep && (emaSlope || adx > 32) && alternations <= altLimit
      ? "TRENDING" : "CHOPPY";

  // ── Modo de sinal ──────────────────────────────────────────────────────────
  const isSuper      = mktCond === "CHOPPY" && alternations > 5;   // puro ruído
  const isCompressed = mktCond === "CHOPPY" && emaDistPct < 0.28;  // sem sinal MR
  const isMR         = mktCond === "CHOPPY" && !isSuper && !isCompressed;
  const isTrend      = mktCond === "TRENDING";
  const signalMode   = isSuper || isCompressed ? "BLOCKED" : isMR ? "MEAN_REVERSION" : "TREND";

  // TRENDING com EMA demasiado comprimida: dados 04/07 mostram 0% WR em EMA < 0.02%
  const trendCompressed = mktCond === "TRENDING" && emaDistPct < 0.015;

  // requireTrending (por perfil): implementado de verdade — antes o campo
  // existia na config e era mostrado na UI ("Só opera em TRENDING"), mas
  // nunca era lido aqui, logo não tinha nenhum efeito real.
  const blockedByProfile = cfg.requireTrending && mktCond !== "TRENDING";

  if (signalMode === "BLOCKED" || trendCompressed || blockedByProfile) {
    const msg = blockedByProfile ? "Perfil exige TRENDING (mercado CHOPPY)"
              : isSuper ? "Super-CHOPPY: mercado aleatório"
              : isCompressed ? "EMA comprimida: sem setup MR"
              : "TRENDING comprimido: preço na EMA";
    return makeNeutral(msg, mktCond);
  }

  // ── Freshness (candles COMPLETOS, não o actual em formação) ────────────────
  const completed = candles.slice(-11, -1).filter(c => c.close !== c.open);
  let trendFreshnessScore: number;

  if (isMR) {
    // MR: quantas das 10 últimas completadas foram na direcção actual?
    // Mais na mesma direcção = mais sobreextendido = setup MR mais forte
    const sameDir = completed.filter(c =>
      currentDir === "UP" ? c.close > c.open : c.close < c.open
    ).length;
    trendFreshnessScore = Math.min(10, sameDir * 1.4);
  } else {
    // TREND: contar consecutivos na direcção actual (penalizar entradas tardias)
    let consec = 0;
    for (let i = completed.length - 1; i >= 0; i--) {
      const d = completed[i].close > completed[i].open ? "UP" : "DOWN";
      if (d === currentDir) consec++; else break;
    }
    trendFreshnessScore = Math.max(0, 10 - consec * 1.5 * cfg.freshnessWeight);
  }

  // ── Timing (modo-aware) ────────────────────────────────────────────────────
  let timingRaw = 0;
  if (isMR) {
    timingRaw = 6;
    // Sweet spot 0.7-1.4%: dados confirmam 67% WR → bónus máximo
    if (emaDistPct >= 0.70 && emaDistPct <= 1.40)      timingRaw += 3.5;
    else if (emaDistPct >= 0.40 && emaDistPct < 0.70)  timingRaw += 1.5;
    else if (emaDistPct > 1.40 && emaDistPct <= 2.00)  timingRaw -= 1.5;
    else if (emaDistPct > 2.00)                         timingRaw -= 2.5;
    // MACD virando contra a dir actual → confirma reversão
    if ((currentDir === "UP" && macdDir === "DOWN") ||
        (currentDir === "DOWN" && macdDir === "UP")) timingRaw += 1.5;
    if (consecutiveCount >= 2) timingRaw += 0.5;
  } else {
    timingRaw = 10;
    if (emaDistPct > 0.5)  timingRaw -= 3.0 * cfg.timingWeight;
    if (emaDistPct > 1.0)  timingRaw -= 2.0 * cfg.timingWeight;
    if (emaDistPct < 0.05) timingRaw += 1.5;
    if (consecutiveCount >= 5) timingRaw -= 2.0;
    if (macdDir === currentDir) timingRaw += 1.5;
  }
  const timingScore = Math.max(0, Math.min(10, timingRaw));
  const lateEntry   = isTrend && timingScore < 4;

  // ── Exaustão ───────────────────────────────────────────────────────────────
  const accel         = bodySize / (Math.abs(prevCandle.close - prevCandle.open) || 0.0001);
  const exhaustSc     = consecutiveCount * 2 + emaDistPct * 1.5 + (accel > 2.5 ? 2.5 : 0);
  const isExhausted   = exhaustSc > cfg.maxExhaustionScore * 1.4;

  // ── Scoring ────────────────────────────────────────────────────────────────
  let callScore = 0, putScore = 0;
  let reason = "";

  if (isMR) {
    // ── MR: apostar CONTRA a direcção actual ─────────────────────────────
    // Base + bónus pelo sweet spot de EMA (67% WR confirmado nos dados reais)
    const emaBonus = emaDistPct >= 0.70 && emaDistPct <= 1.40 ? 28
                   : emaDistPct >= 0.40 && emaDistPct < 0.70  ? 12
                   : emaDistPct > 1.40  && emaDistPct <= 2.00 ? 5
                   : 0;

    const rsiBonus = currentDir === "UP"
      ? (rsi > 65 ? 15 : rsi > 58 ? 10 : rsi > 52 ? 5 : 0)
      : (rsi < 35 ? 15 : rsi < 42 ? 10 : rsi < 48 ? 5 : 0);

    const bbBonus = currentDir === "UP"
      ? (bbPctB > 0.75 ? 12 : bbPctB > 0.62 ? 7 : bbPctB > 0.52 ? 3 : 0)
      : (bbPctB < 0.25 ? 12 : bbPctB < 0.38 ? 7 : bbPctB < 0.48 ? 3 : 0);

    const macdBonus = (currentDir === "UP" && macdHist < 0) ||
                      (currentDir === "DOWN" && macdHist > 0) ? 12 : 0;

    const consecBonus = Math.min(10, (consecutiveCount - 1) * 2.5);

    // Penalizar se ADX começar a subir com separação DI (poderá estar a trenar)
    const trendPenalty = adx > 28 && diSep ? 20 : 0;

    const total = 45 + emaBonus + rsiBonus + bbBonus + macdBonus + consecBonus - trendPenalty;

    if (currentDir === "UP") {
      putScore  = total;
      reason    = `MR: Reversão ↓ (EMA+${emaDistPct.toFixed(1)}%)`;
    } else {
      callScore = total;
      reason    = `MR: Reversão ↑ (EMA+${emaDistPct.toFixed(1)}%)`;
    }
  } else {
    // ── TREND mode ─────────────────────────────────────────────────────────
    if (emaFast > emaSlow) { callScore += 40; if (lastClose > emaFast) callScore += 8; }
    else                   { putScore  += 40; if (lastClose < emaFast) putScore  += 8; }

    if (plusDI  > minusDI && plusDI  > (isLowVol ? 18 : 22)) callScore += 30;
    else if (minusDI > plusDI && minusDI > (isLowVol ? 18 : 22)) putScore  += 30;

    if (macdHist > 0 && macdStrong)  callScore += 22;
    else if (macdHist < 0 && macdStrong) putScore  += 22;
    else if (macdHist > 0) callScore += 10;
    else putScore += 10;

    if (rsi > 58) callScore += 12; else if (rsi < 42) putScore += 12;
    if (rsi > cfg.rsiOverbought) callScore -= 8;
    if (rsi < cfg.rsiOversold)   putScore  -= 8;

    if (bbPctB > 0.40 && bbPctB < 0.60) { callScore += 6; putScore += 6; }
    if (bbPctB > 0.88) callScore -= 10;
    if (bbPctB < 0.12) putScore  -= 10;

    if (isExhausted || lateEntry) {
      if (currentDir === "UP")   { callScore -= (isExhausted ? 16 : 0) + (lateEntry ? 12 : 0); }
      else                       { putScore  -= (isExhausted ? 16 : 0) + (lateEntry ? 12 : 0); }
    }
    reason = "Tendência Progressiva";
  }

  // ── Decisão ────────────────────────────────────────────────────────────────
  const { dominanceMultiplier, minWinScore } = cfg;
  let type: "CALL" | "PUT" | "NEUTRAL" = "NEUTRAL";
  let blockedReason = "";

  if (callScore > putScore * dominanceMultiplier && callScore >= minWinScore) {
    type = "CALL";
  } else if (putScore > callScore * dominanceMultiplier && putScore >= minWinScore) {
    type = "PUT";
  } else {
    blockedReason = `Score baixo (${Math.max(callScore, putScore).toFixed(0)}/${minWinScore})`;
  }

  // ── Confiança ──────────────────────────────────────────────────────────────
  let confidence = 0;
  if (type !== "NEUTRAL") {
    if (isMR) {
      // Base calibrada ao sweet spot (67% WR confirmado)
      let conf = 38;
      if (emaDistPct >= 0.70 && emaDistPct <= 1.40)      conf += 22;
      else if (emaDistPct >= 0.40 && emaDistPct < 0.70)  conf +=  8;
      else if (emaDistPct > 1.40 && emaDistPct <= 2.00)  conf -=  5;
      else if (emaDistPct > 2.00)                         conf -=  8;

      const rsiOk  = currentDir === "UP" ? rsi > 58 : rsi < 42;
      const bbOk   = currentDir === "UP" ? bbPctB > 0.62 : bbPctB < 0.38;
      const macdOk = (currentDir === "UP" && macdHist < 0) || (currentDir === "DOWN" && macdHist > 0);

      if (rsiOk)                 conf +=  8;
      if (bbOk)                  conf +=  7;
      if (macdOk && macdStrong)  conf +=  8;
      else if (macdOk)           conf +=  4;
      if (trendFreshnessScore > 5) conf += 4;
      if (timingScore >= 9)      conf +=  5;
      else if (timingScore < 6)  conf -=  6;
      if (consecutiveCount >= 3) conf +=  3;

      confidence = Math.max(0, Math.min(95, Math.round(conf)));
    } else {
      // TREND confidence — calibrada para zona alvo 50-70%
      // Dados 04/07: conf 50-59% → 64% WR; conf 40-49% → 24% WR
      const dom = type === "CALL" ? callScore : putScore;
      let conf = Math.min(55, (dom / 130) * 55); // base ligeiramente mais alta
      if (adx > 30)                                  conf += 10;
      else if (adx > 25)                             conf +=  5;
      if (macdStrong && macdDir === currentDir)      conf +=  8;
      else if (macdDir === currentDir)               conf +=  3;
      if (diSep && adxStrong)                        conf +=  5; // tendência confirmada por DI
      if (trendFreshnessScore > 6)                   conf +=  5;
      else if (trendFreshnessScore < 4)              conf -=  8;
      if (timingScore > 7)                           conf +=  4;
      else if (timingScore < 4)                      conf -= 10;
      if (lateEntry)                                 conf -=  8;
      confidence = Math.max(0, Math.min(95, Math.round(conf)));
    }
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  return {
    type,
    confidence,
    indicators: {
      emaFast, emaSlow, rsi, adx, atr,
      score: Math.max(callScore, putScore),
      confidence,
      marketCondition: mktCond,
      callScore, putScore,
      scoreDiff: Math.abs(callScore - putScore),
      candleStrength: Number((bodySize / (avgBody || 0.0001)).toFixed(2)),
      lastCandlesDirection: last8.map(c => c.close > c.open ? "UP" : "DOWN"),
      reason: `[${signalMode}] ${type === "NEUTRAL" ? (blockedReason || reason) : reason}`,
      exhaustionScore: Number(exhaustSc.toFixed(2)),
      trendFreshnessScore: Number(trendFreshnessScore.toFixed(2)),
      lateEntryDetected: lateEntry,
      saturationDetected: isExhausted,
      timingQuality: Number(timingScore.toFixed(2)),
      confidencePenaltyReasons: [],
      exhaustionPenalty: isExhausted ? 16 : 0,
      emaStretchLevel: Number(emaDistPct.toFixed(2)),
      entryDelayRisk: consecutiveCount > 4 ? (consecutiveCount - 4) * 5 : 0,
      consecutiveCandles: consecutiveCount,
      isExhausted,
      blockedReason: type === "NEUTRAL" ? (blockedReason || reason) : "",
      volatilityProfile: isLowVol ? "SMOOTH" : "AGGRESSIVE",
      adaptiveThresholds: { adx: adxThreshold, alternations: altLimit, emaSlope: 0 },
      confidenceBeforePenalty: confidence,
      totalPenaltyApplied: 0,
    },
  };
};

function makeNeutral(reason: string, mktCond: string): TradeSignal {
  return {
    type: "NEUTRAL",
    confidence: 0,
    indicators: {
      emaFast: 0, emaSlow: 0, rsi: 50, adx: 0, atr: 0,
      score: 0, confidence: 0,
      marketCondition: mktCond as any,
      reason: `[BLOCKED] ${reason}`,
    } as StrategyIndicators,
  };
}
