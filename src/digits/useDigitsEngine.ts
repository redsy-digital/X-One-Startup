import { useEffect } from "react";
import { logger } from "../lib/logger";
import { useBotStore } from "../store/useBotStore";
import { DigitsEngineV1, type DigitsEngineConfig } from "./engine";
import type { DigitsConfig, DigitsRiskConfig } from "./types";

type UseDigitsEngineConfig = DigitsConfig & DigitsRiskConfig & {
  sequenceStrategyEnabled: boolean; sequenceStrategyMode: "fixed" | "multiple"; sequenceLength: number;
  symbol: string; isAuthorized: boolean; isBotRunning: boolean; balance: number | null;
  overUnderSequenceStrategyEnabled: boolean; overUnderSequenceLength: number;
  overUnderOverBarrier: number; overUnderUnderBarrier: number;
  percentageSaturationStrategyEnabled: boolean; percentageSaturationThreshold: number;
  percentageAbsenceStrategyEnabled: boolean; percentageAbsenceStreak: number; percentageWindow: number;
  parityBlockDensityEnabled: boolean; parityBlockWindow: number; parityBlockThreshold: number;
  parityAlternatingEnabled: boolean; parityAlternatingLength: number; parityAnchorEnabled: boolean;
  matchTwinEnabled: boolean; matchTwinRestTicks: number;
  matchMirrorEnabled: boolean; matchMirrorWindow: number; matchMirrorDominance: number; isBotPaused: boolean;
};

let activeDigitsEngine: DigitsEngineV1 | null = null;

function buildEngineConfig(config: UseDigitsEngineConfig): DigitsEngineConfig {
  return {
    ...config,
    onForceStop: (reason) => {
      logger.risk(`Digits V1: ${reason}`);
      useBotStore.getState().setIsBotRunning(false);
    },
  };
}

export function useDigitsEngine(config: UseDigitsEngineConfig) {
  useEffect(() => {
    const engine = new DigitsEngineV1(buildEngineConfig(config));
    activeDigitsEngine = engine;

    if (config.isBotRunning && config.isAuthorized) engine.start();

    return () => {
      if (activeDigitsEngine === engine) activeDigitsEngine = null;
      engine.destroy();
    };
    // Engine lifecycle is tied to TradingEngineRunner, not to config identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    activeDigitsEngine?.updateConfig(buildEngineConfig(config));
  }, [
    config.contract,
    config.targetDigit,
    config.contractDurationTicks,
    config.stake,
    config.targetProfit,
    config.stopLoss,
    config.useMartingale,
    config.martingaleMultiplier,
    config.maxMartingaleSteps,
    config.useAdvancedMartingale,
    config.advancedMartingaleContract,
    config.advancedMartingaleTargetDigit,
    config.maxAdvancedMartingaleSteps,
    config.maxConsecutiveLosses,
    config.sequenceStrategyEnabled,
    config.sequenceStrategyMode,
    config.sequenceLength,
    config.overUnderSequenceStrategyEnabled,
    config.overUnderSequenceLength,
    config.overUnderOverBarrier,
    config.overUnderUnderBarrier,
    config.percentageSaturationStrategyEnabled,
    config.percentageSaturationThreshold,
    config.percentageAbsenceStrategyEnabled,
    config.percentageAbsenceStreak,
    config.percentageWindow,
    config.parityBlockDensityEnabled,
    config.parityBlockWindow,
    config.parityBlockThreshold,
    config.parityAlternatingEnabled,
    config.parityAlternatingLength,
    config.parityAnchorEnabled,
    config.matchTwinEnabled,
    config.matchTwinRestTicks,
    config.matchMirrorEnabled,
    config.matchMirrorWindow,
    config.matchMirrorDominance,
    config.isBotPaused,
    config.cooldownAfterLoss,
    config.symbol,
    config.isAuthorized,
    config.isBotRunning,
    config.balance,
  ]);

  useEffect(() => {
    if (!activeDigitsEngine) return;
    if (config.isBotRunning && config.isAuthorized) activeDigitsEngine.start();
    else activeDigitsEngine.stop();
  }, [config.isBotRunning, config.isAuthorized]);

  return undefined;
}

export function getActiveDigitsEngine(): DigitsEngineV1 | null {
  return activeDigitsEngine;
}
