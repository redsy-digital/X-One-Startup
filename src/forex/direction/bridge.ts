import type { ForexDirection } from '../decision-engine/types';
import type { ExperimentalDirectionSnapshot } from './experimental';

export const FOREX_EXPERIMENTAL_BRIDGE_VERSION = 'forex-experimental-direction-bridge-v1.0.0' as const;

export interface ExperimentalDirectionBridgeSnapshot {
  version: typeof FOREX_EXPERIMENTAL_BRIDGE_VERSION;
  sourceVersion: ExperimentalDirectionSnapshot['version'];
  sourceEvidence: ExperimentalDirectionSnapshot['evidence'];
  direction: ForexDirection;
  score: number;
  confidence: number;
  timeframeMinutes: number;
  candidate: boolean;
  executable: false;
  productionEligible: false;
  reason: string;
  calculatedAt: number;
}

/**
 * Explicit boundary between research direction and the production D13 pipeline.
 * It exposes CALL/PUT as a research candidate without changing D13/D15/D16/D17.
 */
export class ForexExperimentalDirectionBridgeV1 {
  publish(
    experimental: ExperimentalDirectionSnapshot,
    timeframeMinutes: number,
    now = Math.floor(Date.now() / 1000),
  ): ExperimentalDirectionBridgeSnapshot {
    const direction = experimental.direction;
    const candidate = direction === 'CALL' || direction === 'PUT';
    const reason = candidate
      ? `Candidato experimental ${direction} recebido do ${experimental.evidence}; não elegível para produção e não executável.`
      : 'Nenhum candidato experimental CALL/PUT neste candle.';

    return {
      version: FOREX_EXPERIMENTAL_BRIDGE_VERSION,
      sourceVersion: experimental.version,
      sourceEvidence: experimental.evidence,
      direction,
      score: experimental.score,
      confidence: experimental.confidence,
      timeframeMinutes: Math.max(1, timeframeMinutes),
      candidate,
      executable: false,
      productionEligible: false,
      reason,
      calculatedAt: now,
    };
  }
}
