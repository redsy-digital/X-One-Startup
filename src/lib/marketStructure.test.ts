import { describe, it, expect } from "vitest";
import {
  createStructureState,
  evaluateStructure,
  recordStructureTrade,
  recordStructureResult,
  resetStructureSession,
  isBlockedByStructure,
} from "./marketStructure";
import { Candle, StrategyIndicators, TradeSignal } from "../types";

function candle(open: number, close: number, time = 1_700_000_000): Candle {
  return { time, open, high: Math.max(open, close), low: Math.min(open, close), close };
}

function fakeSignal(overrides: Partial<StrategyIndicators> = {}, type: TradeSignal["type"] = "CALL"): TradeSignal {
  return {
    type,
    confidence: 70,
    indicators: {
      emaFast: 100,
      emaSlow: 100,
      rsi: 50,
      adx: 20,
      atr: 1,
      score: 50,
      confidence: 70,
      marketCondition: "TRENDING",
      ...overrides,
    },
  };
}

describe("evaluateStructure", () => {
  it("a primeira avaliação reseta sempre (direcção inicial é null)", () => {
    const state = createStructureState();
    const candles = [candle(100, 101), candle(101, 102), candle(102, 103), candle(103, 104), candle(104, 105)];
    const result = evaluateStructure(state, candles, fakeSignal({ emaFast: 104, emaSlow: 100, marketCondition: "TRENDING" }));
    expect(result.wasReset).toBe(true);
    expect(result.currentDirection).toBe("UP");
    expect(state.currentStructureDirection).toBe("UP");
  });

  it("mantém-se sem reset numa estrutura UP estável (sem pullback, sem quebra de EMA)", () => {
    const state = createStructureState();
    const up5 = [candle(100, 101), candle(101, 102), candle(102, 103), candle(103, 104), candle(104, 105)];
    evaluateStructure(state, up5, fakeSignal({ emaFast: 104, emaSlow: 100 })); // 1ª chamada, estabelece UP
    const idAfterFirst = state.currentStructureId;

    const result = evaluateStructure(state, up5, fakeSignal({ emaFast: 106, emaSlow: 101 }));
    expect(result.wasReset).toBe(false);
    expect(state.currentStructureId).toBe(idAfterFirst); // ID não mudou
  });

  it("reseta em pullback estrutural (3+ candles vermelhos nos últimos 5) durante UP", () => {
    const state = createStructureState();
    const up5 = [candle(100, 101), candle(101, 102), candle(102, 103), candle(103, 104), candle(104, 105)];
    evaluateStructure(state, up5, fakeSignal({ emaFast: 104, emaSlow: 100 })); // estabelece UP

    // 3 vermelhos nos últimos 5, mesma direcção dominante (emaFast>emaSlow continua)
    const pullback = [candle(100, 99), candle(99, 98), candle(98, 99), candle(99, 100), candle(100, 99)];
    const result = evaluateStructure(state, pullback, fakeSignal({ emaFast: 104, emaSlow: 100 }));
    expect(result.wasReset).toBe(true);
    expect(result.resetReason).toBe("Pullback Estrutural (3+ Red)");
  });

  it("reseta em quebra de suporte (close < emaSlow) durante UP sem pullback", () => {
    const state = createStructureState();
    const up5 = [candle(100, 101), candle(101, 102), candle(102, 103), candle(103, 104), candle(104, 105)];
    evaluateStructure(state, up5, fakeSignal({ emaFast: 104, emaSlow: 100 })); // estabelece UP

    // Só 1 vermelho (não é pullback), mas fecha abaixo da EMA slow
    const breakDown = [candle(100, 101), candle(101, 102), candle(102, 103), candle(103, 104), candle(104, 90)];
    const result = evaluateStructure(state, breakDown, fakeSignal({ emaFast: 104, emaSlow: 95 }));
    expect(result.wasReset).toBe(true);
    expect(result.resetReason).toBe("Quebra de Suporte (EMA Slow)");
  });

  it("reseta em pullback estrutural (3+ candles verdes nos últimos 5) durante DOWN", () => {
    const state = createStructureState();
    const down5 = [candle(105, 104), candle(104, 103), candle(103, 102), candle(102, 101), candle(101, 100)];
    evaluateStructure(state, down5, fakeSignal({ emaFast: 100, emaSlow: 104 })); // estabelece DOWN

    const pullback = [candle(100, 101), candle(101, 102), candle(102, 101), candle(101, 100), candle(100, 101)];
    const result = evaluateStructure(state, pullback, fakeSignal({ emaFast: 100, emaSlow: 104 }));
    expect(result.wasReset).toBe(true);
    expect(result.resetReason).toBe("Pullback Estrutural (3+ Green)");
  });

  it("mudança de direcção dominante (UP -> DOWN) reseta", () => {
    const state = createStructureState();
    const up5 = [candle(100, 101), candle(101, 102), candle(102, 103), candle(103, 104), candle(104, 105)];
    evaluateStructure(state, up5, fakeSignal({ emaFast: 104, emaSlow: 100 })); // estabelece UP

    const down5 = [candle(105, 104), candle(104, 103), candle(103, 102), candle(102, 101), candle(101, 100)];
    const result = evaluateStructure(state, down5, fakeSignal({ emaFast: 100, emaSlow: 104 }));
    expect(result.wasReset).toBe(true);
    expect(result.currentDirection).toBe("DOWN");
  });

  it("entrar em CHOPPY vindo de UP reseta com o motivo específico de lateralização", () => {
    const state = createStructureState();
    const up5 = [candle(100, 101), candle(101, 102), candle(102, 103), candle(103, 104), candle(104, 105)];
    evaluateStructure(state, up5, fakeSignal({ emaFast: 104, emaSlow: 100, marketCondition: "TRENDING" }));

    const result = evaluateStructure(state, up5, fakeSignal({ marketCondition: "CHOPPY" }));
    expect(result.wasReset).toBe(true);
    expect(result.resetReason).toBe("Entrada em Zona de Lateralização");
    expect(result.currentDirection).toBe("CHOPPY");
  });

  it("permanecer em CHOPPY não reseta de novo", () => {
    const state = createStructureState();
    const c5 = [candle(100, 101), candle(101, 100), candle(100, 101), candle(101, 100), candle(100, 101)];
    evaluateStructure(state, c5, fakeSignal({ marketCondition: "CHOPPY" })); // entra em CHOPPY (1ª chamada)
    const result = evaluateStructure(state, c5, fakeSignal({ marketCondition: "CHOPPY" }));
    expect(result.wasReset).toBe(false);
  });
});

