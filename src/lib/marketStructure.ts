import { Candle, TradeSignal } from "../types";

/**
 * Lógica pura de "estrutura de mercado" — extraída de useMarketStructure.ts
 * (Fase 2 da auditoria) para que o motor ao vivo e o backtest usem
 * EXACTAMENTE o mesmo código, em vez de duas implementações que podiam
 * divergir com o tempo.
 *
 * useMarketStructure.ts (hook) agora é um wrapper fino sobre este módulo.
 * runBacktest() usa este módulo directamente (sem React).
 */

export interface MarketStructureState {
  lastTradeResult: "WON" | "LOST" | null;
  lastTradeType: "CALL" | "PUT" | null;
  lastTradeStructureId: string | null;
  currentStructureId: string;
  currentStructureDirection: "UP" | "DOWN" | "CHOPPY" | null;
  candlesSinceLastLoss: number;
}

export interface StructureEvaluation {
  wasReset: boolean;
  resetReason: string;
  currentDirection: "UP" | "DOWN" | "CHOPPY";
}

function newStructureId(): string {
  return Math.random().toString(36).substring(7);
}

export function createStructureState(): MarketStructureState {
  return {
    lastTradeResult: null,
    lastTradeType: null,
    lastTradeStructureId: null,
    currentStructureId: newStructureId(),
    currentStructureDirection: null,
    candlesSinceLastLoss: 0,
  };
}

/**
 * Avalia se a estrutura de mercado mudou e MUTA o state recebido.
 * Réplica 1:1 da lógica original de useMarketStructure.evaluateStructure.
 */
export function evaluateStructure(
  state: MarketStructureState,
  candles: Candle[],
  analysis: TradeSignal
): StructureEvaluation {
  const newDir: "UP" | "DOWN" | "CHOPPY" =
    analysis.indicators.marketCondition === "CHOPPY"
      ? "CHOPPY"
      : analysis.indicators.emaFast > analysis.indicators.emaSlow
      ? "UP"
      : "DOWN";

  const last5 = candles.slice(-5);
  const lastCandle = candles[candles.length - 1];

  let shouldReset = false;
  let resetReason = "";

  if (newDir !== state.currentStructureDirection) {
    shouldReset = true;
    resetReason = "Mudança de Direção Dominante";
  } else if (newDir === "UP") {
    const redCount = last5.filter((c) => c.close < c.open).length;
    if (redCount >= 3) {
      shouldReset = true;
      resetReason = "Pullback Estrutural (3+ Red)";
    } else if (lastCandle.close < analysis.indicators.emaSlow) {
      shouldReset = true;
      resetReason = "Quebra de Suporte (EMA Slow)";
    }
  } else if (newDir === "DOWN") {
    const greenCount = last5.filter((c) => c.close > c.open).length;
    if (greenCount >= 3) {
      shouldReset = true;
      resetReason = "Pullback Estrutural (3+ Green)";
    } else if (lastCandle.close > analysis.indicators.emaSlow) {
      shouldReset = true;
      resetReason = "Quebra de Resistência (EMA Slow)";
    }
  }

  if (
    analysis.indicators.marketCondition === "CHOPPY" &&
    state.currentStructureDirection !== "CHOPPY"
  ) {
    shouldReset = true;
    resetReason = "Entrada em Zona de Lateralização";
  }

  if (shouldReset) {
    state.currentStructureId = newStructureId();
    state.currentStructureDirection = newDir;
    if (analysis.indicators) {
      analysis.indicators.structureResetReason = resetReason;
    }
  }

  return { wasReset: shouldReset, resetReason, currentDirection: newDir };
}

/** Regista que um trade foi executado (réplica de recordTrade). */
export function recordStructureTrade(
  state: MarketStructureState,
  type: "CALL" | "PUT"
): void {
  state.lastTradeType = type;
  state.lastTradeStructureId = state.currentStructureId;
}

/** Regista o resultado de um trade liquidado (réplica de recordResult). */
export function recordStructureResult(
  state: MarketStructureState,
  result: "WON" | "LOST"
): void {
  state.lastTradeResult = result;
  if (result === "LOST") {
    state.candlesSinceLastLoss = 0;
  }
}

/** Reseta todos os campos de sessão (réplica de resetSession). */
export function resetStructureSession(state: MarketStructureState): void {
  state.lastTradeResult = null;
  state.lastTradeType = null;
  state.lastTradeStructureId = null;
  state.candlesSinceLastLoss = 0;
  state.currentStructureId = newStructureId();
  state.currentStructureDirection = null;
}

/**
 * Réplica do bloqueio pós-perda usado em useTradingEngine.ts:
 * bloqueia um novo trade se a última operação perdeu, o sinal actual
 * aponta na MESMA direcção, e ainda estamos na MESMA estrutura de mercado.
 */
export function isBlockedByStructure(
  state: MarketStructureState,
  signalType: "CALL" | "PUT"
): boolean {
  return (
    state.lastTradeResult === "LOST" &&
    signalType === state.lastTradeType &&
    state.lastTradeStructureId === state.currentStructureId
  );
}
