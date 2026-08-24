import type { ForexDirectionEngine } from '../decision-engine/ports';
import type { ForexFeatureSnapshot, ForexMarketContext, ForexRegimeResult, ForexSignalResult } from '../decision-engine/types';
import type { ForexFeatureKey } from '../decision-engine/featureCatalog';
import type { ForexStructureSnapshot } from '../structure';
import type { ForexDirectionConfig, ForexDirectionEvidence, ForexDirectionSnapshot } from './types';

const DEFAULT_CONFIG: ForexDirectionConfig = {
  version: 'forex-direction-v1.0.0',
  minimumAbsoluteScore: 0.55,
  minimumConfidence: 0.55,
  minimumVotes: 2,
  allowUnapprovedWeights: false,
  weights: [],
};

/**
 * D8 Direction Engine.
 *
 * It deliberately separates diagnostic direction from a production-tradable
 * signal. No feature receives a production weight merely because it exists in
 * the catalogue. A weight must be explicitly approved by the research protocol.
 */
export class ForexDirectionEngineV1 implements ForexDirectionEngine {
  constructor(private readonly config: ForexDirectionConfig = DEFAULT_CONFIG) {}

  decide(
    features: ForexFeatureSnapshot,
    regime: ForexRegimeResult,
    market: ForexMarketContext,
    structure?: ForexStructureSnapshot,
  ): ForexSignalResult & { snapshot: ForexDirectionSnapshot } {
    const evidence: ForexDirectionEvidence[] = [];
    let score = 0;
    let votes = 0;

    for (const item of this.config.weights) {
      const value = features.values[item.feature];
      if (!Number.isFinite(value) || item.weight === 0) continue;

      // A production contribution is allowed only for explicitly approved evidence.
      if (!item.approved || !item.evidenceId) continue;

      const normalized = clamp(value, -1, 1);
      const contribution = normalized * item.weight;
      score += contribution;
      const vote: 'CALL' | 'PUT' | 'NONE' = normalized > 0 ? 'CALL' : normalized < 0 ? 'PUT' : 'NONE';
      if (vote !== 'NONE') votes += 1;
      evidence.push({
        feature: item.feature,
        normalizedValue: round(normalized),
        contribution: round(contribution),
        vote,
        approved: true,
        evidenceId: item.evidenceId,
      });
    }

    // Structure and regime are context gates, not unvalidated directional weights.
    const structureDirection = structure?.direction ?? null;
    const contextualDirection = structureDirection === 'BULLISH'
      ? 'CALL'
      : structureDirection === 'BEARISH'
        ? 'PUT'
        : 'NONE';

    const scoreDirection: 'CALL' | 'PUT' | 'NONE' = score > 0
      ? 'CALL'
      : score < 0
        ? 'PUT'
        : 'NONE';

    const direction = scoreDirection;
    const confidence = round(Math.min(1, Math.abs(score)));
    const enoughEvidence = votes >= this.config.minimumVotes
      && Math.abs(score) >= this.config.minimumAbsoluteScore
      && confidence >= this.config.minimumConfidence;
    const regimeAllowed = regime.regime !== 'UNKNOWN' && regime.regime !== 'TRANSITION';
    const contextAligned = contextualDirection === 'NONE' || contextualDirection === direction;
    const tradable = enoughEvidence && regimeAllowed && contextAligned && direction !== 'NONE';

    let reason = 'Sem evidência direcional aprovada suficiente.';
    let reasonCode: ForexSignalResult['reasonCode'] = 'SIGNAL_NONE';

    if (direction !== 'NONE' && !enoughEvidence) {
      reason = 'Existe uma direção candidata, mas não atingiu os thresholds com evidência aprovada.';
      reasonCode = 'SIGNAL_BELOW_THRESHOLD';
    } else if (direction !== 'NONE' && !regimeAllowed) {
      reason = 'Direção candidata rejeitada porque o regime está indefinido/em transição.';
      reasonCode = 'REGIME_NOT_SUPPORTED';
    } else if (direction !== 'NONE' && !contextAligned) {
      reason = 'Direção candidata contradiz a estrutura de mercado.';
      reasonCode = 'SIGNAL_BELOW_THRESHOLD';
    } else if (tradable) {
      reason = 'Direção aprovada por evidência direcional previamente promovida e gates de contexto.';
      reasonCode = 'READY_FOR_EXECUTION';
    }

    const snapshot: ForexDirectionSnapshot = {
      version: 'forex-direction-v1.0.0',
      direction,
      rawScore: round(score),
      confidence,
      votes,
      regime: regime.regime,
      structureDirection,
      evidence,
      tradable,
      calculatedAt: Date.now(),
      reason,
    };

    return {
      direction: tradable ? direction : 'NONE',
      score: round(score),
      confidence,
      featureSnapshot: features,
      reasonCode,
      snapshot,
    };
  }
}

export const FOREX_DIRECTION_DEFAULT_CONFIG = DEFAULT_CONFIG;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
