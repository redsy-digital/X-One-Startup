import { useEffect } from "react";
import { useConnectionStore, useBotStore, useMarketStore, useSettingsStore } from "../store";
import { useDigitsEngine } from "../digits/useDigitsEngine";
import { useAccumulatorEngine } from "../accumulators/useAccumulatorEngine";
import { forexRuntimeIntegrationV1 } from "../forex/runtime";
import { useSyntheticTabsStore } from "../synthetic/tabs";
import { DEFAULT_ACCUMULATOR_FILTERS } from "../accumulators/filters";
import { useRiseFallEngine } from "../rise-fall/useRiseFallEngine";

/**
 * Runtime coordinator. Forex remains isolated. Synthetic operation tabs share
 * only the connection and the single global active-bot lock; each engine is
 * activated exclusively from runningTabId.
 */
export const TradingEngineRunner = () => {
  const { isAuthorized, balance } = useConnectionStore();
  const { isBotRunning, isBotPaused } = useBotStore();
  const { market, symbol } = useMarketStore();
  const { settings } = useSettingsStore();
  const { tabs, runningTabId, setRunningTabId } = useSyntheticTabsStore();
  const runningTab = tabs.find(tab => tab.id === runningTabId) ?? null;

  useEffect(() => {
    if (!isBotRunning && runningTabId) setRunningTabId(null);
  }, [isBotRunning, runningTabId, setRunningTabId]);

  useEffect(() => {
    if (market === "forex" && isBotRunning && isAuthorized) forexRuntimeIntegrationV1.start();
    else if (market === "forex") forexRuntimeIntegrationV1.stop();
    return () => { if (market === "forex") forexRuntimeIntegrationV1.stop(); };
  }, [market, isBotRunning, isAuthorized]);

  const digitsRunning = isBotRunning && market === "synthetic" && runningTab?.kind === "digits";
  const riseFallRunning = isBotRunning && market === "synthetic" && runningTab?.kind === "rise_fall";
  const accumRunning = isBotRunning && market === "synthetic" && runningTab?.kind === "accumulators";
  const syntheticSymbol = runningTab?.symbol ?? symbol;
  const accumulator = runningTab?.accumulator;

  useDigitsEngine({
    contract: settings.digitsContract,
    targetDigit: settings.digitsTargetDigit,
    contractDurationTicks: settings.contractDurationTicks,
    symbol: syntheticSymbol,
    isAuthorized,
    isBotRunning: digitsRunning,
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
    isBotPaused,
    sequenceStrategyEnabled: settings.digitsSequenceStrategyEnabled && (settings.digitsContract === "DIGITEVEN" || settings.digitsContract === "DIGITODD"),
    sequenceStrategyMode: settings.digitsSequenceStrategyMode,
    sequenceLength: settings.digitsSequenceLength,
    overUnderSequenceStrategyEnabled: settings.digitsOverUnderSequenceStrategyEnabled && (settings.digitsContract === "DIGITOVER" || settings.digitsContract === "DIGITUNDER"),
    overUnderSequenceLength: settings.digitsOverUnderSequenceLength,
    overUnderOverBarrier: settings.digitsOverUnderOverBarrier,
    overUnderUnderBarrier: settings.digitsOverUnderUnderBarrier,
    percentageSaturationStrategyEnabled: settings.digitsPercentageSaturationStrategyEnabled && settings.digitsContract === "DIGITDIFF",
    percentageSaturationThreshold: settings.digitsPercentageSaturationThreshold,
    percentageAbsenceStrategyEnabled: settings.digitsPercentageAbsenceStrategyEnabled && settings.digitsContract === "DIGITMATCH",
    percentageAbsenceStreak: settings.digitsPercentageAbsenceStreak,
    percentageWindow: settings.digitsPercentageWindow,
    parityBlockDensityEnabled: settings.digitsParityBlockDensityEnabled && (settings.digitsContract === "DIGITEVEN" || settings.digitsContract === "DIGITODD"),
    parityBlockWindow: settings.digitsParityBlockWindow,
    parityBlockThreshold: settings.digitsParityBlockThreshold,
    parityAlternatingEnabled: settings.digitsParityAlternatingEnabled && (settings.digitsContract === "DIGITEVEN" || settings.digitsContract === "DIGITODD"),
    parityAlternatingLength: settings.digitsParityAlternatingLength,
    parityAnchorEnabled: settings.digitsParityAnchorEnabled && (settings.digitsContract === "DIGITEVEN" || settings.digitsContract === "DIGITODD"),
    matchTwinEnabled: settings.digitsMatchTwinEnabled && settings.digitsContract === "DIGITMATCH",
    matchTwinRestTicks: settings.digitsMatchTwinRestTicks,
    matchMirrorEnabled: settings.digitsMatchMirrorEnabled && settings.digitsContract === "DIGITMATCH",
    matchMirrorWindow: settings.digitsMatchMirrorWindow,
    matchMirrorDominance: settings.digitsMatchMirrorDominance,
  });

  useRiseFallEngine({
    symbol: syntheticSymbol,
    durationTicks: settings.riseFallDurationTicks,
    contract: settings.riseFallContract,
    stake: settings.stake,
    targetProfit: settings.targetProfit,
    stopLoss: settings.stopLoss,
    useMartingale: settings.useMartingale,
    martingaleMultiplier: settings.martingaleMultiplier,
    maxMartingaleSteps: settings.maxMartingaleSteps,
    maxConsecutiveLosses: settings.maxConsecutiveLosses,
    cooldownAfterLoss: settings.cooldownAfterLoss,
    sequenceEnabled: settings.riseFallSequenceEnabled,
    sequenceLength: settings.riseFallSequenceLength,
    blockDensityEnabled: settings.riseFallBlockDensityEnabled,
    blockWindow: settings.riseFallBlockWindow,
    blockThreshold: settings.riseFallBlockThreshold,
    alternatingEnabled: settings.riseFallAlternatingEnabled,
    alternatingLength: settings.riseFallAlternatingLength,
    isAuthorized,
    isBotRunning: riseFallRunning,
    isBotPaused,
    balance,
  });

  useAccumulatorEngine({
    symbol: accumulator?.symbol ?? syntheticSymbol,
    durationTicks: accumulator?.durationTicks ?? 20,
    stake: accumulator?.stake ?? 1,
    targetProfit: accumulator?.targetProfit ?? 3.5,
    stopLoss: accumulator?.stopLoss ?? 6,
    useMartingale: accumulator?.useMartingale ?? true,
    martingaleMultiplier: accumulator?.martingaleMultiplier ?? 2.1,
    maxMartingaleSteps: accumulator?.maxMartingaleSteps ?? 3,
    maxConsecutiveLosses: accumulator?.maxConsecutiveLosses ?? 5,
    cooldownAfterLoss: accumulator?.cooldownAfterLoss ?? 30,
    growthRate: accumulator?.growthRate ?? 0.01,
    closeMode: accumulator?.closeMode ?? "ticks",
    profitPercentTarget: accumulator?.profitPercentTarget ?? 25,
    contractTakeProfit: accumulator?.contractTakeProfit ?? 0.5,
    useProfitMartingale: accumulator?.useProfitMartingale ?? false,
    profitMartingaleTarget: accumulator?.profitMartingaleTarget ?? 0.5,
    filters: { ...DEFAULT_ACCUMULATOR_FILTERS, ...(accumulator?.filters ?? {}) },
    isAuthorized,
    isBotRunning: accumRunning,
    isBotPaused,
    balance,
  });

  return null;
};
