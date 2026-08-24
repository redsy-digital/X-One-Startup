import type { ForexStructureSnapshot } from '../structure';
import type { ForexSessionSnapshot } from '../session';
import type { ForexRiskEvaluationInput } from "../risk";

import type {
  ForexCalendarDecision,
  ForexContractSelection,
  ForexEconomicEvent,
  ForexFeatureSnapshot,
  ForexMarketContext,
  ForexRegimeResult,
  ForexRiskDecision,
  ForexSignalResult,
} from "./types";

/**
 * D1 contracts only. Implementations arrive in later phases.
 * Keeping these behind interfaces prevents the Decision Engine from knowing
 * how Deriv, indicators, calendar or risk are physically implemented.
 */
export interface ForexFeatureEngine {
  calculate(market: ForexMarketContext): ForexFeatureSnapshot;
}

export interface ForexStructureEngine {
  analyze(market: ForexMarketContext): ForexStructureSnapshot;
}

export interface ForexRegimeEngine {
  classify(
    features: ForexFeatureSnapshot,
    market: ForexMarketContext,
    structure?: ForexStructureSnapshot,
    session?: ForexSessionSnapshot,
    previousFeatures?: ForexFeatureSnapshot,
  ): ForexRegimeResult;
}

export interface ForexDirectionEngine {
  decide(
    features: ForexFeatureSnapshot,
    regime: ForexRegimeResult,
    market: ForexMarketContext,
  ): ForexSignalResult;
}

export interface ForexCalendarService {
  getEvents(currencies: string[], from: number, to: number): Promise<ForexEconomicEvent[]>;
  evaluate(events: ForexEconomicEvent[], now: number): ForexCalendarDecision;
}

export interface ForexContractSelector {
  select(input: {
    symbol: string;
    direction: "CALL" | "PUT";
    durationMinutes: number;
  }): Promise<ForexContractSelection>;
}

export interface ForexRiskEngine {
  evaluate(input: ForexRiskEvaluationInput): ForexRiskDecision;
}

export interface ForexProposalGateway {
  requestProposal(input: {
    symbol: string;
    direction: "CALL" | "PUT";
    stake: number;
    duration: number;
    durationUnit: "m" | "h";
  }): Promise<{ id: string; askPrice: number; payout?: number }>;
}

export interface ForexExecutionGateway {
  buy(input: { proposalId: string; price: number }): Promise<{ contractId: string }>;
}
