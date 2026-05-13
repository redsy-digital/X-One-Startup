import { useRef } from "react";
import { Candle, TradeSignal } from "../types";

export interface MarketStructureRefs {
  lastTradeResultRef: React.MutableRefObject<"WON" | "LOST" | null>;
  lastTradeTypeRef: React.MutableRefObject<"CALL" | "PUT" | null>;
  lastTradeStructureIdRef: React.MutableRefObject<string | null>;
  currentStructureIdRef: React.MutableRefObject<string>;
  currentStructureDirectionRef: React.MutableRefObject<"UP" | "DOWN" | "CHOPPY" | null>;
  candlesSinceLastLossRef: React.MutableRefObject<number>;
}

export interface StructureEvaluation {
  wasReset: boolean;
  resetReason: string;
  currentDirection: "UP" | "DOWN" | "CHOPPY";
}

export function useMarketStructure(): MarketStructureRefs & {
  evaluateStructure: (candles: Candle[], analysis: TradeSignal) => StructureEvaluation;
  isEntryAllowed: (analysis: TradeSignal, minConfidence: number) => boolean;
  recordTrade: (type: "CALL" | "PUT") => void;
  recordResult: (result: "WON" | "LOST") => void;
  resetSession: () => void;
} {
  const lastTradeResultRef = useRef<"WON" | "LOST" | null>(null);
  const lastTradeTypeRef = useRef<"CALL" | "PUT" | null>(null);
  const lastTradeStructureIdRef = useRef<string | null>(null);
  const currentStructureIdRef = useRef<string>(
    Math.random().toString(36).substring(7)
  );
  const currentStructureDirectionRef = useRef<"UP" | "DOWN" | "CHOPPY" | null>(null);
  const candlesSinceLastLossRef = useRef<number>(0);

  /**
   * Avalia se a estrutura de mercado mudou e atualiza os refs.
   * Retorna se houve reset e o motivo.
   */
  const evaluateStructure = (
    candles: Candle[],
    analysis: TradeSignal
  ): StructureEvaluation => {
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

    if (newDir !== currentStructureDirectionRef.current) {
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
      currentStructureDirectionRef.current !== "CHOPPY"
    ) {
      shouldReset = true;
      resetReason = "Entrada em Zona de Lateralização";
    }

    if (shouldReset) {
      currentStructureIdRef.current = Math.random().toString(36).substring(7);
      currentStructureDirectionRef.current = newDir;
      if (analysis.indicators) {
        analysis.indicators.structureResetReason = resetReason;
      }
    }

    return { wasReset: shouldReset, resetReason, currentDirection: newDir };
  };

  /**
   * Verifica se uma entrada é permitida pelas regras de disciplina.
   * Encapsula todos os filtros de disciplina e qualidade de sinal.
   */
  const isEntryAllowed = (
    analysis: TradeSignal,
    minConfidence: number
  ): boolean => {
    if (analysis.type === "NEUTRAL") return false;

    // Disciplina: Bloqueio pós-perda na mesma estrutura
    if (
      lastTradeResultRef.current === "LOST" &&
      analysis.type === lastTradeTypeRef.current &&
      lastTradeStructureIdRef.current === currentStructureIdRef.current
    ) {
      return false;
    }

    // Qualidade do sinal: Freshness
    const freshness = analysis.indicators.trendFreshnessScore || 0;
    if (freshness < 4) return false;

    // Qualidade do sinal: Timing
    const timing = analysis.indicators.timingQuality || 0;
    if (timing < 5) return false;

    // Confiança mínima
    if (analysis.confidence < minConfidence) return false;

    return true;
  };

  /**
   * Registra que um trade foi executado (atualiza refs de disciplina).
   */
  const recordTrade = (type: "CALL" | "PUT") => {
    lastTradeTypeRef.current = type;
    lastTradeStructureIdRef.current = currentStructureIdRef.current;
  };

  /**
   * Registra o resultado de um trade liquidado.
   */
  const recordResult = (result: "WON" | "LOST") => {
    lastTradeResultRef.current = result;
    if (result === "LOST") {
      candlesSinceLastLossRef.current = 0;
    }
  };

  /**
   * Reseta todos os refs de sessão (chamado no start do bot).
   */
  const resetSession = () => {
    lastTradeResultRef.current = null;
    lastTradeTypeRef.current = null;
    lastTradeStructureIdRef.current = null;
    candlesSinceLastLossRef.current = 0;
    currentStructureIdRef.current = Math.random().toString(36).substring(7);
    currentStructureDirectionRef.current = null;
  };

  return {
    lastTradeResultRef,
    lastTradeTypeRef,
    lastTradeStructureIdRef,
    currentStructureIdRef,
    currentStructureDirectionRef,
    candlesSinceLastLossRef,
    evaluateStructure,
    isEntryAllowed,
    recordTrade,
    recordResult,
    resetSession,
  };
}
