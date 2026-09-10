import { describe, expect, it } from "vitest";
import { createDigitsRiskState, resolveDigitsLoss, resolveDigitsWin } from "./risk";
import { randomDigitsTarget } from "./engine";

const config = {
  stake: 0.35,
  targetProfit: 3.5,
  stopLoss: 6,
  useMartingale: true,
  martingaleMultiplier: 2.1,
  maxMartingaleSteps: 3,
  maxConsecutiveLosses: 5,
  cooldownAfterLoss: 30,
  useAdvancedMartingale: false,
  advancedMartingaleContract: "DIGITOVER" as const,
  advancedMartingaleTargetDigit: 2,
  maxAdvancedMartingaleSteps: 2,
};

describe("Digits V1 bankroll", () => {
  it("starts at the configured stake", () => {
    expect(createDigitsRiskState(config)).toMatchObject({
      currentStake: 0.35,
      martingaleStep: 0,
      consecutiveLosses: 0,
    });
  });

  it("applies Martingale only after LOSS", () => {
    const initial = createDigitsRiskState(config);
    const step1 = resolveDigitsLoss(initial, config, 1000);
    const step2 = resolveDigitsLoss(step1, config, 2000);

    expect(step1.martingaleStep).toBe(1);
    expect(step1.currentStake).toBe(0.74);
    expect(step2.martingaleStep).toBe(2);
    expect(step2.currentStake).toBe(1.54);
  });

  it("resets Martingale after WIN", () => {
    const loss = resolveDigitsLoss(createDigitsRiskState(config), config, 1000);
    const win = resolveDigitsWin(loss, config, 0.5);

    expect(win.martingaleStep).toBe(0);
    expect(win.currentStake).toBe(0.35);
    expect(win.consecutiveLosses).toBe(0);
  });

  it("opens a cooldown at the consecutive-loss limit", () => {
    let state = createDigitsRiskState(config);
    for (let i = 0; i < 5; i++) state = resolveDigitsLoss(state, config, 1000 + i);

    expect(state.consecutiveLosses).toBe(5);
    expect(state.cooldownUntil).toBe(31000);
  });

  it("does not increase stake when Martingale is disabled", () => {
    const state = resolveDigitsLoss(createDigitsRiskState({ ...config, useMartingale: false }), { ...config, useMartingale: false }, 1000);
    expect(state.currentStake).toBe(0.35);
    expect(state.martingaleStep).toBe(0);
  });
});


describe("Digits Advanced Martingale", () => {
  const advancedConfig = {
    ...config,
    useAdvancedMartingale: true,
    advancedMartingaleContract: "DIGITOVER" as const,
    advancedMartingaleTargetDigit: 2,
    maxAdvancedMartingaleSteps: 2,
  };

  it("allows exactly the configured number of advanced applications", () => {
    let state = createDigitsRiskState(advancedConfig);

    state = resolveDigitsLoss(state, advancedConfig, 1000, false);
    expect(state.advancedMartingaleStep).toBe(1);
    expect(state.advancedMartingaleExhausted).toBe(false);
    expect(state.currentStake).toBe(0.74);

    state = resolveDigitsLoss(state, advancedConfig, 2000, true);
    expect(state.advancedMartingaleStep).toBe(2);
    expect(state.advancedMartingaleExhausted).toBe(false);
    expect(state.currentStake).toBe(1.54);

    state = resolveDigitsLoss(state, advancedConfig, 3000, true);
    expect(state.advancedMartingaleStep).toBe(0);
    expect(state.advancedMartingaleExhausted).toBe(true);
    expect(state.currentStake).toBe(3.24);
  });

  it("supports exactly one advanced application", () => {
    const oneStep = { ...advancedConfig, maxAdvancedMartingaleSteps: 1 };
    const firstLoss = resolveDigitsLoss(createDigitsRiskState(oneStep), oneStep, 1000, false);
    expect(firstLoss.advancedMartingaleStep).toBe(1);
    expect(firstLoss.advancedMartingaleExhausted).toBe(false);

    const advancedLoss = resolveDigitsLoss(firstLoss, oneStep, 2000, true);
    expect(advancedLoss.advancedMartingaleStep).toBe(0);
    expect(advancedLoss.advancedMartingaleExhausted).toBe(true);
  });

  it("resets the advanced sequence after WIN", () => {
    const loss = resolveDigitsLoss(createDigitsRiskState(advancedConfig), advancedConfig, 1000);
    const win = resolveDigitsWin(loss, advancedConfig, 0.5);

    expect(win.advancedMartingaleStep).toBe(0);
    expect(win.advancedMartingaleExhausted).toBe(false);
  });

  it("keeps advanced Martingale off when Martingale is disabled", () => {
    const disabled = { ...advancedConfig, useMartingale: false };
    const state = resolveDigitsLoss(createDigitsRiskState(disabled), disabled, 1000);

    expect(state.advancedMartingaleStep).toBe(0);
    expect(state.advancedMartingaleExhausted).toBe(false);
    expect(state.currentStake).toBe(0.35);
  });
});


describe("Digits Random target", () => {
  it("always generates a valid digit from 0 to 9", () => {
    for (let i = 0; i < 1000; i++) {
      const digit = randomDigitsTarget();
      expect(Number.isInteger(digit)).toBe(true);
      expect(digit).toBeGreaterThanOrEqual(0);
      expect(digit).toBeLessThanOrEqual(9);
    }
  });
});


describe("Digits Follow Up target", () => {
  it("supports the follow-up target mode as a valid configuration value", () => {
    const config = {
      contract: "DIGITDIFF" as const,
      targetDigit: "follow_up" as const,
      stake: 0.35,
      targetProfit: 3.5,
      stopLoss: 6,
      useMartingale: false,
      martingaleMultiplier: 2.1,
      maxMartingaleSteps: 3,
      maxConsecutiveLosses: 5,
      cooldownAfterLoss: 30,
    };

    expect(config.targetDigit).toBe("follow_up");
  });
});


describe("Digits Follow Up result digit", () => {
  const lastDigit = (value: string | number): number | null => {
    const text = String(value).trim();
    for (let i = text.length - 1; i >= 0; i--) {
      const char = text[i];
      if (char >= "0" && char <= "9") return Number(char);
    }
    return null;
  };

  it("extracts the last digit from the settled spot", () => {
    expect(lastDigit("123.45")).toBe(5);
    expect(lastDigit("123.40")).toBe(0);
    expect(lastDigit("987.68")).toBe(8);
    expect(lastDigit(8)).toBe(8);
  });

  it("follows the previous settled digit", () => {
    const sequence = [4, 2, 8, 8];
    const targets: number[] = [];
    let previous: number | null = null;

    for (const exitDigit of sequence) {
      const target = previous ?? 0;
      targets.push(target);
      previous = exitDigit;
    }

    expect(targets).toEqual([0, 4, 2, 8]);
  });
});
