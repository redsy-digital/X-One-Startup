import { useState, useEffect, useCallback, useRef } from "react";
import { derivService } from "../lib/deriv";
import { analyzeMarket } from "../lib/strategy";
import { saveTrade } from "../lib/storage";
import { Candle, TradeSignal, StrategyProfile } from "../types";
import { useMarketStructure } from "./useMarketStructure";

interface TradingEngineConfig {
  symbol: string;
  candles: Candle[];
  currentStake: number;
  stake: number;
  minConfidence: number;
  cooldownSeconds: number;
  strategyProfile: StrategyProfile;
  maxConsecutiveLosses: number;
  cooldownAfterLoss: number;
  isBotRunning: boolean;
  isAuthorized: boolean;
  onWin: (profit: number) => void;
  onLoss: () => void;
  onForceStop: (reason: string) => void;
}

interface SessionStats {
  wins: number;
  losses: number;
  consecutiveLosses: number;
}

interface TradingEngineResult {
  lastSignal: TradeSignal | null;
  sessionStats: SessionStats;
  error: string | null;
  isProcessing: boolean;
  placeTrade: (type: "CALL" | "PUT") => void;
  currentStructureId: string;
}

export function useTradingEngine(
  config: TradingEngineConfig,
  isBotRunningRef: React.MutableRefObject<boolean>
): TradingEngineResult {
  const {
    symbol, candles, currentStake, stake,
    minConfidence, cooldownSeconds,
    strategyProfile, maxConsecutiveLosses, cooldownAfterLoss,
    isBotRunning, isAuthorized,
    onWin, onLoss, onForceStop,
  } = config;

  const [lastSignal, setLastSignal] = useState<TradeSignal | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats>({ wins: 0, losses: 0, consecutiveLosses: 0 });
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const isProcessingTradeRef = useRef(false);
  const lastActionTimeRef = useRef(0);
  const lastCandleTimeRef = useRef(0);
  const lastSignalRef = useRef<TradeSignal | null>(null);
  const consecutiveLossesRef = useRef(0);
  const cooldownAfterLossRef = useRef(cooldownAfterLoss);
  useEffect(() => { cooldownAfterLossRef.current = cooldownAfterLoss; }, [cooldownAfterLoss]);

  const structure = useMarketStructure();
  useEffect(() => { lastSignalRef.current = lastSignal; }, [lastSignal]);

  // ── Safety timeout — CORRIGIDO: usa isProcessing (state), não ref ────────
  // React não rastreia mudanças em refs no dependency array.
  // Com ref: o timeout NUNCA disparava → isProcessingTradeRef ficava stuck em true
  // → engine saía cedo → setLastSignal nunca chamado → UI congelava.
  useEffect(() => {
    if (!isProcessing) return;
    const t = setTimeout(() => {
      console.warn("[TradingEngine] Trade stuck — resetting.");
      isProcessingTradeRef.current = false;
      setIsProcessing(false);
      setError("Timeout: trade sem resposta. Bot a continuar.");
    }, 15000);
    return () => clearTimeout(t);
  }, [isProcessing]); // ← STATE, não ref

  // Reset ao parar o bot
  useEffect(() => {
    if (!isBotRunning) {
      isProcessingTradeRef.current = false;
      setIsProcessing(false);
      setError(null);
    }
  }, [isBotRunning]);

  // Trade manual
  const placeTrade = useCallback(
    (type: "CALL" | "PUT") => {
      if (!isAuthorized || isProcessingTradeRef.current) return;
      setError(null);
      isProcessingTradeRef.current = true;
      setIsProcessing(true);
      derivService.getPriceProposal(symbol, type, stake, 5, "t");
    },
    [isAuthorized, symbol, stake]
  );

  // ── Engine automática ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isBotRunning || candles.length < 50) return;

    const lastCandle = candles[candles.length - 1];
    if (lastCandle.time === lastCandleTimeRef.current) return;
    lastCandleTimeRef.current = lastCandle.time;

    // CORRIGIDO: análise e UI actualizam SEMPRE — mesmo que esteja a processar trade
    // Antes: a guard isProcessingTradeRef estava ANTES do setLastSignal
    // → confidence meter congelava enquanto trade estava a processar
    const analysis = analyzeMarket(candles, symbol, strategyProfile);
    setLastSignal(analysis);

    // A partir daqui: só executa novo trade se livre
    if (isProcessingTradeRef.current) return;

    if (structure.lastTradeResultRef.current === "LOST") {
      structure.candlesSinceLastLossRef.current += 1;
    }

    structure.evaluateStructure(candles, analysis);

    if (!structure.isEntryAllowed(analysis, minConfidence)) return;

    const now = Date.now();
    if (now - lastActionTimeRef.current < cooldownSeconds * 1000) return;

    if (consecutiveLossesRef.current >= maxConsecutiveLosses) {
      const cooldownMs = cooldownAfterLossRef.current * 1000;
      if (now - lastActionTimeRef.current < cooldownMs) return;
      consecutiveLossesRef.current = 0;
    }

    isProcessingTradeRef.current = true;
    setIsProcessing(true);
    lastActionTimeRef.current = now;
    structure.recordTrade(analysis.type as "CALL" | "PUT");
    derivService.getPriceProposal(symbol, analysis.type as "CALL" | "PUT", currentStake, 5, "t");
  }, [candles, isBotRunning, currentStake, minConfidence, cooldownSeconds, strategyProfile, maxConsecutiveLosses]);

  // ── Listeners WebSocket ───────────────────────────────────────────────────
  useEffect(() => {
    const unsubProposal = derivService.on("proposal", (data) => {
      if (data.error) {
        setError(data.error.message);
        isProcessingTradeRef.current = false;
        setIsProcessing(false);
        return;
      }
      if (data.proposal) {
        if (isBotRunningRef.current) {
          derivService.buy(data.proposal.id, data.proposal.ask_price);
        } else {
          isProcessingTradeRef.current = false;
          setIsProcessing(false);
        }
      }
    });

    const unsubBuy = derivService.on("buy", (data) => {
      isProcessingTradeRef.current = false;
      setIsProcessing(false);

      if (data.error) { setError(data.error.message); return; }
      setError(null);

      const buy = data.buy;
      if (buy) {
        const contractId = String(buy.contract_id);

        // CORRIGIDO: subscrever ao contrato ESPECÍFICO (mais fiável na nova API)
        // A subscrição global {proposal_open_contract: 1, subscribe: 1} pode não
        // retornar eventos de liquidação na nova API Deriv
        derivService.send({
          proposal_open_contract: 1,
          contract_id: contractId,
          subscribe: 1,
        });

        saveTrade({
          id: contractId,
          time: Date.now(),
          symbol,
          type: structure.lastTradeTypeRef.current || "CALL",
          stake: buy.buy_price,
          status: "PENDING",
          confidence: lastSignalRef.current?.confidence,
          score: lastSignalRef.current?.indicators.score,
          indicators: lastSignalRef.current?.indicators
            ? { ...lastSignalRef.current.indicators, structureId: structure.currentStructureIdRef.current }
            : undefined,
        });
      }
    });

    const unsubPOC = derivService.on("proposal_open_contract", (data) => {
      if (!data.proposal_open_contract) return;
      const contract = data.proposal_open_contract;
      if (!contract.is_sold) return;

      derivService.send({ balance: 1, subscribe: 1 });

      const isWin = contract.status === "won";
      structure.recordResult(isWin ? "WON" : "LOST");

      saveTrade({
        id: String(contract.contract_id),
        time: contract.date_start * 1000,
        symbol: contract.display_name || symbol,
        type: contract.contract_type === "CALL" || contract.contract_type === "CALLE" ? "CALL" : "PUT",
        stake: contract.buy_price,
        status: isWin ? "WON" : "LOST",
        profit: contract.profit,
        entryPrice: contract.entry_tick,
        exitPrice: contract.exit_tick,
      });

      setSessionStats((prev) => {
        const newConsec = isWin ? 0 : prev.consecutiveLosses + 1;
        consecutiveLossesRef.current = newConsec;

        if (!isWin && isBotRunningRef.current && newConsec >= maxConsecutiveLosses) {
          const reason = `${maxConsecutiveLosses} perdas consecutivas — cooldown de ${cooldownAfterLossRef.current}s`;
          console.warn(`[TradingEngine] ${reason}`);
          lastActionTimeRef.current = Date.now();
          onForceStop(reason);
        }

        return {
          wins: prev.wins + (isWin ? 1 : 0),
          losses: prev.losses + (isWin ? 0 : 1),
          consecutiveLosses: newConsec,
        };
      });

      if (isBotRunningRef.current) {
        lastActionTimeRef.current = Date.now();
        if (isWin) onWin(contract.profit || 0);
        else onLoss();
      }
    });

    return () => { unsubProposal(); unsubBuy(); unsubPOC(); };
  }, [symbol, onWin, onLoss, onForceStop, maxConsecutiveLosses]);

  return {
    lastSignal, sessionStats, error, isProcessing, placeTrade,
    currentStructureId: structure.currentStructureIdRef.current,
  };
}
