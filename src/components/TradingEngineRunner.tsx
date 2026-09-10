import { useEffect } from "react";
import { useConnectionStore, useBotStore, useMarketStore, useSettingsStore } from "../store";
import { useDigitsEngine } from "../digits/useDigitsEngine";
import { useAccumulatorsEngine } from "../accumulators/useAccumulatorsEngine";
import { useAccumulatorsSettingsStore } from "../store/useAccumulatorsSettingsStore";
import { useSyntheticTabsStore } from "../store/useSyntheticTabsStore";
import { forexRuntimeIntegrationV1 } from "../forex/runtime";

/**
 * TradingEngineRunner — componente sem UI.
 *
 * Índices Sintéticos agora suporta duas abas de operação independentes —
 * Digits e Accumulators (ver useSyntheticTabsStore) — mas apenas uma pode
 * estar "isBotRunning" de cada vez: runningTabId identifica qual delas é a
 * dona da execução actual, e cada motor só é activado quando a aba
 * correspondente é a dona. O runtime Forex continua totalmente separado e
 * intocado.
 */
export const TradingEngineRunner = () => {
  const { isAuthorized, balance } = useConnectionStore();
  const { isBotRunning, setLossCooldown } = useBotStore();
  const { symbol, market } = useMarketStore();
  const { settings } = useSettingsStore();
  const { settings: accuSettings } = useAccumulatorsSettingsStore();
  const { tabs, runningTabId, setRunningTab } = useSyntheticTabsStore();
  const runningTabType = tabs.find((t) => t.id === runningTabId)?.type ?? null;

  // Rede de segurança: sempre que o bot global pára (por qualquer motivo —
  // Stop manual, Take Profit/Stop Loss, perdas seguidas), liberta a aba
  // "dona" para que o Start volte a ficar disponível nas outras abas.
  useEffect(() => {
    if (!isBotRunning && runningTabId) setRunningTab(null);
  }, [isBotRunning]);

  // O Forex continua a gerir o seu próprio risco através do Forex Runtime;
  // o motor direccional legado deixou de ser montado.

  // ── Forex: fluxo existente, isolado ──────────────────────────────────────
  useEffect(() => {
    if (market === "forex" && isBotRunning && isAuthorized) {
      forexRuntimeIntegrationV1.start();
    } else if (market === "forex") {
      forexRuntimeIntegrationV1.stop();
    }
    return () => {
      if (market === "forex") forexRuntimeIntegrationV1.stop();
    };
  }, [market, isBotRunning, isAuthorized]);

  // ── Synthetic → Digits V1 ────────────────────────────────────────────────
  useDigitsEngine({
    contract: settings.digitsContract,
    targetDigit: settings.digitsTargetDigit,
    symbol,
    isAuthorized,
    isBotRunning: isBotRunning && market === "synthetic" && runningTabType === "digits",
    balance,
    stake: settings.stake,
    targetProfit: settings.targetProfit,
    stopLoss: settings.stopLoss,
    useMartingale: settings.useMartingale,
    martingaleMultiplier: settings.martingaleMultiplier,
    maxMartingaleSteps: settings.maxMartingaleSteps,
    useAdvancedMartingale: settings.useAdvancedMartingale,
    advancedMartingaleContract: settings.advancedMartingaleContract,
    advancedMartingaleTargetDigit: settings.advancedMartingaleTargetDigit,
    maxAdvancedMartingaleSteps: settings.maxAdvancedMartingaleSteps,
    maxConsecutiveLosses: settings.maxConsecutiveLosses,
    cooldownAfterLoss: settings.cooldownAfterLoss,
  });

  // ── Synthetic → Accumulators V1 ──────────────────────────────────────────
  useAccumulatorsEngine({
    growthRate: accuSettings.growthRate,
    tickCount: accuSettings.tickCount,
    symbol,
    isAuthorized,
    isBotRunning: isBotRunning && market === "synthetic" && runningTabType === "accumulators",
    balance,
    stake: accuSettings.stake,
    targetProfit: accuSettings.targetProfit,
    stopLoss: accuSettings.stopLoss,
    useMartingale: accuSettings.useMartingale,
    martingaleMultiplier: accuSettings.martingaleMultiplier,
    maxMartingaleSteps: accuSettings.maxMartingaleSteps,
    maxConsecutiveLosses: accuSettings.maxConsecutiveLosses,
    cooldownAfterLoss: accuSettings.cooldownAfterLoss,
  });

  return null;
};
