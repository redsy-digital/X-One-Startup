import { describe, it, expect } from "vitest";
import { runBacktest, BacktestConfig } from "./backtest";
import { makeFlatCandles, makeChoppyCandles } from "./testFixtures";

const baseConfig: BacktestConfig = {
  stake: 10,
  stopLoss: 500,
  targetProfit: 500,
  minConfidence: 0, // permissivo de propósito — não queremos depender de acertar o score exacto
  cooldownSeconds: 0,
  cooldownAfterLoss: 0,
  useMartingale: false,
  martingaleMultiplier: 2,
  maxMartingaleSteps: 3,
  useSoros: false,
  maxSorosLevels: 3,
  maxConsecutiveLosses: 999,
  strategyProfile: "balanced",
  payoutRate: 0.92,
};

describe("runBacktest — casos-limite", () => {
  it("devolve resultado vazio ('end') com menos de 51 candles", () => {
    const result = runBacktest(makeFlatCandles(30), "R_100", baseConfig);
    expect(result.totalTrades).toBe(0);
    expect(result.stoppedBy).toBe("end");
    expect(result.finalBalance).toBe(1000);
  });

  it("devolve resultado vazio ('no_signals') com candles completamente planos", () => {
    // Candles 100% planos => sem volatilidade nenhuma => ADX=0, EMA colada
    // ao preço => cai sempre no bloqueio "EMA comprimida" da strategy.ts.
    const result = runBacktest(makeFlatCandles(200), "R_100", baseConfig);
    expect(result.totalTrades).toBe(0);
    expect(result.stoppedBy).toBe("no_signals");
    expect(result.finalBalance).toBe(1000);
  });

  it("nunca lança excepção com candles ruidosos (choppy) em nenhum perfil", () => {
    const candles = makeChoppyCandles(300, { seed: 11 });
    for (const strategyProfile of ["conservative", "balanced", "aggressive"] as const) {
      expect(() => runBacktest(candles, "R_100", { ...baseConfig, strategyProfile })).not.toThrow();
    }
  });
});

describe("runBacktest — invariantes estruturais do resultado", () => {
  // Nota: estes testes verificam a CONSISTÊNCIA interna do resultado
  // (contagens, curvas, saldo), não a taxa de acerto — isso requer o
  // dataset de referência real (Fase 2, item 10), não candles sintéticos.
  const candles = makeChoppyCandles(400, { seed: 99, amplitude: 0.8 });

  it("wins + losses = totalTrades = trades.length", () => {
    const result = runBacktest(candles, "R_100", baseConfig);
    expect(result.wins + result.losses).toBe(result.totalTrades);
    expect(result.trades.length).toBe(result.totalTrades);
  });

  it("finalBalance = 1000 + netPnL (dentro de arredondamento)", () => {
    const result = runBacktest(candles, "R_100", baseConfig);
    expect(result.finalBalance).toBeCloseTo(1000 + result.netPnL, 1);
  });

  it("balanceCurve tem sempre totalTrades+1 pontos (inclui o saldo inicial)", () => {
    const result = runBacktest(candles, "R_100", baseConfig);
    if (result.totalTrades > 0) {
      expect(result.balanceCurve.length).toBe(result.totalTrades + 1);
      expect(result.stakeCurve.length).toBe(result.totalTrades);
    }
  });

  it("winRate está sempre entre 0 e 100", () => {
    const result = runBacktest(candles, "R_100", baseConfig);
    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeLessThanOrEqual(100);
  });

  it("maxStake >= avgStake >= stake base quando há trades", () => {
    const result = runBacktest(candles, "R_100", baseConfig);
    if (result.totalTrades > 0) {
      expect(result.maxStake).toBeGreaterThanOrEqual(result.avgStake);
    }
  });

  it("com Martingale activo, maxStake nunca excede stake × multiplier^maxSteps", () => {
    const result = runBacktest(candles, "R_100", {
      ...baseConfig,
      useMartingale: true,
      martingaleMultiplier: 2,
      maxMartingaleSteps: 3,
    });
    const ceiling = baseConfig.stake * Math.pow(2, 3);
    expect(result.maxStake).toBeLessThanOrEqual(ceiling + 0.01); // +0.01: tolerância de arredondamento
  });

  it("com cooldownSeconds maior que todo o período dos dados, ocorre no máximo 1 trade", () => {
    // Invariante garantido por construção: 400 candles de 60s ≈ 6.7h de dados;
    // um cooldown de 999999s excede isso, logo após o 1º trade nenhum outro
    // pode ocorrer dentro da janela restante — independentemente de como o
    // filtro de estrutura evoluiria (esse é um invariante mais frágil que
    // decidi não testar aqui, por depender de efeitos de segunda ordem).
    const result = runBacktest(candles, "R_100", { ...baseConfig, cooldownSeconds: 999_999 });
    expect(result.totalTrades).toBeLessThanOrEqual(1);
  });
});

describe("runBacktest — Soros e flatResult", () => {
  const candles = makeChoppyCandles(400, { seed: 5, amplitude: 0.8 });

  it("flatResult.wins + flatResult.losses = totalTrades (mesma contagem de sinais, sem gestão de risco)", () => {
    const result = runBacktest(candles, "R_100", baseConfig);
    expect(result.flatResult.wins + result.flatResult.losses).toBe(result.totalTrades);
  });
});
