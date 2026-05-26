import { Candle } from "../types";
import { StrategyProfile } from "../types";
import { analyzeMarket } from "./strategy";

export interface BacktestConfig {
  stake: number;
  stopLoss: number;
  targetProfit: number;
  minConfidence: number;
  useMartingale: boolean;
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  useSoros: boolean;
  maxSorosLevels: number;
  maxConsecutiveLosses: number;
  strategyProfile: StrategyProfile;
  payoutRate: number; // 0.0–1.0 (ex: 0.92 = 92%)
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

export function runBacktest(
  candles: Candle[],
  symbol: string,
  config: BacktestConfig,
  initialBalance = 1000
): BacktestResult {
  const {
    stake: baseStake,
    stopLoss, targetProfit, minConfidence,
    useMartingale, martingaleMultiplier, maxMartingaleSteps,
    useSoros, maxSorosLevels,
    maxConsecutiveLosses, strategyProfile, payoutRate,
  } = config;

  // Estado da simulação
  let balance = initialBalance;
  let currentStake = baseStake;
  let consecutiveLosses = 0;
  let martingaleStep = 0;
  let sorosLevel = 0;
  let peakBalance = initialBalance;

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

  // Mínimo de candles necessários para análise
  const MIN_CANDLES = 50;
  if (candles.length < MIN_CANDLES + 1) {
    return emptyResult("end", initialBalance);
  }

  for (let i = MIN_CANDLES; i < candles.length - 1; i++) {
    // Verificar condições de paragem
    const pnl = balance - initialBalance;
    if (pnl >= targetProfit) { stoppedBy = "target"; stoppedAtTrade = trades.length; break; }
    if (pnl <= -stopLoss) { stoppedBy = "stoploss"; stoppedAtTrade = trades.length; break; }

    // Cooldown pós-perdas consecutivas
    if (consecutiveLosses >= maxConsecutiveLosses) {
      consecutiveLosses = 0; // reseta e continua
    }

    // Analisar sinal
    const slice = candles.slice(0, i + 1);
    const signal = analyzeMarket(slice, symbol, strategyProfile);

    if (signal.type === "NEUTRAL" || signal.confidence < minConfidence) continue;

    // Filtro de freshness e timing (replicar engine real)
    if ((signal.indicators.trendFreshnessScore ?? 0) < 4) continue;
    if ((signal.indicators.timingQuality ?? 0) < 5) continue;

    // Determinar resultado: usa a DIRECÇÃO do próximo candle
    const nextCandle = candles[i + 1];
    const isWin = signal.type === "CALL"
      ? nextCandle.close > nextCandle.open
      : nextCandle.close < nextCandle.open;

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

    // Actualizar stake para próxima operação
    if (isWin) {
      consecutiveLosses = 0;
      if (useSoros) {
        sorosLevel++;
        if (sorosLevel >= maxSorosLevels) {
          currentStake = baseStake;
          sorosLevel = 0;
        } else {
          currentStake = currentStake + profit;
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
        currentStake = baseStake * Math.pow(martingaleMultiplier, martingaleStep);
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
