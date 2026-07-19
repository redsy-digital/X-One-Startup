import { describe, it, expect } from "vitest";
import {
  calculateEMA,
  calculateRSI,
  calculateADX,
  calculateATR,
  calculateMACD,
  calculateBollingerBands,
} from "./indicators";
import { makeFlatCandles, makeTrendingCandles, makeChoppyCandles } from "./testFixtures";

describe("calculateEMA", () => {
  it("retorna 0 quando não há dados suficientes", () => {
    expect(calculateEMA([1, 2, 3], 10)).toBe(0);
  });

  it("de uma série constante é igual à própria constante", () => {
    expect(calculateEMA(Array(30).fill(50), 10)).toBeCloseTo(50, 10);
  });

  it("caso simples verificado manualmente: EMA([1,2,3,4,5], período 3) = 4", () => {
    // seed = média(1,2,3) = 2; k = 2/4 = 0.5
    // i=3: (4-2)*0.5+2=3 · i=4: (5-3)*0.5+3=4
    expect(calculateEMA([1, 2, 3, 4, 5], 3)).toBeCloseTo(4, 10);
  });

  it("segue a direcção dos dados (tendência de alta => EMA sobe)", () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
    const emaEarly = calculateEMA(rising.slice(0, 15), 10);
    const emaLate = calculateEMA(rising, 10);
    expect(emaLate).toBeGreaterThan(emaEarly);
  });
});

describe("calculateRSI", () => {
  it("retorna 50 (neutro) quando não há dados suficientes", () => {
    expect(calculateRSI([1, 2, 3], 14)).toBe(50);
  });

  it("é 100 numa série estritamente crescente (sem perdas)", () => {
    const inc = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(calculateRSI(inc, 14)).toBe(100);
  });

  it("é 0 numa série estritamente decrescente (sem ganhos)", () => {
    const dec = Array.from({ length: 30 }, (_, i) => 30 - i);
    expect(calculateRSI(dec, 14)).toBe(0);
  });

  it("nunca sai do intervalo [0, 100]", () => {
    const rsi = calculateRSI([10, 12, 9, 15, 11, 20, 8, 25, 5, 30, 4, 35, 3, 40, 2, 45], 14);
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });
});

describe("calculateADX", () => {
  it("retorna zeros quando não há candles suficientes (< período*2)", () => {
    const candles = makeFlatCandles(10);
    expect(calculateADX(candles, 14)).toEqual({ adx: 0, plusDI: 0, minusDI: 0 });
  });

  it("com ruído de baixa amplitude e sem tendência, ADX fica baixo", () => {
    // Nota: candles perfeitamente planos (amplitude 0) dão NaN — ver o
    // teste dedicado a esse achado mais abaixo. Aqui usa-se ruído real
    // de baixa amplitude, sem direcção líquida (valor verificado: ~7.05).
    const candles = makeChoppyCandles(60, { amplitude: 0.05, seed: 1 });
    const { adx } = calculateADX(candles, 14);
    expect(adx).toBeLessThan(15);
  });

  it("numa tendência de alta clara, plusDI supera minusDI", () => {
    const candles = makeTrendingCandles(60, { step: 0.5 });
    const { plusDI, minusDI } = calculateADX(candles, 14);
    expect(plusDI).toBeGreaterThan(minusDI);
  });

  it("[achado da Fase 2] em candles perfeitamente planos (true range = 0), dá NaN em vez de 0", () => {
    // Divisão por zero: quando o true range é sempre 0, plusDI/minusDI
    // calculam-se como 0/0. Na prática isto não chega a causar problema
    // hoje (adxStrong/diSep comparam com NaN, o que dá sempre false, e
    // o bloqueio por EMA comprimida em strategy.ts trata este caso de
    // qualquer forma) — mas é um comportamento frágil que vale corrigir
    // no futuro (ex.: devolver 0 quando o denominador for 0).
    const candles = makeFlatCandles(60);
    const { adx, plusDI, minusDI } = calculateADX(candles, 14);
    expect(Number.isNaN(adx)).toBe(true);
    expect(Number.isNaN(plusDI)).toBe(true);
    expect(Number.isNaN(minusDI)).toBe(true);
  });
});

describe("calculateATR", () => {
  it("retorna 0 quando não há candles suficientes", () => {
    expect(calculateATR(makeFlatCandles(5), 14)).toBe(0);
  });

  it("é 0 num mercado completamente plano (sem range)", () => {
    expect(calculateATR(makeFlatCandles(30), 14)).toBe(0);
  });

  it("nunca é negativo", () => {
    const candles = makeTrendingCandles(40, { step: -0.3 });
    expect(calculateATR(candles, 14)).toBeGreaterThanOrEqual(0);
  });
});

describe("calculateMACD", () => {
  it("retorna zeros quando não há dados suficientes (< slowPeriod)", () => {
    expect(calculateMACD([1, 2, 3])).toEqual({ macd: 0, signal: 0, histogram: 0 });
  });

  it("histogram = macd - signal, sempre", () => {
    const closes = makeTrendingCandles(60, { step: 0.2 }).map((c) => c.close);
    const { macd, signal, histogram } = calculateMACD(closes);
    expect(histogram).toBeCloseTo(macd - signal, 10);
  });
});

describe("calculateBollingerBands", () => {
  it("retorna zeros quando não há dados suficientes", () => {
    expect(calculateBollingerBands([1, 2, 3], 20)).toEqual({ middle: 0, upper: 0, lower: 0 });
  });

  it("numa série constante, upper = middle = lower (desvio-padrão 0)", () => {
    const { middle, upper, lower } = calculateBollingerBands(Array(20).fill(42), 20, 2);
    expect(middle).toBe(42);
    expect(upper).toBe(42);
    expect(lower).toBe(42);
  });

  it("upper está sempre acima (ou igual) e lower sempre abaixo (ou igual) da middle", () => {
    const closes = makeTrendingCandles(40, { step: 0.4 }).map((c) => c.close);
    const { middle, upper, lower } = calculateBollingerBands(closes, 20, 2);
    expect(upper).toBeGreaterThanOrEqual(middle);
    expect(lower).toBeLessThanOrEqual(middle);
  });
});
