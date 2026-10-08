import { describe, expect, it } from "vitest";
import { consumeDigitsSequence, INITIAL_DIGITS_SEQUENCE_STATE } from "./sequenceStrategy";

const fixedEven = { mode: "fixed" as const, sequenceLength: 6, entryContract: "DIGITEVEN" as const };
const fixedOdd = { mode: "fixed" as const, sequenceLength: 6, entryContract: "DIGITODD" as const };
const multiple = { mode: "multiple" as const, sequenceLength: 6, entryContract: "DIGITEVEN" as const };

function feed(digits: number[], config: typeof fixedEven) {
  let state = INITIAL_DIGITS_SEQUENCE_STATE;
  let trigger = null as string | null;
  digits.forEach((digit) => {
    const result = consumeDigitsSequence(state, digit, config);
    state = result.state;
    if (result.triggerContract) trigger = result.triggerContract;
  });
  return { state, trigger };
}

describe("Digits Sequence Par/Ímpar", () => {
  it("triggers Par exactly on the sixth odd digit", () => {
    let state = INITIAL_DIGITS_SEQUENCE_STATE;
    const odd = [1, 3, 5, 7, 9];
    for (const digit of odd) {
      const result = consumeDigitsSequence(state, digit, fixedEven);
      state = result.state;
      expect(result.triggerContract).toBeNull();
    }
    const sixth = consumeDigitsSequence(state, 1, fixedEven);
    expect(sixth.triggerContract).toBe("DIGITEVEN");
    expect(sixth.state).toEqual(INITIAL_DIGITS_SEQUENCE_STATE);
  });

  it("does not trigger on the seventh digit of the same sequence", () => {
    const result = feed([1, 3, 5, 7, 9, 1, 3], fixedEven);
    expect(result.trigger).toBe("DIGITEVEN");
    expect(result.state).toEqual({ parity: "odd", count: 1 });
  });

  it("does not trigger Par after six consecutive even digits when Par is selected", () => {
    const result = feed([0, 2, 4, 6, 8, 0], fixedEven);
    expect(result.trigger).toBeNull();
    expect(result.state).toEqual({ parity: "even", count: 6 });
  });

  it("triggers Ímpar after six consecutive even digits", () => {
    const result = feed([0, 2, 4, 6, 8, 0], fixedOdd);
    expect(result.trigger).toBe("DIGITODD");
  });

  it("resets a broken sequence instead of counting non-consecutive digits", () => {
    const result = feed([1, 3, 5, 2, 7, 9, 1], fixedEven);
    expect(result.trigger).toBeNull();
    expect(result.state).toEqual({ parity: "odd", count: 3 });
  });

  it("in multiple mode enters the opposite parity", () => {
    expect(feed([0, 2, 4, 6, 8, 0], multiple).trigger).toBe("DIGITODD");
    expect(feed([1, 3, 5, 7, 9, 1], multiple).trigger).toBe("DIGITEVEN");
  });

  it("supports sequence length one", () => {
    const result = consumeDigitsSequence(INITIAL_DIGITS_SEQUENCE_STATE, 2, { ...fixedOdd, sequenceLength: 1 });
    expect(result.triggerContract).toBe("DIGITODD");
  });
});
