import type { ForexFeatureKey } from '../decision-engine/featureCatalog';
import type { ForexRegime, ForexDirection } from '../decision-engine/types';
import type { ForexStructureSnapshot } from '../structure';

export interface ForexDirectionalWeight {
  feature: ForexFeatureKey;
  weight: number;
  /** Must be explicitly promoted by the research protocol before production use. */
  evidenceId?: string;
  approved: boolean;
}

export interface ForexDirectionConfig {
  version: 'forex-direction-v1.0.0';
  minimumAbsoluteScore: number;
  minimumConfidence: number;
  minimumVotes: number;
  allowUnapprovedWeights: false;
  weights: ForexDirectionalWeight[];
}

export interface ForexDirectionEvidence {
  feature: ForexFeatureKey;
  normalizedValue: number;
  contribution: number;
  vote: ForexDirection;
  approved: boolean;
  evidenceId?: string;
}

export interface ForexDirectionSnapshot {
  version: 'forex-direction-v1.0.0';
  direction: ForexDirection;
  rawScore: number;
  confidence: number;
  votes: number;
  regime: ForexRegime;
  structureDirection: ForexStructureSnapshot['direction'] | null;
  evidence: ForexDirectionEvidence[];
  tradable: boolean;
  calculatedAt: number;
  reason: string;
}
