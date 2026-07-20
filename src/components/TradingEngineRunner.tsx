import { useEffect, useRef } from "react";
import { useRiskManager } from "../hooks/useRiskManager";
import { useTradingEngine } from "../hooks/useTradingEngine";
import { useConnectionStore, useBotStore, useMarketStore, useSettingsStore } from "../store";
import { useSessionStore } from "../store/useSessionStore";
import { logger } from "../lib/logger";

/**
 * TradingEngineRunner — componente sem UI (retorna null).
 *
 * Substitui a abordagem anterior de renderizar <BotControls/> inteiro
 * fora do ecrã (left: -9999px) só para manter os hooks do motor activos.
 * Essa abordagem montava uma árvore de UI completa (inputs, selects,
 * modal próprio, mini-backtest) que nunca era vista nem usada — código
 * morto a correr em paralelo. Este componente faz exactamente o mesmo
 * trabalho de manter useTradingEngine + useRiskManager montados, sem
 * nenhuma UI fantasma associada.
 *
 * Montado uma única vez em App.tsx, sempre que isAuthorized === true,
 * para que o bot continue a operar independentemente da página em que
 * o utilizador está.
 */
export const TradingEngineRunner = () => {
  const { isAuthorized, isDemo, balance } = useConnectionStore();
  const { isBotRunning, setIsBotRunning } = useBotStore();
  const { symbol, candles } = useMarketStore();
  const { settings } = useSettingsStore();
  const {
    stake, targetProfit, stopLoss, minConfidence, cooldownSeconds,
    strategyProfile, useMartingale, martingaleMultiplier, maxMartingaleSteps,
    useSoros, maxSorosLevels, maxConsecutiveLosses, cooldownAfterLoss,
  } = settings;

  const isBotRunningRef = useRef(false);
  const initialBalanceRef = useRef<number | null>(null);
  useEffect(() => { isBotRunningRef.current = isBotRunning; }, [isBotRunning]);

  // Risk Manager — Martingale, Soros, Stop Loss / Take Profit
  const [riskState, riskActions] = useRiskManager(
    { stake, targetProfit, stopLoss, useMartingale, martingaleMultiplier, maxMartingaleSteps, useSoros, maxSorosLevels },
    isBotRunning, balance, setIsBotRunning
  );

  useEffect(() => {
    if (isBotRunning && balance !== null) {
      riskActions.onBotStart(balance);
      useSessionStore.getState().resetSession();
      initialBalanceRef.current = balance; // captura saldo inicial para reconciliação
    }
    if (!isBotRunning) riskActions.onBotStop();
  }, [isBotRunning]);

  // Fix #14: reconciliação periódica entre pnl acumulado e diff de saldo real
  // Detecta divergência silenciosa causada por valores da API como strings
  useEffect(() => {
    if (!isBotRunning || balance === null || initialBalanceRef.current === null) return;
    const realPnl = balance - initialBalanceRef.current;
    const sessionPnl = useSessionStore.getState().pnl;
    const divergence = Math.abs(realPnl - sessionPnl);
    if (divergence > 0.05) { // tolerância de 5 cêntimos para arredondamentos
      logger.risk(
        `Reconciliação P&L: saldo real ${realPnl >= 0 ? "+" : ""}$${realPnl.toFixed(2)} ` +
        `vs sessão $${sessionPnl.toFixed(2)} (Δ${divergence.toFixed(2)})`
      );
    }
  }, [balance, isBotRunning]);

  // Trading Engine — análise de mercado + execução de trades
  useTradingEngine(
    {
      symbol, candles,
      currentStake: riskState.currentStake,
      stake, minConfidence, cooldownSeconds,
      strategyProfile, maxConsecutiveLosses, cooldownAfterLoss,
      isBotRunning, isAuthorized,
      onWin: riskActions.onWin,
      onLoss: riskActions.onLoss,
      onForceStop: (reason: string) => {
        // Antes dizia "Bot pausado automaticamente" — mas o bot NÃO pára,
        // entra num cooldown temporário e retoma sozinho (é esse o design:
        // maxConsecutiveLosses + cooldownAfterLoss são dois campos
        // separados de propósito). A mensagem antiga dava a entender que
        // tinha parado de vez, o que não é verdade.
        logger.risk(`Cooldown de risco activado: ${reason}`);
        useBotStore.getState().setLossCooldown({
          reason,
          until: Date.now() + cooldownAfterLoss * 1000,
        });
      },
    },
    isBotRunningRef
  );

  // Sem UI — o modal de resultado (SL/TP) é lido directamente de useSessionStore
  // pelo DashboardPage (ou por qualquer página que o queira mostrar no futuro).
  return null;
};
