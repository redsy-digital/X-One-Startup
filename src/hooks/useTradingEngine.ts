import { useState, useEffect, useCallback, useRef } from "react";
import { derivService } from "../lib/deriv";
import { analyzeMarket } from "../lib/strategy";
import { saveTrade } from "../lib/storage";
import { Candle, TradeSignal, StrategyProfile } from "../types";
import { logger } from "../lib/logger";
import { useSignalStore } from "../store/useSignalStore";
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
    } else {
      // Bot a iniciar: limpar estado de estrutura de mercado da sessão anterior
      // (lastTradeResultRef, currentStructureIdRef, etc — nunca eram resetados antes)
      structure.resetSession();
      lastCandleTimeRef.current = 0;
      consecutiveLossesRef.current = 0;
    }
  }, [isBotRunning]);

  // Trade manual
  const isManualTradeRef = useRef(false);
  const placeTrade = useCallback(
    (type: "CALL" | "PUT") => {
      if (!isAuthorized || isProcessingTradeRef.current) return;
      setError(null);
      isManualTradeRef.current = true; // marca como manual — sempre executa a compra
      isProcessingTradeRef.current = true;
      setIsProcessing(true);
      logger.trade(`▶ Trade manual ${type} | $${stake.toFixed(2)} | ${symbol}`);
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

    const analysis = analyzeMarket(candles, symbol, strategyProfile);
    setLastSignal(analysis);
    useSignalStore.getState().setLastSignal(analysis);

    // Log do sinal em cada novo candle
    const mkt = analysis.indicators.marketCondition;
    const fr = analysis.indicators.trendFreshnessScore?.toFixed(1) ?? "—";
    const tm = analysis.indicators.timingQuality?.toFixed(1) ?? "—";
    if (analysis.type === "NEUTRAL") {
      logger.signal(`${symbol} | ${mkt} | NEUTRO | ${analysis.indicators.reason}`);
    } else {
      logger.signal(
        `${symbol} | ${mkt} | ${analysis.type} | Conf: ${analysis.confidence}% | ` +
        `Fresh: ${fr} | Timing: ${tm} | ${analysis.indicators.reason}`
      );
    }

    // A partir daqui: só executa novo trade se livre
    if (isProcessingTradeRef.current) {
      logger.block("A processar trade anterior — aguardando resultado");
      return;
    }

    if (structure.lastTradeResultRef.current === "LOST") {
      structure.candlesSinceLastLossRef.current += 1;
    }

    structure.evaluateStructure(candles, analysis);

    // Verificações inline com log específico por motivo
    if (analysis.type === "NEUTRAL") return;

    if (
      structure.lastTradeResultRef.current === "LOST" &&
      analysis.type === structure.lastTradeTypeRef.current &&
      structure.lastTradeStructureIdRef.current === structure.currentStructureIdRef.current
    ) {
      logger.block(`Pós-perda: mesma direção (${analysis.type}) na mesma estrutura — aguardando nova`);
      return;
    }

    const freshness = analysis.indicators.trendFreshnessScore ?? 0;
    const isMR = analysis.indicators.reason?.includes("Mean Reversion");
    const freshnessMin = isMR ? 1 : 4; // MR tem freshness invertida (mais = melhor setup)
    if (freshness < freshnessMin) {
      logger.block(`Freshness baixo: ${freshness.toFixed(1)}/10 (mín: ${freshnessMin}.0) — tendência madura`);
      return;
    }

    const timing = analysis.indicators.timingQuality ?? 0;
    if (timing < 5) {
      logger.block(`Timing baixo: ${timing.toFixed(1)}/10 (mín: 5.0) — entrada tardia`);
      return;
    }

    if (analysis.confidence < minConfidence) {
      logger.block(`Confiança insuficiente: ${analysis.confidence}% < mínimo ${minConfidence}%`);
      return;
    }

    const now = Date.now();
    const cooldownRemaining = cooldownSeconds * 1000 - (now - lastActionTimeRef.current);
    if (cooldownRemaining > 0) {
      logger.block(`Cooldown: ${Math.ceil(cooldownRemaining / 1000)}s restantes`);
      return;
    }

    if (consecutiveLossesRef.current >= maxConsecutiveLosses) {
      const cooldownMs = cooldownAfterLossRef.current * 1000;
      if (now - lastActionTimeRef.current < cooldownMs) {
        const rem = Math.ceil((cooldownMs - (now - lastActionTimeRef.current)) / 1000);
        logger.risk(`Cooldown pós-perdas: ${consecutiveLossesRef.current} perdas | ${rem}s restantes`);
        return;
      }
      consecutiveLossesRef.current = 0;
    }

    logger.trade(`▶ Proposta ${analysis.type} | $${currentStake.toFixed(2)} | ${symbol} | Conf: ${analysis.confidence}%`);
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
        logger.error(`Proposta recusada: ${data.error.message}`);
        setError(data.error.message);
        isProcessingTradeRef.current = false;
        isManualTradeRef.current = false;
        setIsProcessing(false);
        return;
      }
      if (data.proposal) {
        if (isBotRunningRef.current || isManualTradeRef.current) {
          derivService.buy(data.proposal.id, data.proposal.ask_price);
          isManualTradeRef.current = false; // reset após uso
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
        logger.trade(`✓ Compra confirmada | ID: ${contractId} | Preço: $${buy.buy_price?.toFixed(2) ?? "—"}`);

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
      const profitStr = contract.profit !== undefined
        ? `${contract.profit >= 0 ? "+" : ""}$${Number(contract.profit).toFixed(2)}`
        : "—";
      if (isWin) {
        logger.trade(`✓ WIN | ${profitStr} | ID: ${contract.contract_id}`);
      } else {
        logger.trade(`✗ LOSS | ${profitStr} | ID: ${contract.contract_id}`);
      }

      saveTrade({
        id: String(contract.contract_id),
        time: contract.date_start * 1000,
        symbol: contract.display_name || symbol,
        type: contract.contract_type === "CALL" || contract.contract_type === "CALLE" ? "CALL" : "PUT",
        stake: Number(contract.buy_price),   // API pode enviar string — garantir número
        status: isWin ? "WON" : "LOST",
        profit: Number(contract.profit),     // API pode enviar string — garantir número
        entryPrice: Number(contract.entry_tick),
        exitPrice: Number(contract.exit_tick),
      });

      setSessionStats((prev) => {
        const newConsec = isWin ? 0 : prev.consecutiveLosses + 1;
        consecutiveLossesRef.current = newConsec;

        if (!isWin && isBotRunningRef.current && newConsec >= maxConsecutiveLosses) {
          const reason = `${maxConsecutiveLosses} perdas consecutivas — cooldown de ${cooldownAfterLossRef.current}s`;
          console.warn(`[TradingEngine] ${reason}`);
          logger.risk(`⚠ ${reason}`);
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
        if (isWin) onWin(Number(contract.profit) || 0);
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
