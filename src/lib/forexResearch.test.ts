import { describe, expect, it } from "vitest";
import { benjaminiHochberg, buildFeatureScreening, buildFeatureStabilityMatrix, buildForexFeatureRows, runForexResearch, runUntouchedHoldout } from "./forexResearch";
import { makeChoppyCandles, makeTrendingCandles } from "./testFixtures";

function makeSyntheticCandles(count = 900) {
  return makeTrendingCandles(count, { step: 0.00001 });
}

describe("Forex Feature Direction & Regime Lab", () => {
  it("calcula AUC equivalente e identifica relação inversa sem a descartar", () => {
    const candles = makeSyntheticCandles(1200);
    const rows = buildForexFeatureRows(candles, 1);
    expect(rows.length).toBeGreaterThan(1000);
    const result = runForexResearch(candles, 1, 900, 15);
    for (const feature of result.features) {
      expect(feature.validationAucEquivalent).toBeGreaterThanOrEqual(0.5);
      expect(feature.validationAucEquivalent).toBeLessThanOrEqual(1);
      expect(["DIRECT", "INVERSE", "NEUTRAL"]).toContain(feature.validationAucDirection);
    }
  });

  it("mantém o teste de regime separado do alvo direcional", () => {
    const candles = makeChoppyCandles(1200, { amplitude: 0.0003, seed: 42 });
    const result = runForexResearch(candles, 2, 900, 30);
    const atr = result.features.find(f => f.key === "atrPct");
    const ema = result.features.find(f => f.key === "emaSpread");
    expect(atr).toBeDefined();
    expect(ema).toBeDefined();
    expect(atr!.role).toBe("REGIME");
    expect(ema!.role).toBe("DIRECTION");
    expect(atr!.regimeAuc).toBeGreaterThanOrEqual(0);
    expect(atr!.regimeAuc).toBeLessThanOrEqual(1);
    expect(ema!.regimeAuc).toBe(0.5);
  });

  it("mede a estabilidade da mesma feature nas janelas walk-forward", () => {
    const candles = makeChoppyCandles(1800, { amplitude: 0.0002, seed: 7 });
    const result = runForexResearch(candles, 1, 900, 15);
    expect(result.validationWindows.length).toBeGreaterThanOrEqual(2);
    for (const feature of result.features) {
      expect(feature.walkForwardWindows).toBe(result.validationWindows.length);
      expect(feature.walkForwardDirectionConsistency).toBeGreaterThanOrEqual(0);
      expect(feature.walkForwardDirectionConsistency).toBeLessThanOrEqual(1);
    }
  });

  it("preserva a granularidade e o horizonte em minutos no resultado", () => {
    const candles = makeChoppyCandles(800, { amplitude: 0.0002, seed: 9 });
    const result = runForexResearch(candles, 4, 300, 20);
    expect(result.timeframeMinutes).toBe(5);
    expect(result.targetMinutes).toBe(20);
    expect(result.granularitySeconds).toBe(300);
  });
});


describe("Feature Stability Matrix", () => {
  it("mantém a mesma feature congelada em múltiplas células sem seleccionar a melhor", () => {
    const candles = makeChoppyCandles(2200, { amplitude: 0.0002, seed: 21 });
    const results = [
      runForexResearch(candles, 3, 300, 15),
      runForexResearch(candles, 6, 300, 30),
      runForexResearch(candles, 12, 300, 60),
    ];
    const matrix = buildFeatureStabilityMatrix(results, "volatility20");
    expect(matrix.key).toBe("volatility20");
    expect(matrix.cells).toHaveLength(3);
    expect(matrix.totalCells).toBe(3);
    expect(matrix.cells.every(c => c.key === "volatility20")).toBe(true);
    expect(matrix.signalRate).toBeGreaterThanOrEqual(0);
    expect(matrix.signalRate).toBeLessThanOrEqual(1);
    expect(matrix.directionConsistency).toBeGreaterThanOrEqual(0);
    expect(matrix.directionConsistency).toBeLessThanOrEqual(1);
  });
});


describe("Untouched Holdout", () => {
  it("não altera a hipótese e não usa selecção no bloco intocado", () => {
    const candles = makeChoppyCandles(1600, { amplitude: 0.0002, seed: 31 });
    const result = runUntouchedHoldout(candles, 3, 300, 15, "volatility20", "INVERSE");
    expect(result.feature).toBe("volatility20");
    expect(result.timeframeMinutes).toBe(5);
    expect(result.targetMinutes).toBe(15);
    expect(result.expectedDirection).toBe("INVERSE");
    expect(result.protocol.featureFrozen).toBe(true);
    expect(result.protocol.timeframeFrozen).toBe(true);
    expect(result.protocol.targetFrozen).toBe(true);
    expect(result.protocol.directionFrozen).toBe(true);
    expect(result.protocol.selectionUsedHoldout).toBe(false);
    expect(["PASS", "FAIL", "INCONCLUSIVE"]).toContain(result.verdict);
    expect(result.aucEquivalent).toBeGreaterThanOrEqual(0.5);
    expect(result.aucEquivalent).toBeLessThanOrEqual(1);
  });
});


describe("Phase 3F — Feature Screening", () => {
  it("aplica Benjamini-Hochberg sem alterar a ordem original dos p-values", () => {
    const p = [0.001, 0.01, 0.04, 0.2];
    const q = benjaminiHochberg(p);
    expect(q).toHaveLength(4);
    expect(q.every(v => v >= 0 && v <= 1)).toBe(true);
    expect(q[0]).toBeLessThanOrEqual(q[1]);
    expect(q[1]).toBeLessThanOrEqual(q[2]);
  });

  it("testa o catálogo fechado e marca candidatos apenas para investigação", () => {
    const candles = makeChoppyCandles(2200, { amplitude: 0.0002, seed: 55 });
    const research = runForexResearch(candles, 3, 300, 15);
    const screening = buildFeatureScreening(research);
    expect(screening.testedFeatures).toBe(12);
    expect(screening.rows).toHaveLength(12);
    expect(screening.correction).toBe("BENJAMINI_HOCHBERG_FDR_5");
    expect(screening.rows.every(r => r.adjustedPValue >= r.validationAucPValue)).toBe(true);
    expect(screening.rows.every(r => r.bonferroniPValue >= r.validationAucPValue)).toBe(true);
    expect(screening.rows.every(r => ["TREND", "MOMENTUM", "VOLATILITY", "PRICE_ACTION"].includes(r.family))).toBe(true);
  });
});
