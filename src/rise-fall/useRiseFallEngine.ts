import { useEffect } from "react";
import { logger } from "../lib/logger";
import { useBotStore } from "../store/useBotStore";
import { RiseFallEngineV1 } from "./engine";
import type { RiseFallConfig } from "./types";

let activeRiseFallEngine: RiseFallEngineV1 | null = null;

export function useRiseFallEngine(config: RiseFallConfig) {
  useEffect(() => {
    const engine = new RiseFallEngineV1(config);
    activeRiseFallEngine = engine;
    if (config.isBotRunning && config.isAuthorized) engine.start();
    return () => {
      if (activeRiseFallEngine === engine) activeRiseFallEngine = null;
      engine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    activeRiseFallEngine?.updateConfig(config);
  }, [
    config.symbol, config.durationTicks, config.contract, config.stake, config.targetProfit, config.stopLoss,
    config.useMartingale, config.martingaleMultiplier, config.maxMartingaleSteps, config.maxConsecutiveLosses,
    config.cooldownAfterLoss, config.sequenceEnabled, config.sequenceLength, config.blockDensityEnabled,
    config.blockWindow, config.blockThreshold, config.alternatingEnabled, config.alternatingLength,
    config.isAuthorized, config.isBotRunning, config.isBotPaused, config.balance,
  ]);

  useEffect(() => {
    if (!activeRiseFallEngine) return;
    if (config.isBotRunning && config.isAuthorized) activeRiseFallEngine.start();
    else activeRiseFallEngine.stop();
  }, [config.isBotRunning, config.isAuthorized]);
}

export function getActiveRiseFallEngine() { return activeRiseFallEngine; }
