import { useEffect } from "react";
import { logger } from "../lib/logger";
import { useBotStore } from "../store/useBotStore";
import { AccumulatorsEngineV1, type AccumulatorsEngineConfig } from "./engine";
import type { AccumulatorsConfig, AccumulatorsRiskConfig } from "./types";

let activeAccumulatorsEngine: AccumulatorsEngineV1 | null = null;

type FullConfig = AccumulatorsConfig & AccumulatorsRiskConfig & {
  symbol: string;
  isAuthorized: boolean;
  isBotRunning: boolean;
  balance: number | null;
};

function buildEngineConfig(config: FullConfig): AccumulatorsEngineConfig {
  return {
    ...config,
    onForceStop: (reason) => {
      logger.risk(`Accumulators V1: ${reason}`);
      useBotStore.getState().setIsBotRunning(false);
    },
  };
}

export function useAccumulatorsEngine(config: FullConfig) {
  useEffect(() => {
    const engine = new AccumulatorsEngineV1(buildEngineConfig(config));
    activeAccumulatorsEngine = engine;

    if (config.isBotRunning && config.isAuthorized) engine.start();

    return () => {
      if (activeAccumulatorsEngine === engine) activeAccumulatorsEngine = null;
      engine.destroy();
    };
    // Engine lifecycle is tied to TradingEngineRunner, not to config identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    activeAccumulatorsEngine?.updateConfig(buildEngineConfig(config));
  }, [
    config.growthRate,
    config.tickCount,
    config.stake,
    config.targetProfit,
    config.stopLoss,
    config.useMartingale,
    config.martingaleMultiplier,
    config.maxMartingaleSteps,
    config.maxConsecutiveLosses,
    config.cooldownAfterLoss,
    config.symbol,
    config.isAuthorized,
    config.isBotRunning,
    config.balance,
  ]);

  useEffect(() => {
    if (!activeAccumulatorsEngine) return;
    if (config.isBotRunning && config.isAuthorized) activeAccumulatorsEngine.start();
    else activeAccumulatorsEngine.stop();
  }, [config.isBotRunning, config.isAuthorized]);

  return undefined;
}

export function getActiveAccumulatorsEngine(): AccumulatorsEngineV1 | null {
  return activeAccumulatorsEngine;
}
