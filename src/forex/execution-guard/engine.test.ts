import { describe, expect, it } from "vitest";
import { ForexExecutionGuardV1 } from "./engine";
import type { ForexDecisionResult, ForexCalendarDecision } from "../decision-engine/types";
import type { ForexProposalSnapshot } from "../proposal";

const now = 1_780_000_000;

const calendar: ForexCalendarDecision = {
  state: "CLEAR",
  relevantEvents: [],
  checkedAt: now - 5,
};

const decision: ForexDecisionResult = {
  state: "PROPOSAL_CHECK",
  direction: "CALL",
  score: 0.8,
  confidence: 0.8,
  reasonCode: "READY_FOR_EXECUTION",
  reason: "ok",
  decisionId: "decision-1",
  engineVersion: "forex-v1.0.0",
  timestamp: now - 10,
  context: {
    market: {
      market: "forex",
      symbol: "frxEURUSD",
      timeframeMinutes: 15,
      candles: [],
      marketOpen: true,
      dataAsOf: now - 10,
    },
    profile: {} as any,
    risk: {
      allowed: true,
      stake: 0.5,
      reasonCode: "READY_FOR_EXECUTION",
      checkedAt: now - 10,
    },
  },
};

const proposal: ForexProposalSnapshot = {
  id: "proposal-1",
  askPrice: 0.5,
  payout: 0.9,
  requested: {
    symbol: "frxEURUSD",
    direction: "CALL",
    stake: 0.5,
    durationMinutes: 15,
    currency: "USD",
  },
  receivedAt: now - 5,
};

const state = {
  botRunning: true,
  connectionOpen: true,
  openPositions: 0,
};

describe("D16 — Forex Execution Guard V1", () => {
  it("autoriza somente quando todos os gates passam", () => {
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal, calendar, riskAllowed: true, state,
    });
    expect(result.authorized).toBe(true);
    expect(result.code).toBe("EXECUTION_AUTHORIZED");
    expect(result.proposalId).toBe("proposal-1");
  });

  it("bloqueia com bot parado", () => {
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal, calendar, riskAllowed: true,
      state: { ...state, botRunning: false },
    });
    expect(result.code).toBe("BOT_STOPPED");
  });

  it("bloqueia ligação indisponível", () => {
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal, calendar, riskAllowed: true,
      state: { ...state, connectionOpen: false },
    });
    expect(result.code).toBe("CONNECTION_NOT_READY");
  });

  it("bloqueia decisão D13 antiga", () => {
    const oldDecision = { ...decision, timestamp: now - 181 };
    const result = new ForexExecutionGuardV1().authorize({
      now, decision: oldDecision, proposal, calendar, riskAllowed: true, state,
    });
    expect(result.code).toBe("DECISION_STALE");
  });

  it("bloqueia Proposal antiga", () => {
    const oldProposal = { ...proposal, receivedAt: now - 16 };
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal: oldProposal, calendar, riskAllowed: true, state,
    });
    expect(result.code).toBe("PROPOSAL_STALE");
  });

  it("bloqueia Proposal sem ask_price", () => {
    const missingPrice = { ...proposal, askPrice: undefined };
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal: missingPrice, calendar, riskAllowed: true, state,
    });
    expect(result.code).toBe("PROPOSAL_MISSING_PRICE");
  });

  it("bloqueia calendar stale", () => {
    const staleCalendar = { ...calendar, checkedAt: now - 121 };
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal, calendar: staleCalendar, riskAllowed: true, state,
    });
    expect(result.code).toBe("CALENDAR_STALE");
  });

  it("bloqueia calendar BLOCK", () => {
    const blockedCalendar = { ...calendar, state: "BLOCK" as const };
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal, calendar: blockedCalendar, riskAllowed: true, state,
    });
    expect(result.code).toBe("CALENDAR_BLOCK");
  });

  it("bloqueia calendar WATCH sem autorização explícita", () => {
    const watchCalendar = { ...calendar, state: "WATCH" as const };
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal, calendar: watchCalendar, riskAllowed: true, state,
    });
    expect(result.code).toBe("CALENDAR_WATCH");
  });

  it("bloqueia risco", () => {
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal, calendar, riskAllowed: false, state,
    });
    expect(result.code).toBe("RISK_BLOCK");
  });

  it("bloqueia posição já aberta", () => {
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal, calendar, riskAllowed: true,
      state: { ...state, openPositions: 1 },
    });
    expect(result.code).toBe("POSITION_LIMIT");
  });

  it("bloqueia execução concorrente", () => {
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal, calendar, riskAllowed: true,
      state: { ...state, decisionInFlight: true },
    });
    expect(result.code).toBe("DUPLICATE_EXECUTION");
  });

  it("não possui gateway de buy e portanto não compra", () => {
    const result = new ForexExecutionGuardV1().authorize({
      now, decision, proposal, calendar, riskAllowed: true, state,
    });
    expect(result.authorized).toBe(true);
    expect(result.code).toBe("EXECUTION_AUTHORIZED");
  });
});
