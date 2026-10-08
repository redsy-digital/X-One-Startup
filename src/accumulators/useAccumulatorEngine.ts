import { useEffect } from "react";
import { logger } from "../lib/logger";
import { useBotStore } from "../store/useBotStore";
import { AccumulatorEngineV1, type AccumulatorEngineConfig } from "./engine";
import type { AccumulatorConfig } from "./types";

let activeAccumulatorEngine: AccumulatorEngineV1 | null = null;

function buildConfig(config: AccumulatorConfig & { isAuthorized: boolean; isBotRunning: boolean; isBotPaused: boolean; balance: number | null }): AccumulatorEngineConfig {
  return { ...config, onForceStop: (reason) => { logger.risk(`Accumulators V1: ${reason}`); useBotStore.getState().setIsBotRunning(false); } };
}

export function useAccumulatorEngine(config: AccumulatorConfig & { isAuthorized: boolean; isBotRunning: boolean; isBotPaused: boolean; balance: number | null }) {
  useEffect(() => {
    const engine = new AccumulatorEngineV1(buildConfig(config));
    activeAccumulatorEngine = engine;
    if (config.isBotRunning && config.isAuthorized) engine.start();
    return () => { if (activeAccumulatorEngine === engine) activeAccumulatorEngine = null; engine.destroy(); };
    // Engine lifecycle is tied to TradingEngineRunner, not config identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { activeAccumulatorEngine?.updateConfig(buildConfig(config)); }, [
    config.symbol, config.durationTicks, config.stake, config.targetProfit, config.stopLoss,
    config.useMartingale, config.martingaleMultiplier, config.maxMartingaleSteps,
    config.maxConsecutiveLosses, config.cooldownAfterLoss, config.growthRate,
    config.closeMode, config.profitPercentTarget, config.contractTakeProfit,
    config.useProfitMartingale, config.profitMartingaleTarget,
    config.filters,
    config.isAuthorized, config.isBotRunning, config.isBotPaused, config.balance,
  ]);

  useEffect(() => {
    if (!activeAccumulatorEngine) return;
    if (config.isBotRunning && config.isAuthorized) activeAccumulatorEngine.start();
    else activeAccumulatorEngine.stop();
  }, [config.isBotRunning, config.isAuthorized]);
}

export function getActiveAccumulatorEngine() { return activeAccumulatorEngine; }
