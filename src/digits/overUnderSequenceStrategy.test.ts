import { describe, expect, it } from "vitest";
import { consumeOverUnderSequence, INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE } from "./sequenceStrategy";

const cfg = { sequenceLength: 5, overBarrier: 4, underBarrier: 5 };

describe("Digits Sequência Over/Under", () => {
  it("triggers Under 5 on the fifth high digit", () => {
    let state = INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE;
    for (const digit of [5, 7, 9, 6]) {
      const r = consumeOverUnderSequence(state, digit, cfg); state = r.state;
      expect(r.triggerContract).toBeNull();
    }
    const r = consumeOverUnderSequence(state, 8, cfg);
    expect(r.triggerContract).toBe("DIGITUNDER");
    expect(r.triggerTargetDigit).toBe(5);
    expect(r.state).toEqual(INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE);
  });

  it("triggers Over 4 on the fifth low digit", () => {
    let state = INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE;
    for (const digit of [4, 2, 0, 3]) state = consumeOverUnderSequence(state, digit, cfg).state;
    const r = consumeOverUnderSequence(state, 1, cfg);
    expect(r.triggerContract).toBe("DIGITOVER");
    expect(r.triggerTargetDigit).toBe(4);
  });

  it("neutral digits break the sequence", () => {
    let state = INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE;
    state = consumeOverUnderSequence(state, 9, cfg).state;
    state = consumeOverUnderSequence(state, 6, cfg).state;
    const r = consumeOverUnderSequence(state, 4, { ...cfg, sequenceLength: 3 });
    expect(r.state.count).toBe(1);
    expect(r.state.group).toBe("low");
    expect(r.triggerContract).toBeNull();
  });

  it("supports a configurable gap: 0-3 low and 7-9 high", () => {
    const c = { sequenceLength: 2, overBarrier: 3, underBarrier: 7 };
    let state = INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE;
    state = consumeOverUnderSequence(state, 8, c).state;
    const r = consumeOverUnderSequence(state, 9, c);
    expect(r.triggerContract).toBe("DIGITUNDER");
    expect(r.triggerTargetDigit).toBe(7);
  });

  it("never waits for the next tick", () => {
    let state = INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE;
    for (const digit of [5, 6, 7, 8]) state = consumeOverUnderSequence(state, digit, cfg).state;
    const fifth = consumeOverUnderSequence(state, 9, cfg);
    expect(fifth.triggerContract).toBe("DIGITUNDER");
  });
});
