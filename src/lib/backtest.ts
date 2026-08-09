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
  // Duração do contrato em ticks — mesmo campo que o motor ao vivo usa em
  // getPriceProposal. Assume 1 candle = 1 tick (verdade em dados nativos
  // de 1s, como os que "Baixar histórico real" produz); num dataset já
  // reamostrado para candles mais largos, este número deixa de corresponder
  // a ticks reais — resultado ainda válido como "N candles à frente", só
  // não é literalmente "N ticks" nesse caso.
  contractDurationTicks: number;
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

// Duas visões do MESMO dataset, computadas numa única passagem:
//  - session:    pára no 1º Take Profit/Stop Loss, como uma sessão real ao
//                vivo pararia (útil para "como teria corrido a sessão").
//  - allSignals: ignora esse limite, simula o dataset inteiro — útil para
//                contar quantos sinais/entradas a estratégia gera de facto
//                num lote grande, sem a contagem morrer no 1º TP/SL.
export interface BacktestRunResult {
  session: BacktestResult;
  allSignals: BacktestResult;
}

/**
 * Fase 2 da auditoria: esta função foi reescrita para espelhar 1:1 a
 * cadeia de filtros de useTradingEngine.ts (motor ao vivo), incluindo:
 *  - avaliação de estrutura de mercado em TODOS os candles (não só nos
 *    que geram trade), via o módulo partilhado lib/marketStructure.ts;
 *  - bloqueio pós-perda (mesma direcção + mesma estrutura);
 *  - freshness com o "modo-aware" (isMR) exactamente como ao vivo —
 *    corrigido para detectar correctamente o modo Mean Reversion (antes
 *    procurava "Mean Reversion" no reason, mas strategy.ts produz
 *    "[MEAN_REVERSION]"; a comparação nunca batia e todo sinal MR usava
 *    o freshnessMin de 4 em vez de 1). Corrigido aqui e em
 *    useTradingEngine.ts ao mesmo tempo, para manter a paridade;
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
): BacktestRunResult {
  const {
    stake: baseStake,
    stopLoss, targetProfit, minConfidence,
    cooldownSeconds, cooldownAfterLoss,
    useMartingale, martingaleMultiplier, maxMartingaleSteps,
    useSoros, maxSorosLevels,
    maxConsecutiveLosses, strategyProfile, payoutRate, strategyConfigOverride,
    contractDurationTicks,
  } = config;

  // Estado da simulação
  let balance = initialBalance;
  let currentStake = baseStake;
  let consecutiveLosses = 0;
  let martingaleStep = 0;
  let sorosLevel = 0;
  let lastActionTime = 0; // ms — 0 imita o useRef(0) inicial ao vivo

  // Estrutura de mercado — mesma lógica partilhada com o motor ao vivo
  const structureState = createStructureState();
  let candlesSinceLastLoss = 0; // só para paridade estrutural; não filtra decisões (também não filtra ao vivo)

  const trades: BacktestTrade[] = [];

  // Ponto em que uma sessão real teria parado (1º Take Profit/Stop Loss).
  // NÃO interrompe o loop — só regista, para a simulação continuar até ao
  // fim do dataset e dar a visão "todos os sinais" na mesma passagem.
  let sessionStopIndex: number | null = null;
  let sessionStoppedBy: BacktestResult["stoppedBy"] = "end";

  // Mínimo de candles necessários para análise (igual ao mínimo de analyzeMarket)
  const MIN_CANDLES = 50;
  // Defensivo: configs antigas sem este campo (ou 0/negativo) caem para 1
  // candle à frente — o comportamento que sempre existiu antes desta opção.
  const ticksAhead = contractDurationTicks && contractDurationTicks > 0 ? contractDurationTicks : 1;
  if (candles.length < MIN_CANDLES + ticksAhead) {
    const empty = emptyResult("end", initialBalance);
    return { session: empty, allSignals: empty };
  }

  for (let i = MIN_CANDLES; i < candles.length - ticksAhead; i++) {
    // Verificar se uma sessão real já teria parado aqui (só regista a 1ª vez)
    if (sessionStopIndex === null) {
      const pnl = balance - initialBalance;
      if (pnl >= targetProfit) { sessionStopIndex = trades.length; sessionStoppedBy = "target"; }
      else if (pnl <= -stopLoss) { sessionStopIndex = trades.length; sessionStoppedBy = "stoploss"; }
    }

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

    // Freshness "modo-aware" — réplica exacta do que useTradingEngine.ts faz.
    const freshness = signal.indicators.trendFreshnessScore ?? 0;
    const isMR = signal.indicators.reason?.includes("MEAN_REVERSION");
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
    // seguinte (achado da Fase 3 — ver histórico do relatório de auditoria).
    const nextCandle = candles[i + ticksAhead];
    const entryClose = candles[i].close;
    const isWin = signal.type === "CALL"
      ? nextCandle.close > entryClose
      : nextCandle.close < entryClose;

    recordStructureTrade(structureState, signal.type as "CALL" | "PUT");
    lastActionTime = nowMs;

    const profit = isWin ? currentStake * payoutRate : -currentStake;
    balance += profit;

    // Registar trade
    trades.push({
      index: i,
      type: signal.type as "CALL" | "PUT",
      stake: currentStake,
      result: isWin ? "WON" : "LOST",
      profit,
      balance,
      confidence: signal.confidence,
      martingaleStep,
    });

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

  if (trades.length === 0) {
    const empty = emptyResult("no_signals", initialBalance);
    return { session: empty, allSignals: empty };
  }

  const sessionTrades = sessionStopIndex !== null ? trades.slice(0, sessionStopIndex) : trades;
  const session = sessionTrades.length > 0
    ? summarize(sessionTrades, initialBalance, baseStake, payoutRate, sessionStoppedBy)
    : emptyResult(sessionStoppedBy, initialBalance);
  const allSignals = summarize(trades, initialBalance, baseStake, payoutRate, "end");

  return { session, allSignals };
}

// Deriva um BacktestResult completo (P&L, drawdown, sequências, flatResult,
// curvas) a partir de uma lista de trades já simulados. Usado duas vezes por
// runBacktest — uma para a fatia "sessão" (até ao TP/SL), outra para o
// array inteiro ("todos os sinais") — sem repetir a simulação em si.
function summarize(
  trades: BacktestTrade[],
  initialBalance: number,
  baseStake: number,
  payoutRate: number,
  stoppedBy: BacktestResult["stoppedBy"],
): BacktestResult {
  if (trades.length === 0) return emptyResult(stoppedBy, initialBalance);

  let totalStake = 0;
  let maxStake = 0;
  let peakBalance = initialBalance;
  let maxDrawdown = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  let worstStreak = 0;
  let currentStreakType: "WIN" | "LOSS" | null = null;
  let wins = 0;
  let losses = 0;
  let flatWins = 0;
  let flatLosses = 0;
  let flatPnL = 0;

  const balanceCurve: BacktestResult["balanceCurve"] = [{ index: 0, balance: initialBalance }];
  const stakeCurve: BacktestResult["stakeCurve"] = [];

  for (let k = 0; k < trades.length; k++) {
    const t = trades[k];
    totalStake += t.stake;
    maxStake = Math.max(maxStake, t.stake);

    if (t.balance > peakBalance) peakBalance = t.balance;
    const drawdown = peakBalance - t.balance;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    const isWin = t.result === "WON";
    const flatProfit = isWin ? baseStake * payoutRate : -baseStake;
    flatPnL += flatProfit;
    if (isWin) flatWins++; else flatLosses++;
    if (isWin) wins++; else losses++;

    if (currentStreakType === (isWin ? "WIN" : "LOSS")) {
      currentStreak++;
    } else {
      currentStreak = 1;
      currentStreakType = isWin ? "WIN" : "LOSS";
    }
    if (isWin) bestStreak = Math.max(bestStreak, currentStreak);
    else worstStreak = Math.max(worstStreak, currentStreak);

    balanceCurve.push({ index: k + 1, balance: Math.round(t.balance * 100) / 100 });
    stakeCurve.push({ index: k + 1, stake: Math.round(t.stake * 100) / 100 });
  }

  const totalTrades = trades.length;
  const finalBalance = trades[trades.length - 1].balance;
  const netPnL = finalBalance - initialBalance;
  const winRate = (wins / totalTrades) * 100;
  const roi = (netPnL / initialBalance) * 100;
  const maxDrawdownPct = peakBalance > 0 ? (maxDrawdown / peakBalance) * 100 : 0;
  const avgStake = totalStake / totalTrades;
  const flatWinRate = flatWins + flatLosses > 0 ? (flatWins / (flatWins + flatLosses)) * 100 : 0;

  return {
    totalTrades, wins, losses,
    winRate: Math.round(winRate * 10) / 10,
    netPnL: Math.round(netPnL * 100) / 100,
    finalBalance: Math.round(finalBalance * 100) / 100,
    roi: Math.round(roi * 10) / 10,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 10) / 10,
    maxStake: Math.round(maxStake * 100) / 100,
    avgStake: Math.round(avgStake * 100) / 100,
    bestStreak, worstStreak,
    stoppedBy,
    stoppedAtTrade: totalTrades,
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
