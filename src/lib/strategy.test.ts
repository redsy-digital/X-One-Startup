import { describe, it, expect } from "vitest";
import { analyzeMarket, STRATEGY_PROFILES } from "./strategy";
import { makeFlatCandles, makeTrendingCandles, makeChoppyCandles } from "./testFixtures";

describe("analyzeMarket — casos-limite", () => {
  it("devolve NEUTRAL quando há menos de 50 candles", () => {
    const result = analyzeMarket(makeFlatCandles(10), "R_100", "balanced");
    expect(result.type).toBe("NEUTRAL");
    expect(result.confidence).toBe(0);
  });

  it("devolve NEUTRAL com exactamente 49 candles (limite -1)", () => {
    const result = analyzeMarket(makeFlatCandles(49), "R_100", "balanced");
    expect(result.type).toBe("NEUTRAL");
  });
});

describe("analyzeMarket — invariantes (não prevêem direcção exacta)", () => {
  const scenarios: Array<[string, () => ReturnType<typeof makeFlatCandles>]> = [
    ["candles planos", () => makeFlatCandles(80)],
    ["tendência de alta", () => makeTrendingCandles(80, { step: 0.3 })],
    ["tendência de baixa", () => makeTrendingCandles(80, { step: -0.3 })],
    ["choppy/ruído", () => makeChoppyCandles(80, { seed: 7 })],
  ];

  for (const [label, build] of scenarios) {
    it(`(${label}) confidence fica sempre dentro de [0, 95] e marketCondition é válido`, () => {
      const result = analyzeMarket(build(), "R_100", "balanced");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(95);
      expect(["TRENDING", "CHOPPY"]).toContain(result.indicators.marketCondition);
      expect(Number.isNaN(result.confidence)).toBe(false);
      expect(Number.isFinite(result.indicators.score)).toBe(true);
    });

    it(`(${label}) não lança excepção em nenhum dos 3 perfis de estratégia`, () => {
      for (const profile of ["conservative", "balanced", "aggressive"] as const) {
        expect(() => analyzeMarket(build(), "R_100", profile)).not.toThrow();
      }
    });
  }

  it("quando NEUTRAL, confidence é sempre 0", () => {
    // candles planos tendem a ficar comprimidos/bloqueados => NEUTRAL na maioria dos perfis
    const result = analyzeMarket(makeFlatCandles(80), "R_100", "conservative");
    if (result.type === "NEUTRAL") {
      expect(result.confidence).toBe(0);
    }
  });
});

describe("STRATEGY_PROFILES — requireTrending (achado da auditoria)", () => {
  // A Fase 1/2 da auditoria encontrou uma inconsistência: a UI
  // (StrategyPanel.tsx) descreve o perfil "conservative" como
  // "Só opera em TRENDING", mas requireTrending está a false nos
  // 3 perfis e analyzeMarket() nunca lê este campo — ou seja, hoje
  // ele não tem NENHUM efeito real na geração de sinais.
  //
  // Este teste fixa o comportamento ACTUAL (não o desejado). Se a
  // Fase 3 decidir implementar requireTrending de verdade, este
  // teste deve ser actualizado conscientemente nessa altura.
  it("está a false nos 3 perfis (comportamento actual, não implementado)", () => {
    expect(STRATEGY_PROFILES.conservative.requireTrending).toBe(false);
    expect(STRATEGY_PROFILES.balanced.requireTrending).toBe(false);
    expect(STRATEGY_PROFILES.aggressive.requireTrending).toBe(false);
  });
});
