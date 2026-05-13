import { useState, useEffect, useCallback, useRef } from "react";
import { derivService } from "../lib/deriv";
import { analyzeMarket } from "../lib/strategy";
import { saveTrade } from "../lib/storage";
import { Candle, TradeSignal } from "../types";
import { useMarketStructure } from "./useMarketStructure";

interface TradingEngineConfig {
  symbol: string;
  candles: Candle[];
  currentStake: number;
  stake: number;
  minConfidence: number;
  cooldownSeconds: number;
  isBotRunning: boolean;
  isAuthorized: boolean;
  onWin: (profit: number) => void;
  onLoss: () => void;
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
    symbol,
    candles,
    currentStake,
    stake,
    minConfidence,
    cooldownSeconds,
    isBotRunning,
    isAuthorized,
    onWin,
    onLoss,
  } = config;

  const [lastSignal, setLastSignal] = useState<TradeSignal | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    wins: 0,
    losses: 0,
    consecutiveLosses: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const isProcessingTradeRef = useRef<boolean>(false);
  const lastActionTimeRef = useRef<number>(0);
  const lastCandleTimeRef = useRef<number>(0);
  const lastSignalRef = useRef<TradeSignal | null>(null);

  const structure = useMarketStructure();

  // Sync signal ref for use inside async closures
  useEffect(() => {
    lastSignalRef.current = lastSignal;
  }, [lastSignal]);

  // Safety timeout: prevents stuck processing state
  useEffect(() => {
    if (!isProcessingTradeRef.current) return;
    const timeout = setTimeout(() => {
      if (isProcessingTradeRef.current) {
        console.warn("[TradingEngine] Trade processing stuck — resetting.");
        isProcessingTradeRef.current = false;
        setIsProcessing(false);
      }
    }, 15000);
    return () => clearTimeout(timeout);
  }, [isProcessingTradeRef.current]);

  // Reset processing state when bot stops
  useEffect(() => {
    if (!isBotRunning) {
      isProcessingTradeRef.current = false;
      setIsProcessing(false);
    }
  }, [isBotRunning]);

  // Manual trade execution (CALL/PUT buttons)
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

  // Automated strategy execution — triggered on each new candle
  useEffect(() => {
    if (!isBotRunning || isProcessingTradeRef.current || candles.length < 50)
      return;

    const lastCandle = candles[candles.length - 1];

    // Guard: only process a candle once
    if (lastCandle.time === lastCandleTimeRef.current) return;
    lastCandleTimeRef.current = lastCandle.time;

    // Track candles since last loss (for future use)
    if (structure.lastTradeResultRef.current === "LOST") {
      structure.candlesSinceLastLossRef.current += 1;
    }

    const analysis = analyzeMarket(candles, symbol);
    setLastSignal(analysis);

    // Evaluate and update market structure
    structure.evaluateStructure(candles, analysis);

    // Apply all discipline & quality filters
    if (!structure.isEntryAllowed(analysis, minConfidence)) return;

    // Cooldown guard
    const now = Date.now();
    if (now - lastActionTimeRef.current < cooldownSeconds * 1000) return;

    // Execute trade
    isProcessingTradeRef.current = true;
    setIsProcessing(true);
    lastActionTimeRef.current = now;
    structure.recordTrade(analysis.type as "CALL" | "PUT");

    derivService.getPriceProposal(
      symbol,
      analysis.type as "CALL" | "PUT",
      currentStake,
      5,
      "t"
    );
  }, [candles, isBotRunning, currentStake, minConfidence, cooldownSeconds]);

  // Deriv WebSocket event listeners
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

      if (data.error) {
        setError(data.error.message);
        return;
      }

      setError(null);
      const buy = data.buy;

      if (buy) {
        saveTrade({
          id: String(buy.contract_id),
          time: Date.now(),
          symbol: symbol,
          type: structure.lastTradeTypeRef.current || "CALL",
          stake: buy.buy_price,
          status: "PENDING",
          confidence: lastSignalRef.current?.confidence,
          score: lastSignalRef.current?.indicators.score,
          indicators: lastSignalRef.current?.indicators
            ? {
                ...lastSignalRef.current.indicators,
                lossStreak: sessionStats.consecutiveLosses,
                structureId: structure.currentStructureIdRef.current,
              }
            : undefined,
        });
      }
    });

    const unsubPOC = derivService.on("proposal_open_contract", (data) => {
      if (!data.proposal_open_contract) return;

      const contract = data.proposal_open_contract;
      if (!contract.is_sold) return;

      // Request balance update
      derivService.send({ balance: 1, subscribe: 1 });

      const isWin = contract.status === "won";

      // Update discipline refs
      structure.recordResult(isWin ? "WON" : "LOST");

      // Settle trade in history
      saveTrade({
        id: String(contract.contract_id),
        time: contract.date_start * 1000,
        symbol: contract.display_name,
        type:
          contract.contract_type === "CALL" || contract.contract_type === "CALLE"
            ? "CALL"
            : "PUT",
        stake: contract.buy_price,
        status: isWin ? "WON" : "LOST",
        profit: contract.profit,
        entryPrice: contract.entry_tick,
        exitPrice: contract.exit_tick,
      });

      // Update session stats
      setSessionStats((prev) => ({
        wins: prev.wins + (isWin ? 1 : 0),
        losses: prev.losses + (isWin ? 0 : 1),
        consecutiveLosses: isWin ? 0 : prev.consecutiveLosses + 1,
      }));

      // Trigger risk manager callbacks
      if (isBotRunningRef.current) {
        if (isWin) {
          lastActionTimeRef.current = Date.now();
          onWin(contract.profit || 0);
        } else {
          lastActionTimeRef.current = Date.now();
          onLoss();
        }
      }
    });

    return () => {
      unsubProposal();
      unsubBuy();
      unsubPOC();
    };
  }, [symbol, onWin, onLoss]);

  return {
    lastSignal,
    sessionStats,
    error,
    isProcessing,
    placeTrade,
    currentStructureId: structure.currentStructureIdRef.current,
  };
}
