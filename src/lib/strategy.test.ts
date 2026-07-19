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

describe("STRATEGY_PROFILES — requireTrending (implementado na Fase 2)", () => {
  // A auditoria encontrou esta inconsistência: a UI (StrategyPanel.tsx)
  // sempre descreveu o perfil "conservative" como "Só opera em TRENDING",
  // mas requireTrending nunca era lido por analyzeMarket() — não tinha
  // nenhum efeito real. O usuário decidiu implementar de verdade.
  //
  // "conservative" passou a true (é o único cuja descrição na UI já
  // prometia isto); "balanced"/"aggressive" continuam false, consistente
  // com as suas próprias descrições ("qualquer mercado").
  it("está activo só no perfil conservador", () => {
    expect(STRATEGY_PROFILES.conservative.requireTrending).toBe(true);
    expect(STRATEGY_PROFILES.balanced.requireTrending).toBe(false);
    expect(STRATEGY_PROFILES.aggressive.requireTrending).toBe(false);
  });

  it("perfil conservador: só é não-NEUTRAL quando marketCondition é TRENDING", () => {
    const scenarios = [
      makeFlatCandles(80),
      makeTrendingCandles(80, { step: 0.3 }),
      makeTrendingCandles(80, { step: -0.3 }),
      makeChoppyCandles(80, { seed: 7 }),
      makeChoppyCandles(80, { seed: 3, amplitude: 0.5 }),
      makeChoppyCandles(200, { seed: 123, amplitude: 0.7 }),
    ];
    for (const candles of scenarios) {
      const result = analyzeMarket(candles, "R_100", "conservative");
      if (result.type !== "NEUTRAL") {
        expect(result.indicators.marketCondition).toBe("TRENDING");
      }
    }
  });

  it("perfil conservador em mercado CHOPPY: NEUTRAL com motivo explícito", () => {
    const result = analyzeMarket(makeChoppyCandles(80, { seed: 7 }), "R_100", "conservative");
    expect(result.indicators.marketCondition).toBe("CHOPPY");
    expect(result.type).toBe("NEUTRAL");
    expect(result.indicators.reason).toContain("Perfil exige TRENDING");
  });
});
