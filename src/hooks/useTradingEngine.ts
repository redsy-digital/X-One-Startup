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

  // Ref para consecutiveLosses para uso dentro de closures assíncronos
  const consecutiveLossesRef = useRef(0);
  // Ref para cooldownAfterLoss (evitar stale closure)
  const cooldownAfterLossRef = useRef(cooldownAfterLoss);
  useEffect(() => { cooldownAfterLossRef.current = cooldownAfterLoss; }, [cooldownAfterLoss]);

  const structure = useMarketStructure();

  useEffect(() => { lastSignalRef.current = lastSignal; }, [lastSignal]);

  // Safety timeout
  useEffect(() => {
    if (!isProcessingTradeRef.current) return;
    const t = setTimeout(() => {
      if (isProcessingTradeRef.current) {
        console.warn("[TradingEngine] Trade processing stuck — resetting.");
        isProcessingTradeRef.current = false;
        setIsProcessing(false);
      }
    }, 15000);
    return () => clearTimeout(t);
  }, [isProcessingTradeRef.current]);

  // Reset ao parar o bot
  useEffect(() => {
    if (!isBotRunning) {
      isProcessingTradeRef.current = false;
      setIsProcessing(false);
    }
  }, [isBotRunning]);

  // Trade manual (botões CALL/PUT)
  const placeTrade = useCallback(
    (type: "CALL" | "PUT") => {
      if (!isAuthorized || isProcessingTradeRef.current) return;
      setError(null);
      isProcessingTradeRef.current = true;
      setIsProcessing(true);
      // Trades manuais usam o stake base, não o currentStake (que pode estar em step Martingale)
      derivService.getPriceProposal(symbol, type, stake, 5, "t");
    },
    [isAuthorized, symbol, stake]
  );

  // Engine automática — executa a cada novo candle
  useEffect(() => {
    if (!isBotRunning || isProcessingTradeRef.current || candles.length < 50) return;

    const lastCandle = candles[candles.length - 1];
    if (lastCandle.time === lastCandleTimeRef.current) return;
    lastCandleTimeRef.current = lastCandle.time;

    if (structure.lastTradeResultRef.current === "LOST") {
      structure.candlesSinceLastLossRef.current += 1;
    }

    // Análise com o perfil ativo
    const analysis = analyzeMarket(candles, symbol, strategyProfile);
    setLastSignal(analysis);

    structure.evaluateStructure(candles, analysis);

    // ── Filtros de disciplina e qualidade ──
    if (!structure.isEntryAllowed(analysis, minConfidence)) return;

    // Cooldown padrão
    const now = Date.now();
    if (now - lastActionTimeRef.current < cooldownSeconds * 1000) return;

    // ── maxConsecutiveLosses: verifica ANTES de executar ──
    // Se já atingiu o limite, aplica cooldown extra antes de tentar de novo
    if (consecutiveLossesRef.current >= maxConsecutiveLosses) {
      const cooldownMs = cooldownAfterLossRef.current * 1000;
      if (now - lastActionTimeRef.current < cooldownMs) {
        // Ainda em cooldown pós-perdas — bloqueia silenciosamente
        return;
      }
      // Cooldown expirou — reseta e deixa operar
      consecutiveLossesRef.current = 0;
    }

    // Executa o trade
    isProcessingTradeRef.current = true;
    setIsProcessing(true);
    lastActionTimeRef.current = now;
    structure.recordTrade(analysis.type as "CALL" | "PUT");

    derivService.getPriceProposal(symbol, analysis.type as "CALL" | "PUT", currentStake, 5, "t");
  }, [candles, isBotRunning, currentStake, minConfidence, cooldownSeconds, strategyProfile, maxConsecutiveLosses]);

  // Listeners WebSocket
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
        saveTrade({
          id: String(buy.contract_id),
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
        symbol: contract.display_name,
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

        // ── maxConsecutiveLosses: verificação pós-liquidação ──
        // Para o bot e aplica cooldown (o cooldown é tratado no próximo candle)
        if (!isWin && isBotRunningRef.current && newConsec >= maxConsecutiveLosses) {
          const reason = `${maxConsecutiveLosses} perdas consecutivas atingidas — cooldown de ${cooldownAfterLossRef.current}s`;
          console.warn(`[TradingEngine] ${reason}`);
          lastActionTimeRef.current = Date.now(); // inicia o cooldown
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
