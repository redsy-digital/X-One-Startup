import { describe, expect, it } from "vitest";
import type { ForexCalendarDecision } from "../decision-engine/types";
import { ForexRiskEngineV1 } from "./engine";
import { DEFAULT_FOREX_RISK_CONFIG, type ForexRiskState } from "./types";

const clearCalendar = (): ForexCalendarDecision => ({
  state: "CLEAR",
  relevantEvents: [],
  checkedAt: 1_000_000,
});

const state = (overrides: Partial<ForexRiskState> = {}): ForexRiskState => ({
  sessionPnl: 0,
  dailyPnl: 0,
  consecutiveLosses: 0,
  tradesThisSession: 0,
  openPositions: 0,
  ...overrides,
});

const input = (overrides: Partial<Parameters<ForexRiskEngineV1["evaluate"]>[0]> = {}) => ({
  now: 2_000_000,
  stake: 0.5,
  accountBalance: 100,
  symbol: "frxEURUSD",
  direction: "CALL" as const,
  calendar: clearCalendar(),
  state: state(),
  ...overrides,
});

describe("ForexRiskEngineV1", () => {
  const engine = new ForexRiskEngineV1();

  it("approves the V1 baseline stake when all gates are clear", () => {
    const result = engine.evaluate(input());
    expect(result.allowed).toBe(true);
    expect(result.reasonCode).toBe("READY_FOR_EXECUTION");
  });

  it("never applies synthetic Martingale/Soros logic", () => {
    const result = engine.evaluate(input({ stake: 0.5, state: state({ consecutiveLosses: 2 }) }));
    expect(result.allowed).toBe(true);
    expect(result.stake).toBe(0.5);
  });

  it("blocks an economic-calendar risk block", () => {
    const result = engine.evaluate(input({
      calendar: { state: "BLOCK", reasonCode: "NEWS_BLOCK_HIGH_IMPACT", relevantEvents: [], checkedAt: 1 },
    }));
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("NEWS_BLOCK_HIGH_IMPACT");
  });

  it("fails closed when calendar state is unknown", () => {
    const result = engine.evaluate(input({ calendar: { state: "UNKNOWN", relevantEvents: [], checkedAt: 1 } }));
    expect(result.allowed).toBe(false);
  });

  it("blocks stake above the configured Forex ceiling", () => {
    const result = engine.evaluate(input({ stake: DEFAULT_FOREX_RISK_CONFIG.maxStakePerTrade + 0.01 }));
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("RISK_LIMIT");
  });

  it("blocks excessive account risk even when the absolute stake is allowed", () => {
    const result = engine.evaluate(input({ stake: 0.5, accountBalance: 10 }));
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("RISK_LIMIT");
  });

  it("allows only one open position by default", () => {
    const result = engine.evaluate(input({ state: state({ openPositions: 1 }) }));
    expect(result.allowed).toBe(false);
  });

  it("blocks after the session loss limit", () => {
    const result = engine.evaluate(input({ state: state({ sessionPnl: -5 }) }));
    expect(result.allowed).toBe(false);
  });

  it("blocks after the daily loss limit", () => {
    const result = engine.evaluate(input({ state: state({ dailyPnl: -10 }) }));
    expect(result.allowed).toBe(false);
  });

  it("blocks after the consecutive-loss limit", () => {
    const result = engine.evaluate(input({ state: state({ consecutiveLosses: 3 }) }));
    expect(result.allowed).toBe(false);
  });

  it("enforces minimum entry interval", () => {
    const result = engine.evaluate(input({
      state: state({ lastEntryAt: 1_950_000 }),
    }));
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("COOLDOWN_ACTIVE");
  });
});
