import type {
  ForexCalendarDecision,
  ForexDecisionContext,
  ForexDecisionResult,
  ForexReasonCode,
} from './types';
import { FOREX_DECISION_ENGINE_VERSION } from './types';
import { FOREX_REASON_MESSAGES } from './reasonCodes';

/**
 * D13 — Forex Decision Engine orchestration.
 *
 * This is a pure gate/orchestration layer. It consumes snapshots already
 * produced by D2-D12 and never calls Deriv, proposal, buy, or changes stake.
 * Missing mandatory context fails closed.
 */
export interface ForexDecisionEngineInput extends ForexDecisionContext {
  now?: number;
  /** Required only when the calendar is WATCH. D13 does not invent confirmation. */
  calendarWatchConfirmed?: boolean;
}

export class ForexDecisionEngineV1 {
  evaluate(input: ForexDecisionEngineInput): ForexDecisionResult {
    const now = input.now ?? Math.floor(Date.now() / 1000);
    const context: ForexDecisionContext = { ...input };
    delete (context as Partial<ForexDecisionEngineInput>).now;
    delete (context as Partial<ForexDecisionEngineInput>).calendarWatchConfirmed;

    const base = (state: ForexDecisionResult['state'], direction: ForexDecisionResult['direction'],
      score: number, confidence: number, reasonCode: ForexReasonCode, reason: string): ForexDecisionResult => ({
      state,
      direction,
      score,
      confidence,
      reasonCode,
      reason,
      decisionId: createDecisionId(now),
      engineVersion: FOREX_DECISION_ENGINE_VERSION,
      timestamp: now,
      context,
    });

    // G0/G1 — market availability and identity.
    if (input.market.market !== 'forex') {
      return base('WAIT_MARKET', 'NONE', 0, 0, 'ENGINE_NOT_READY', 'Contexto de mercado não é Forex.');
    }
    if (!input.market.marketOpen) {
      return base('WAIT_MARKET', 'NONE', 0, 0, 'MARKET_CLOSED', FOREX_REASON_MESSAGES.MARKET_CLOSED);
    }

    // G2 — data freshness. The 180s bound is the already-used dashboard safety
    // bound; this gate does not create a new predictive assumption.
    if (!Number.isFinite(input.market.dataAsOf ?? NaN)) {
      return base('WAIT_DATA', 'NONE', 0, 0, 'MARKET_DATA_STALE', FOREX_REASON_MESSAGES.MARKET_DATA_STALE);
    }
    if (now - (input.market.dataAsOf as number) > 180) {
      return base('WAIT_DATA', 'NONE', 0, 0, 'MARKET_DATA_STALE', FOREX_REASON_MESSAGES.MARKET_DATA_STALE);
    }

    if (!input.features) {
      return base('WAIT_DATA', 'NONE', 0, 0, 'FEATURE_INVALID', FOREX_REASON_MESSAGES.FEATURE_INVALID);
    }
    if (!input.regime) {
      return base('WAIT_REGIME', 'NONE', 0, 0, 'REGIME_UNKNOWN', FOREX_REASON_MESSAGES.REGIME_UNKNOWN);
    }
    if (!input.signal) {
      return base('WAIT_SIGNAL', 'NONE', 0, 0, 'SIGNAL_NONE', FOREX_REASON_MESSAGES.SIGNAL_NONE);
    }

    const score = input.signal.score;
    const confidence = input.signal.confidence;
    if (input.signal.direction === 'NONE') {
      return base('WAIT_SIGNAL', 'NONE', score, confidence, input.signal.reasonCode, FOREX_REASON_MESSAGES[input.signal.reasonCode]);
    }
    if (input.signal.reasonCode !== 'READY_FOR_EXECUTION') {
      return base('WAIT_SIGNAL', 'NONE', score, confidence, input.signal.reasonCode, FOREX_REASON_MESSAGES[input.signal.reasonCode]);
    }

    // G6 — Economic Calendar. It is a hard safety gate, never a directional vote.
    if (!input.calendar) {
      return base('NEWS_BLOCK', 'NONE', score, confidence, 'ENGINE_NOT_READY', 'Calendário económico ainda não foi avaliado.');
    }
    const calendar: ForexCalendarDecision = input.calendar;
    if (calendar.state === 'BLOCK' || calendar.state === 'COOLDOWN') {
      return base('NEWS_BLOCK', 'NONE', score, confidence,
        calendar.reasonCode ?? 'NEWS_BLOCK_HIGH_IMPACT',
        calendar.reasonCode ? FOREX_REASON_MESSAGES[calendar.reasonCode] : 'Entrada bloqueada pelo calendário económico.');
    }
    if (calendar.state === 'UNKNOWN') {
      return base('NEWS_BLOCK', 'NONE', score, confidence, 'ENGINE_NOT_READY', 'Estado do calendário económico desconhecido.');
    }
    if (calendar.state === 'WATCH' && !input.calendarWatchConfirmed) {
      return base('NEWS_BLOCK', 'NONE', score, confidence, 'NEWS_WATCH_REQUIRES_CONFIRMATION',
        FOREX_REASON_MESSAGES.NEWS_WATCH_REQUIRES_CONFIRMATION);
    }

    // G7 — Contract. D13 only accepts a contract selected for the same direction.
    if (!input.contract?.candidate) {
      return base('WAIT_CONTRACT', 'NONE', score, confidence, 'NO_VALID_CONTRACT', FOREX_REASON_MESSAGES.NO_VALID_CONTRACT);
    }
    if (input.contract.candidate.contractType !== input.signal.direction) {
      return base('WAIT_CONTRACT', 'NONE', score, confidence, 'NO_VALID_CONTRACT', 'Contrato disponível não corresponde à direção aprovada.');
    }

    // G8 — Risk. Risk is evaluated downstream but is mandatory before Proposal.
    if (!input.risk) {
      return base('RISK_BLOCK', 'NONE', score, confidence, 'RISK_LIMIT', 'Motor de risco ainda não avaliou a operação.');
    }
    if (!input.risk.allowed) {
      return base('RISK_BLOCK', 'NONE', score, confidence,
        input.risk.reasonCode ?? 'RISK_LIMIT',
        input.risk.reason ?? FOREX_REASON_MESSAGES.RISK_LIMIT);
    }

    // D13 intentionally stops before Proposal/Buy. D14 will validate the
    // complete live execution path.
    return base('PROPOSAL_CHECK', input.signal.direction, score, confidence,
      'READY_FOR_EXECUTION',
      'Todos os gates D13 foram aprovados; pronto para validação da Proposal.');
  }
}

export const FOREX_DECISION_ENGINE_V1 = new ForexDecisionEngineV1();

function createDecisionId(now: number): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `fx-${now}-${Math.random().toString(36).slice(2, 10)}`;
}