describe("recordStructureTrade / recordStructureResult", () => {
  it("recordTrade regista o tipo e faz snapshot do ID de estrutura actual", () => {
    const state = createStructureState();
    state.currentStructureId = "abc123";
    recordStructureTrade(state, "CALL");
    expect(state.lastTradeType).toBe("CALL");
    expect(state.lastTradeStructureId).toBe("abc123");
  });

  it("recordResult('LOST') zera candlesSinceLastLoss", () => {
    const state = createStructureState();
    state.candlesSinceLastLoss = 7;
    recordStructureResult(state, "LOST");
    expect(state.lastTradeResult).toBe("LOST");
    expect(state.candlesSinceLastLoss).toBe(0);
  });

  it("recordResult('WON') não mexe em candlesSinceLastLoss", () => {
    const state = createStructureState();
    state.candlesSinceLastLoss = 7;
    recordStructureResult(state, "WON");
    expect(state.lastTradeResult).toBe("WON");
    expect(state.candlesSinceLastLoss).toBe(7);
  });
});

describe("resetStructureSession", () => {
  it("limpa todos os campos de sessão", () => {
    const state = createStructureState();
    state.lastTradeResult = "LOST";
    state.lastTradeType = "PUT";
    state.lastTradeStructureId = "xyz";
    state.candlesSinceLastLoss = 5;
    state.currentStructureDirection = "DOWN";

    resetStructureSession(state);

    expect(state.lastTradeResult).toBeNull();
    expect(state.lastTradeType).toBeNull();
    expect(state.lastTradeStructureId).toBeNull();
    expect(state.candlesSinceLastLoss).toBe(0);
    expect(state.currentStructureDirection).toBeNull();
    expect(typeof state.currentStructureId).toBe("string");
  });
});

describe("isBlockedByStructure", () => {
  it("bloqueia quando: última perdeu + mesma direcção + mesma estrutura", () => {
    const state = createStructureState();
    state.lastTradeResult = "LOST";
    state.lastTradeType = "CALL";
    state.lastTradeStructureId = state.currentStructureId;
    expect(isBlockedByStructure(state, "CALL")).toBe(true);
  });

  it("não bloqueia se a última operação ganhou", () => {
    const state = createStructureState();
    state.lastTradeResult = "WON";
    state.lastTradeType = "CALL";
    state.lastTradeStructureId = state.currentStructureId;
    expect(isBlockedByStructure(state, "CALL")).toBe(false);
  });

  it("não bloqueia se a direcção do novo sinal é diferente", () => {
    const state = createStructureState();
    state.lastTradeResult = "LOST";
    state.lastTradeType = "CALL";
    state.lastTradeStructureId = state.currentStructureId;
    expect(isBlockedByStructure(state, "PUT")).toBe(false);
  });

  it("não bloqueia se a estrutura já mudou entretanto", () => {
    const state = createStructureState();
    state.lastTradeResult = "LOST";
    state.lastTradeType = "CALL";
    state.lastTradeStructureId = "estrutura-antiga";
    // currentStructureId é diferente de "estrutura-antiga"
    expect(isBlockedByStructure(state, "CALL")).toBe(false);
  });
});
