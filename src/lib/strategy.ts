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

// Símbolos "low vol" da Deriv (Volatility 10/25/50 + a versão 1s do 10).
// Antes disto era `symbol.includes("10") || ...`, que também batia com
// "R_100" e "1HZ100V" (contêm "10" como substring de "100"), tratando os
// dois índices de maior volatilidade como se fossem de baixa volatilidade.
const LOW_VOL_SYMBOLS = new Set(["R_10", "R_25", "R_50", "1HZ10V"]);

export const STRATEGY_PROFILES: Record<StrategyProfile, StrategyProfileConfig> = {
  conservative: {
    minConfidenceOverride: 74,
    requireTrending: true,
    // minWinScore 60→56, dominanceMultiplier 1.30→1.24: único lever que
    // sobra para aumentar entradas no conservador sem tocar em
    // requireTrending (fica assim por decisão explícita — só tendência
    // confirmada). Continua bem mais seletivo que o balanced (52/1.18) —
    // ponto de partida, validar com "Todos os sinais" antes de confiar.
    dominanceMultiplier: 1.24,
    minWinScore: 56,
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
  profile: StrategyProfile = "balanced",
  configOverride?: Partial<StrategyProfileConfig>
): TradeSignal => {

  if (candles.length < 50) {
    return makeNeutral("Aguardando dados", "CHOPPY");
  }

  // Fase 3, etapa 3.3 — permite sobrepor campos específicos da config do
  // perfil para efeitos de teste/varredura de parâmetros, sem tocar em
  // STRATEGY_PROFILES nem afectar o motor ao vivo (que nunca passa isto).
  const cfg = configOverride ? { ...STRATEGY_PROFILES[profile], ...configOverride } : STRATEGY_PROFILES[profile];
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
  // bodySize/avgBody usavam close-vs-open DENTRO do candle — sempre zero em
  // candles de 1 tick (open===close sempre nesse caso). Redefinido como
  // close-a-close entre candles consecutivos: é o único "corpo" que existe
  // de facto quando cada candle é um único tick, e continua a fazer sentido
  // em candles multi-tick (fica parecido com o antigo, quando open≠close).
  const bodySize   = Math.abs(lastClose - prevCandle.close);
  const avgBody    = (() => {
    const recent = candles.slice(-21);
    let sum = 0;
    for (let i = 1; i < recent.length; i++) sum += Math.abs(recent[i].close - recent[i - 1].close);
    return recent.length > 1 ? sum / (recent.length - 1) : 0;
  })();
  const bbWidth    = (bb.upper - bb.lower) || 0.0001;
  const bbPctB     = (lastClose - bb.lower) / bbWidth;
  const macdHist   = macd.histogram;
  const macdStrong = Math.abs(macdHist) > atr * 0.3;

  // ── Geometria ──────────────────────────────────────────────────────────────
  const isLowVol     = LOW_VOL_SYMBOLS.has(symbol);
  const adxThreshold = isLowVol ? 18 : 25;
  const emaDistPct   = Math.abs(lastClose - emaFast) / (lastClose || 1) * 100;
  // emaDistPct bruto (%) depende muito da escala de volatilidade do símbolo/
  // timeframe — em dados reais de 1s chega a ser 15-70x menor do que os
  // limiares abaixo assumiam (calibrados nalguma sessão a um timeframe mais
  // largo). emaStretch normaliza pelo ATR% da própria série — "quantos ATRs
  // de distância a EMA está o preço" — o que absorve essa diferença de
  // escala sozinho: validado em dados reais dos 7 símbolos + candles
  // sintéticos dos testes, com as MESMAS constantes de sempre (0.28,
  // 0.70-1.40, 2.00) a dar uma distribuição consistente (~12-14% comprimido,
  // ~27% sweet spot, ~23% extremo) em todos, em vez de bloquear 100% nalguns
  // e quase nada noutros. emaDistPct em si fica só para mostrar ao
  // utilizador (reason, emaStretchLevel) — nunca mais é usado em limiar.
  const atrPct       = (atr / (lastClose || 1)) * 100;
  const emaStretch   = atrPct > 0 ? emaDistPct / atrPct : 0;
  // currentDir tinha o mesmo bug (lastClose >= lastOpen, sempre "UP" em
  // candles de 1 tick já que open===close sempre) — corrigido para close
  // deste candle vs close do anterior, coerente com o resto desta correção.
  const currentDir   = lastClose >= prevCandle.close ? "UP" : "DOWN";
  const macdDir      = macdHist > 0 ? "UP" : "DOWN";

  // consecutiveCount/alternations usavam close-vs-open DENTRO do candle —
  // sempre "NEUTRAL"/false em candles de 1 tick, o que fazia o loop de
  // consecutiveCount nunca parar (contava até ao início do array — valores
  // de milhares, alimentando exhaustSc muito acima de qualquer limiar
  // razoável) e alternations ficar sempre 0. Mesma correção: close-a-close
  // entre candles consecutivos.
  let consecutiveCount = 0;
  for (let i = candles.length - 1; i > 0; i--) {
    const c = candles[i], prev = candles[i - 1];
    const d = c.close > prev.close ? "UP" : c.close < prev.close ? "DOWN" : "NEUTRAL";
    if (d === currentDir || d === "NEUTRAL") consecutiveCount++;
    else break;
  }

  const last9 = candles.slice(-9);
  const dirs9: ("UP" | "DOWN")[] = [];
  for (let i = 1; i < last9.length; i++) {
    dirs9.push(last9[i].close >= last9[i - 1].close ? "UP" : "DOWN");
  }
  const alternations = dirs9.filter((d, i) => i > 0 && d !== dirs9[i - 1]).length;

  // ── Condição de mercado ────────────────────────────────────────────────────
  const adxStrong    = adx > adxThreshold;
  const diSep        = Math.abs(plusDI - minusDI) > (isLowVol ? 8 : 15);
  const emaSlope     = Math.abs(emaFast - emaSlow) / (emaSlow || 1) > (isLowVol ? 0.00012 : 0.00025);
  const altLimit     = isLowVol ? 4 : 3;
  const mktCond: "TRENDING" | "CHOPPY" =
    adxStrong && diSep && (emaSlope || adx > 32) && alternations <= altLimit
      ? "TRENDING" : "CHOPPY";

  // ── Modo de sinal ──────────────────────────────────────────────────────────
  // compressedThreshold/trendCompressedThreshold eram isLowVol ? x : y —
  // já não precisam disso: emaStretch (acima) normaliza por ATR, então a
  // mesma constante funciona em qualquer símbolo. Validado nos 7 símbolos
  // reais: ~12-14% dos candles CHOPPY ficam abaixo de 0.28 em todos, contra
  // 100% antes desta mudança (em pelo menos R_10/25/50/75/100).
  const compressedThreshold = 0.28;
  const isSuper      = mktCond === "CHOPPY" && alternations > 5;   // puro ruído
  const isCompressed = mktCond === "CHOPPY" && emaStretch < compressedThreshold;  // sem sinal MR
  const isMR         = mktCond === "CHOPPY" && !isSuper && !isCompressed;
  const isTrend      = mktCond === "TRENDING";
  const signalMode   = isSuper || isCompressed ? "BLOCKED" : isMR ? "MEAN_REVERSION" : "TREND";

  // TRENDING com EMA demasiado comprimida: dados 04/07 mostram 0% WR em EMA < 0.02%
  const trendCompressedThreshold = 0.015;
  const trendCompressed = mktCond === "TRENDING" && emaStretch < trendCompressedThreshold;

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
  // Direcção de cada candle = close deste vs close do anterior (não
  // open-vs-close do próprio candle). Em candles de 1 tick (comum a 1s
  // nativo — cada candle É um tick, logo close sempre igual a open), a
  // versão antiga (`c.close !== c.open`) descartava literalmente todos os
  // candles, deixando "completed" sempre vazio: MR ficava sempre no piso
  // (freshness=0, sempre bloqueado) e TREND sempre no tecto (freshness=10,
  // nunca bloqueado por isto) — explica porque só TREND gerava trades reais
  // em dados de 1s, mesmo com MR a passar pela pontuação.
  const recentCloses = candles.slice(-12, -1).map(c => c.close);
  const completed: ("UP" | "DOWN")[] = [];
  for (let i = 1; i < recentCloses.length; i++) {
    if (recentCloses[i] > recentCloses[i - 1]) completed.push("UP");
    else if (recentCloses[i] < recentCloses[i - 1]) completed.push("DOWN");
    // preço genuinamente igual entre os dois — não conta para nenhum lado
  }
  let trendFreshnessScore: number;

  if (isMR) {
    // MR: quantas das últimas completadas foram na direcção actual?
    // Mais na mesma direcção = mais sobreextendido = setup MR mais forte
    const sameDir = completed.filter(d => d === currentDir).length;
    trendFreshnessScore = Math.min(10, sameDir * 1.4);
  } else {
    // TREND: contar consecutivos na direcção actual (penalizar entradas tardias)
    let consec = 0;
    for (let i = completed.length - 1; i >= 0; i--) {
      if (completed[i] === currentDir) consec++; else break;
    }
    trendFreshnessScore = Math.max(0, 10 - consec * 1.5 * cfg.freshnessWeight);
  }

  // ── Timing (modo-aware) ────────────────────────────────────────────────────
  let timingRaw = 0;
  if (isMR) {
    timingRaw = 6;
    // Sweet spot 0.7-1.4%: dados confirmam 67% WR → bónus máximo
    if (emaStretch >= 0.70 && emaStretch <= 1.40)      timingRaw += 3.5;
    else if (emaStretch >= 0.40 && emaStretch < 0.70)  timingRaw += 1.5;
    else if (emaStretch > 1.40 && emaStretch <= 2.00)  timingRaw -= 1.5;
    else if (emaStretch > 2.00)                         timingRaw -= 2.5;
    // MACD virando contra a dir actual → confirma reversão
    if ((currentDir === "UP" && macdDir === "DOWN") ||
        (currentDir === "DOWN" && macdDir === "UP")) timingRaw += 1.5;
    if (consecutiveCount >= 2) timingRaw += 0.5;
  } else {
    timingRaw = 10;
    if (emaStretch > 0.5)  timingRaw -= 3.0 * cfg.timingWeight;
    if (emaStretch > 1.0)  timingRaw -= 2.0 * cfg.timingWeight;
    if (emaStretch < 0.05) timingRaw += 1.5;
    if (consecutiveCount >= 5) timingRaw -= 2.0;
    if (macdDir === currentDir) timingRaw += 1.5;
  }
  const timingScore = Math.max(0, Math.min(10, timingRaw));
  const lateEntry   = isTrend && timingScore < 4;

  // ── Exaustão ───────────────────────────────────────────────────────────────
  // accel usava prevCandle.close-prevCandle.open (sempre zero em 1 tick).
  // Corrigido: compara o "corpo" deste candle (bodySize, já close-a-close)
  // com o do candle anterior (close dele vs o candle antes desse).
  const prevPrevCandle = candles[candles.length - 3];
  const prevBodySize   = prevPrevCandle ? Math.abs(prevCandle.close - prevPrevCandle.close) : 0;
  const accel          = bodySize / (prevBodySize || 0.0001);
  const exhaustSc     = consecutiveCount * 2 + emaStretch * 1.5 + (accel > 2.5 ? 2.5 : 0);
  const isExhausted   = exhaustSc > cfg.maxExhaustionScore * 1.4;

  // ── Scoring ────────────────────────────────────────────────────────────────
  let callScore = 0, putScore = 0;
  let reason = "";

  if (isMR) {
    // ── MR: apostar CONTRA a direcção actual ─────────────────────────────
    // Base + bónus pelo sweet spot de EMA (67% WR confirmado nos dados reais)
    const emaBonus = emaStretch >= 0.70 && emaStretch <= 1.40 ? 28
                   : emaStretch >= 0.40 && emaStretch < 0.70  ? 12
                   : emaStretch > 1.40  && emaStretch <= 2.00 ? 5
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
      reason    = `MR: Reversão ↓ (stretch ${emaStretch.toFixed(2)}x ATR)`;
    } else {
      callScore = total;
      reason    = `MR: Reversão ↑ (stretch ${emaStretch.toFixed(2)}x ATR)`;
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
  // Confiança = taxa de acerto REAL validada por modo, não uma fórmula de
  // bónus por feature. Testámos formalmente (separação treino/validação
  // cronológica, nunca misturando dados de validação no ajuste): nem o score
  // agregado nem nenhuma feature individual (RSI, ADX, timing, freshness,
  // exaustão, força do candle, etc.) previu resultado de forma que se
  // mantivesse fora da amostra de treino — a correlação mais forte fora da
  // amostra foi 0.077 (candleStrength, TREND), fraca demais para servir de
  // base a um número por trade. A fórmula anterior (bónus por feature,
  // calibrada à mão numa sessão de poucos trades) media bem no treino e não
  // se sustentava em dados nunca vistos — exactamente o padrão de
  // overfitting que a validação existe para apanhar.
  // Medido em 2836 trades de validação (7 símbolos, 1s, 09/08/2026, já com
  // os bugs de candle de 1 tick desta sessão corrigidos):
  // MR 50.11% (n=2369, ±2.0pp a 95%) · TREND 49.68% (n=467, ±4.5pp a 95%).
  // Reflecte o estado real medido — actualizar quando houver mais dados
  // (ex.: depois da fase de gestão de risco/novos mercados).
  const VALIDATED_WIN_RATE_MR = 50.11;
  const VALIDATED_WIN_RATE_TREND = 49.68;
  const confidence = type === "NEUTRAL" ? 0 : Math.round(isMR ? VALIDATED_WIN_RATE_MR : VALIDATED_WIN_RATE_TREND);

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
      lastCandlesDirection: dirs9,
      reason: `[${signalMode}] ${type === "NEUTRAL" ? (blockedReason || reason) : reason}`,
      exhaustionScore: Number(exhaustSc.toFixed(2)),
      trendFreshnessScore: Number(trendFreshnessScore.toFixed(2)),
      lateEntryDetected: lateEntry,
      saturationDetected: isExhausted,
      timingQuality: Number(timingScore.toFixed(2)),
      confidencePenaltyReasons: [],
      exhaustionPenalty: isExhausted ? 16 : 0,
      emaStretchLevel: Number(emaStretch.toFixed(2)),
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
