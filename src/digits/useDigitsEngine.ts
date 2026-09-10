import { useEffect } from "react";
import { logger } from "../lib/logger";
import { useBotStore } from "../store/useBotStore";
import { DigitsEngineV1, type DigitsEngineConfig } from "./engine";
import type { DigitsConfig, DigitsRiskConfig } from "./types";

let activeDigitsEngine: DigitsEngineV1 | null = null;

function buildEngineConfig(config: DigitsConfig & DigitsRiskConfig & {
  symbol: string;
  isAuthorized: boolean;
  isBotRunning: boolean;
  balance: number | null;
}): DigitsEngineConfig {
  return {
    ...config,
    onForceStop: (reason) => {
      logger.risk(`Digits V1: ${reason}`);
      useBotStore.getState().setIsBotRunning(false);
    },
  };
}

export function useDigitsEngine(config: DigitsConfig & DigitsRiskConfig & {
  symbol: string;
  isAuthorized: boolean;
  isBotRunning: boolean;
  balance: number | null;
}) {
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
