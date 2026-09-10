import type { ForexCalendarDecision, ForexDecisionResult } from "../decision-engine/types";
import type { ForexProposalSnapshot } from "../proposal";
import {
  DEFAULT_FOREX_EXECUTION_GUARD_CONFIG,
  type ForexExecutionAuthorization,
  type ForexExecutionGuardConfig,
  type ForexExecutionGuardInput,
} from "./types";

/**
 * D16 — Forex Execution Guard.
 *
 * This is the final safety barrier between a valid D15 Proposal and D17.
 * It NEVER calls buy(), never changes the stake, and never chooses CALL/PUT.
 *
 * Its job is to revalidate that the exact decision/proposal pair is still
 * executable at the moment D17 is about to act.
 */
export class ForexExecutionGuardV1 {
  constructor(private readonly config: ForexExecutionGuardConfig = DEFAULT_FOREX_EXECUTION_GUARD_CONFIG) {}

  authorize(input: ForexExecutionGuardInput): ForexExecutionAuthorization {
    const { now, decision, proposal, calendar, riskAllowed, state } = input;
    const blocked = (
      code: ForexExecutionAuthorization["code"],
      reason: string,
    ): ForexExecutionAuthorization => ({
      authorized: false,
      code,
      reason,
      checkedAt: now,
      decisionId: decision.decisionId,
      proposalId: proposal?.id,
    });

    // Operational state comes first: a stopped bot or unhealthy connection
    // must never produce a new execution authorization.
    if (!state.botRunning) {
      return blocked("BOT_STOPPED", "Bot Forex está parado; nenhuma nova entrada pode ser autorizada.");
    }

    if (!state.connectionOpen) {
      return blocked("CONNECTION_NOT_READY", "Ligação à Deriv não está pronta para execução.");
    }

    if (state.decisionInFlight) {
      return blocked("DUPLICATE_EXECUTION", "Já existe um fluxo de execução em andamento para evitar uma entrada duplicada.");
    }

    if (!decision || decision.state !== "PROPOSAL_CHECK" ||
        (decision.direction !== "CALL" && decision.direction !== "PUT")) {
      return blocked("DECISION_NOT_READY", "A decisão D13 não está no estado PROPOSAL_CHECK com uma direção válida.");
    }

    if (!Number.isFinite(decision.timestamp) || now < decision.timestamp ||
        now - decision.timestamp > this.config.maxDecisionAgeSeconds) {
      return blocked("DECISION_STALE", "A decisão D13 está demasiado antiga para ser executada com segurança.");
    }

    if (!proposal?.id) {
      return blocked("PROPOSAL_STALE", "Proposal ausente ou sem ID.");
    }

    if (!Number.isFinite(proposal.receivedAt) || now < proposal.receivedAt ||
        now - proposal.receivedAt > this.config.maxProposalAgeSeconds) {
      return blocked("PROPOSAL_STALE", "A Proposal D15 está demasiado antiga; deve ser obtida novamente.");
    }

    if (!Number.isFinite(proposal.askPrice) || (proposal.askPrice as number) <= 0) {
      return blocked("PROPOSAL_MISSING_PRICE", "A Proposal não possui ask_price numérico válido para uma futura compra.");
    }

    const requested = proposal.requested;
    if (requested.symbol !== "frxEURUSD" ||
        requested.direction !== decision.direction ||
        ![15, 30, 60, 120].includes(requested.durationMinutes) ||
        !Number.isFinite(requested.stake) || requested.stake < 0.5) {
      return blocked("PROPOSAL_MISMATCH", "Os parâmetros da Proposal não correspondem ao conjunto Forex V1 validado.");
    }

    if (!input.decision.context.market.marketOpen) {
      return blocked("MARKET_CLOSED", "Mercado Forex está fechado no momento da execução.");
    }

    if (input.decision.context.market.symbol !== requested.symbol) {
      return blocked("PROPOSAL_MISMATCH", "O símbolo da decisão e da Proposal não coincide.");
    }

    if (!calendar) {
      return blocked("CALENDAR_NOT_READY", "O calendário económico não foi revalidado.");
    }

    if (!Number.isFinite(calendar.checkedAt) ||
        now < calendar.checkedAt ||
        now - calendar.checkedAt > this.config.maxCalendarAgeSeconds) {
      return blocked("CALENDAR_STALE", "A avaliação do calendário económico está desatualizada.");
    }

    if (calendar.state === "BLOCK" || calendar.state === "COOLDOWN") {
      return blocked("CALENDAR_BLOCK", "A janela económica bloqueia a execução desta entrada.");
    }

    if (calendar.state === "UNKNOWN") {
      return blocked("CALENDAR_NOT_READY", "O estado do calendário económico é desconhecido.");
    }

    if (calendar.state === "WATCH") {
      return blocked("CALENDAR_WATCH", "O calendário está em WATCH; D16 não pode transformar WATCH em autorização.");
    }

    if (!riskAllowed || !input.decision.context.risk?.allowed) {
      return blocked("RISK_BLOCK", "A gestão de risco não autoriza esta entrada.");
    }

    if (state.openPositions >= 1) {
      return blocked("POSITION_LIMIT", "Já existe uma posição Forex aberta; D16 V1 autoriza no máximo uma.");
    }

    return {
      authorized: true,
      code: "EXECUTION_AUTHORIZED",
      reason: "Decision, Proposal, mercado, calendário, risco e estado operacional foram revalidados; D17 pode executar.",
      checkedAt: now,
      decisionId: decision.decisionId,
      proposalId: proposal.id,
    };
  }
}

export const forexExecutionGuardV1 = new ForexExecutionGuardV1();
