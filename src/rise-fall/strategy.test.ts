import { describe, expect, it } from "vitest";
import { findAlternatingSignal, findBlockDensitySignal, findSequenceSignal } from "./strategy";

describe("Rise/Fall mathematical strategies", () => {
  it("reverses a directional sequence", () => {
    expect(findSequenceSignal(["UP", "UP", "UP", "UP"], 4)?.contract).toBe("PUT");
    expect(findSequenceSignal(["DOWN", "DOWN", "DOWN", "DOWN"], 4)?.contract).toBe("CALL");
  });
  it("selects the minority direction after density", () => {
    expect(findBlockDensitySignal(["DOWN","DOWN","DOWN","DOWN","DOWN","DOWN","DOWN","DOWN","UP","UP"], 10, 80)?.contract).toBe("CALL");
  });
  it("breaks strict alternation by repeating the last direction", () => {
    expect(findAlternatingSignal(["UP","DOWN","UP","DOWN"], 4)?.contract).toBe("PUT");
  });
});
