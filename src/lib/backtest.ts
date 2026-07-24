import { Candle } from "../types";
import { StrategyProfile, StrategyProfileConfig } from "../types";
import { analyzeMarket } from "./strategy";
import {
  createStructureState,
  evaluateStructure,
  recordStructureTrade,
  recordStructureResult,
  isBlockedByStructure,
} from "./marketStructure";

export interface BacktestConfig {
  stake: number;
  stopLoss: number;
  targetProfit: number;
  minConfidence: number;
  cooldownSeconds: number;
  cooldownAfterLoss: number;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  useSoros: boolean;
  maxSorosLevels: number;
  maxConsecutiveLosses: number;
  strategyProfile: StrategyProfile;
  payoutRate: number; // 0.0–1.0 (ex: 0.92 = 92%)
  /** Fase 3.3 — sobrepõe campos da config do perfil (ex.: minWinScore,
   *  dominanceMultiplier) só para este backtest, para a varredura de
   *  parâmetros. Nunca usado pelo motor ao vivo. */
  strategyConfigOverride?: Partial<StrategyProfileConfig>;
}

export interface BacktestTrade {
  index: number;
  type: "CALL" | "PUT";
  stake: number;
  result: "WON" | "LOST";
  profit: number;
  balance: number;
  confidence: number;
  martingaleStep: number;
}

export interface BacktestResult {
  // Volume
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  // P&L
  netPnL: number;
  finalBalance: number;
  roi: number;
  // Risco
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxStake: number;
  avgStake: number;
  // Sequências
  bestStreak: number;
  worstStreak: number;
  // Paragem
  stoppedBy: "target" | "stoploss" | "end" | "no_signals";
  stoppedAtTrade: number;
  // Curvas para gráfico
  balanceCurve: { index: number; balance: number }[];
  stakeCurve: { index: number; stake: number }[];
  // Trades individuais
  trades: BacktestTrade[];
  // Comparação sem gestão de risco
  flatResult: { wins: number; losses: number; netPnL: number; winRate: number };
}

/**
 * Fase 2 da auditoria: esta função foi reescrita para espelhar 1:1 a
 * cadeia de filtros de useTradingEngine.ts (motor ao vivo), incluindo:
 *  - avaliação de estrutura de mercado em TODOS os candles (não só nos
 *    que geram trade), via o módulo partilhado lib/marketStructure.ts;
 *  - bloqueio pós-perda (mesma direcção + mesma estrutura);
 *  - freshness com o "modo-aware" (isMR) exactamente como ao vivo —
 *    incluindo o facto de, hoje, essa condição nunca ser verdadeira
 *    (ver nota no relatório da Fase 2: o texto procurado no reason não
 *    bate certo com o que strategy.ts realmente produz). Mantido
 *    idêntico de propósito, para o backtest reflectir o comportamento
 *    REAL actual, não uma versão já corrigida;
 *  - cooldown por tempo real entre trades (cooldownSeconds), usando o
 *    timestamp de cada candle como proxy do "agora" que existiria ao vivo;
 *  - cooldown pós-N-perdas-consecutivas (cooldownAfterLoss), com o mesmo
 *    relógio (lastActionTime) que o cooldown normal — tal como ao vivo.
 */
