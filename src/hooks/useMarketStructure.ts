import { useRef } from "react";
import { Candle, TradeSignal } from "../types";
import {
  MarketStructureState,
  StructureEvaluation,
  createStructureState,
  evaluateStructure as evaluateStructurePure,
  recordStructureTrade,
  recordStructureResult,
  resetStructureSession,
} from "../lib/marketStructure";

export type { StructureEvaluation };

export interface MarketStructureRefs {
  lastTradeResultRef: React.MutableRefObject<"WON" | "LOST" | null>;
  lastTradeTypeRef: React.MutableRefObject<"CALL" | "PUT" | null>;
  lastTradeStructureIdRef: React.MutableRefObject<string | null>;
  currentStructureIdRef: React.MutableRefObject<string>;
  currentStructureDirectionRef: React.MutableRefObject<"UP" | "DOWN" | "CHOPPY" | null>;
  candlesSinceLastLossRef: React.MutableRefObject<number>;
}

/**
 * Fase 2 da auditoria: a lógica de decisão (evaluateStructure, etc.) foi
 * extraída para src/lib/marketStructure.ts, para ser partilhada com o
 * backtest (runBacktest). Este hook passou a ser um wrapper fino sobre
 * esse módulo puro — a API pública (as *Ref) mantém-se EXACTAMENTE igual
 * à anterior, para não obrigar a nenhuma alteração em useTradingEngine.ts.
 *
 * Nota: candlesSinceLastLossRef continua a ser mutado directamente por
 * useTradingEngine.ts (`.current += 1`) fora deste hook — por isso fica
 * de fora da sincronização genérica com o state partilhado, exactamente
 * como no comportamento original.
 */
export function useMarketStructure(): MarketStructureRefs & {
  evaluateStructure: (candles: Candle[], analysis: TradeSignal) => StructureEvaluation;
  recordTrade: (type: "CALL" | "PUT") => void;
  recordResult: (result: "WON" | "LOST") => void;
  resetSession: () => void;
} {
  const stateRef = useRef<MarketStructureState>(createStructureState());

  const lastTradeResultRef = useRef(stateRef.current.lastTradeResult);
  const lastTradeTypeRef = useRef(stateRef.current.lastTradeType);
  const lastTradeStructureIdRef = useRef(stateRef.current.lastTradeStructureId);
  const currentStructureIdRef = useRef(stateRef.current.currentStructureId);
  const currentStructureDirectionRef = useRef(stateRef.current.currentStructureDirection);
  const candlesSinceLastLossRef = useRef(stateRef.current.candlesSinceLastLoss);

  // Sincroniza os 5 refs "gerais" a partir do state partilhado.
  // candlesSinceLastLossRef NÃO entra aqui de propósito (ver nota acima).
  const syncGeneralRefs = () => {
    const s = stateRef.current;
    lastTradeResultRef.current = s.lastTradeResult;
    lastTradeTypeRef.current = s.lastTradeType;
    lastTradeStructureIdRef.current = s.lastTradeStructureId;
    currentStructureIdRef.current = s.currentStructureId;
    currentStructureDirectionRef.current = s.currentStructureDirection;
  };

  const evaluateStructure = (candles: Candle[], analysis: TradeSignal): StructureEvaluation => {
    const result = evaluateStructurePure(stateRef.current, candles, analysis);
    syncGeneralRefs();
    return result;
  };

  const recordTrade = (type: "CALL" | "PUT") => {
    recordStructureTrade(stateRef.current, type);
    syncGeneralRefs();
  };

  const recordResult = (result: "WON" | "LOST") => {
    recordStructureResult(stateRef.current, result);
    syncGeneralRefs();
    if (result === "LOST") {
      candlesSinceLastLossRef.current = 0;
    }
  };

  const resetSession = () => {
    resetStructureSession(stateRef.current);
    syncGeneralRefs();
    candlesSinceLastLossRef.current = 0;
  };

  return {
    lastTradeResultRef,
    lastTradeTypeRef,
    lastTradeStructureIdRef,
    currentStructureIdRef,
    currentStructureDirectionRef,
    candlesSinceLastLossRef,
    evaluateStructure,
    recordTrade,
    recordResult,
    resetSession,
  };
}
