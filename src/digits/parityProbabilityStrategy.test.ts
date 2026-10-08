import { describe, expect, it } from "vitest";
import { findAnchorSignal, findAlternatingSignal, findBlockDensitySignal } from "./parityProbabilityStrategy";

describe("parity probability heuristics", () => {
  it("signals the minority parity after block saturation", () => {
    const signal = findBlockDensitySignal([1, 3, 5, 7, 9, 1, 3, 5, 2, 4], 10, 80);
    expect(signal?.entryContract).toBe("DIGITEVEN");
  });
  it("requires a strict alternating block", () => {
    expect(findAlternatingSignal([2, 1, 4, 3], 4)?.entryContract).toBe("DIGITODD");
    expect(findAlternatingSignal([2, 1, 3, 4], 4)).toBeNull();
  });
  it("signals opposite parity after a matching anchor", () => {
    expect(findAnchorSignal([2, 4, 0])?.entryContract).toBe("DIGITODD");
    expect(findAnchorSignal([1, 3, 9])?.entryContract).toBe("DIGITEVEN");
    expect(findAnchorSignal([2, 3, 0])).toBeNull();
  });
});