export function runBacktest(
  candles: Candle[],
  symbol: string,
  config: BacktestConfig,
  initialBalance = 1000
): BacktestResult {
  const {
    stake: baseStake,
    stopLoss, targetProfit, minConfidence,
    cooldownSeconds, cooldownAfterLoss,
    useMartingale, martingaleMultiplier, maxMartingaleSteps,
    useSoros, maxSorosLevels,
    maxConsecutiveLosses, strategyProfile, payoutRate, strategyConfigOverride,
  } = config;

  // Estado da simulação
  let balance = initialBalance;
  let currentStake = baseStake;
  let consecutiveLosses = 0;
  let martingaleStep = 0;
  let sorosLevel = 0;
  let peakBalance = initialBalance;
  let lastActionTime = 0; // ms — 0 imita o useRef(0) inicial ao vivo

  // Estrutura de mercado — mesma lógica partilhada com o motor ao vivo
  const structureState = createStructureState();
  let candlesSinceLastLoss = 0; // só para paridade estrutural; não filtra decisões (também não filtra ao vivo)

  // Métricas
  let wins = 0;
  let losses = 0;
  let totalStake = 0;
  let maxStake = 0;
  let maxDrawdown = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  let worstStreak = 0;
  let currentStreakType: "WIN" | "LOSS" | null = null;
  let stoppedBy: BacktestResult["stoppedBy"] = "end";
  let stoppedAtTrade = 0;

  // Flat (sem Martingale) para comparação
  let flatWins = 0;
  let flatLosses = 0;
  let flatPnL = 0;

  const trades: BacktestTrade[] = [];
  const balanceCurve: BacktestResult["balanceCurve"] = [{ index: 0, balance: initialBalance }];
  const stakeCurve: BacktestResult["stakeCurve"] = [];

  // Mínimo de candles necessários para análise (igual ao mínimo de analyzeMarket)
  const MIN_CANDLES = 50;
  if (candles.length < MIN_CANDLES + 1) {
    return emptyResult("end", initialBalance);
  }

  for (let i = MIN_CANDLES; i < candles.length - 1; i++) {
    // Verificar condições de paragem (equivalente ao useEffect de useRiskManager,
    // que corre sempre que o saldo muda — aqui: no início de cada iteração,
    // reflectindo o saldo resultante do trade anterior)
    const pnl = balance - initialBalance;
    if (pnl >= targetProfit) { stoppedBy = "target"; stoppedAtTrade = trades.length; break; }
    if (pnl <= -stopLoss) { stoppedBy = "stoploss"; stoppedAtTrade = trades.length; break; }

    const slice = candles.slice(0, i + 1);
    const nowMs = candles[i].time * 1000; // proxy do Date.now() ao vivo, usando o tempo real do candle

    const signal = analyzeMarket(slice, symbol, strategyProfile, strategyConfigOverride);

    // evaluateStructure corre em TODOS os candles, tal como ao vivo
    // (antes de qualquer verificação de NEUTRAL/filtros).
    evaluateStructure(structureState, slice, signal);
    if (structureState.lastTradeResult === "LOST") candlesSinceLastLoss += 1;

    if (signal.type === "NEUTRAL") continue;

    // Bloqueio pós-perda: mesma direcção, mesma estrutura
    if (isBlockedByStructure(structureState, signal.type as "CALL" | "PUT")) continue;

    // Freshness "modo-aware" — réplica exacta (incl. bug conhecido) do que
    // useTradingEngine.ts faz hoje. Ver nota no relatório da Fase 2.
    const freshness = signal.indicators.trendFreshnessScore ?? 0;
    const isMR = signal.indicators.reason?.includes("Mean Reversion");
    const freshnessMin = isMR ? 1 : 4;
    if (freshness < freshnessMin) continue;

    if ((signal.indicators.timingQuality ?? 0) < 5) continue;
    if (signal.confidence < minConfidence) continue;

    // Cooldown por tempo real entre trades
    const cooldownRemaining = cooldownSeconds * 1000 - (nowMs - lastActionTime);
    if (cooldownRemaining > 0) continue;

    // Cooldown pós-N-perdas-consecutivas — mesmo relógio (lastActionTime)
    // que o cooldown normal, tal como ao vivo.
    if (consecutiveLosses >= maxConsecutiveLosses) {
      const cooldownMs = cooldownAfterLoss * 1000;
      if (nowMs - lastActionTime < cooldownMs) continue;
      consecutiveLosses = 0;
    }

    // Determinar resultado: compara o close seguinte contra o close de
    // ENTRADA (candle do sinal), não contra o open do próprio candle
    // seguinte. Achado ao analisar dados reais da Fase 3: em candles de
    // 1 tick (open sempre == close, comuns em timeframes de 1s em
    // símbolos que não tickam a cada segundo, ex. R_100), a comparação
    // antiga nunca podia ser verdadeira — dava sempre 0% de acerto,
    // não porque a estratégia seja má, mas porque a métrica em si nunca
    // conseguia registar uma vitória.
    const nextCandle = candles[i + 1];
    const entryClose = candles[i].close;
    const isWin = signal.type === "CALL"
      ? nextCandle.close > entryClose
      : nextCandle.close < entryClose;

    recordStructureTrade(structureState, signal.type as "CALL" | "PUT");
    lastActionTime = nowMs;

    const profit = isWin ? currentStake * payoutRate : -currentStake;
    balance += profit;
    totalStake += currentStake;
    maxStake = Math.max(maxStake, currentStake);

    // Drawdown
    if (balance > peakBalance) peakBalance = balance;
    const drawdown = peakBalance - balance;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    // Flat (stake fixo, sem gestão)
    const flatProfit = isWin ? baseStake * payoutRate : -baseStake;
    flatPnL += flatProfit;
    if (isWin) flatWins++; else flatLosses++;

    // Sequências
    if (currentStreakType === (isWin ? "WIN" : "LOSS")) {
      currentStreak++;
    } else {
      currentStreak = 1;
      currentStreakType = isWin ? "WIN" : "LOSS";
    }
    if (isWin) bestStreak = Math.max(bestStreak, currentStreak);
    else worstStreak = Math.max(worstStreak, currentStreak);

    // Registar trade
    const tradeRecord: BacktestTrade = {
      index: i,
      type: signal.type as "CALL" | "PUT",
      stake: currentStake,
      result: isWin ? "WON" : "LOST",
      profit,
      balance,
      confidence: signal.confidence,
      martingaleStep,
    };
    trades.push(tradeRecord);
    balanceCurve.push({ index: trades.length, balance: Math.round(balance * 100) / 100 });
    stakeCurve.push({ index: trades.length, stake: Math.round(currentStake * 100) / 100 });

    if (isWin) { wins++; } else { losses++; }

    recordStructureResult(structureState, isWin ? "WON" : "LOST");
    if (!isWin) candlesSinceLastLoss = 0;

    // Actualizar stake para próxima operação
    if (isWin) {
      consecutiveLosses = 0;
      if (useSoros) {
        sorosLevel++;
        if (sorosLevel >= maxSorosLevels) {
          currentStake = baseStake;
          sorosLevel = 0;
        } else {
          currentStake = Math.round((currentStake + profit) * 100) / 100;
        }
      } else {
        martingaleStep = 0;
        currentStake = baseStake;
      }
    } else {
      consecutiveLosses++;
      sorosLevel = 0;
      if (useMartingale && martingaleStep < maxMartingaleSteps) {
        martingaleStep++;
        currentStake = Math.round(baseStake * Math.pow(martingaleMultiplier, martingaleStep) * 100) / 100;
      } else {
        martingaleStep = 0;
        currentStake = baseStake;
      }
    }
  }

  if (trades.length === 0) return emptyResult("no_signals", initialBalance);

  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const netPnL = balance - initialBalance;
  const roi = (netPnL / initialBalance) * 100;
  const maxDrawdownPct = peakBalance > 0 ? (maxDrawdown / peakBalance) * 100 : 0;
  const avgStake = totalTrades > 0 ? totalStake / totalTrades : baseStake;
  const flatWinRate = flatWins + flatLosses > 0 ? (flatWins / (flatWins + flatLosses)) * 100 : 0;

  return {
    totalTrades, wins, losses,
    winRate: Math.round(winRate * 10) / 10,
    netPnL: Math.round(netPnL * 100) / 100,
    finalBalance: Math.round(balance * 100) / 100,
    roi: Math.round(roi * 10) / 10,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 10) / 10,
    maxStake: Math.round(maxStake * 100) / 100,
    avgStake: Math.round(avgStake * 100) / 100,
    bestStreak, worstStreak,
    stoppedBy,
    stoppedAtTrade: stoppedAtTrade || totalTrades,
    balanceCurve, stakeCurve, trades,
    flatResult: {
      wins: flatWins, losses: flatLosses,
      netPnL: Math.round(flatPnL * 100) / 100,
      winRate: Math.round(flatWinRate * 10) / 10,
    },
  };
}

function emptyResult(stoppedBy: BacktestResult["stoppedBy"], initialBalance: number): BacktestResult {
  return {
    totalTrades: 0, wins: 0, losses: 0, winRate: 0,
    netPnL: 0, finalBalance: initialBalance, roi: 0,
    maxDrawdown: 0, maxDrawdownPct: 0,
    maxStake: 0, avgStake: 0,
    bestStreak: 0, worstStreak: 0,
    stoppedBy, stoppedAtTrade: 0,
    balanceCurve: [], stakeCurve: [], trades: [],
    flatResult: { wins: 0, losses: 0, netPnL: 0, winRate: 0 },
  };
}
