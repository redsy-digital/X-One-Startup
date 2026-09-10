import { describe, expect, it, vi } from "vitest";
import { ForexProposalEngineV1 } from "./engine";

function mockDeriv(proposal: any) {
  return {
    probeProposal: vi.fn().mockResolvedValue(proposal),
  } as any;
}

const base = {
  symbol: "frxEURUSD",
  direction: "CALL" as const,
  stake: 0.5,
  durationMinutes: 15 as const,
  currency: "USD",
};

describe("D15 — Forex Proposal Engine V1", () => {
  it.each([15, 30, 60, 120])("aceita duração validada %s min", async (durationMinutes) => {
    const deriv = mockDeriv({ id: "proposal-123", ask_price: "0.50", payout: "0.90", spot: 1.17 });
    const result = await new ForexProposalEngineV1(deriv).request({ ...base, durationMinutes: durationMinutes as any });
    expect(result.valid).toBe(true);
    expect(deriv.probeProposal).toHaveBeenCalledWith("frxEURUSD", "CALL", 0.5, durationMinutes, "m", "USD");
  });

  it("rejeita duração não validada antes de chamar a Deriv", async () => {
    const deriv = mockDeriv({ id: "never" });
    const result = await new ForexProposalEngineV1(deriv).request({ ...base, durationMinutes: 45 as any });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_DURATION");
    expect(deriv.probeProposal).not.toHaveBeenCalled();
  });

  it("rejeita stake abaixo de $0.50", async () => {
    const deriv = mockDeriv({ id: "never" });
    const result = await new ForexProposalEngineV1(deriv).request({ ...base, stake: 0.49 });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_STAKE");
    expect(deriv.probeProposal).not.toHaveBeenCalled();
  });

  it("aceita resposta New API quando números vêm como strings", async () => {
    const deriv = mockDeriv({ id: "proposal-abc", ask_price: "0.50", payout: "0.91", spot: 1.1701 });
    const result = await new ForexProposalEngineV1(deriv).request(base);
    expect(result.proposal?.askPrice).toBe(0.5);
    expect(result.proposal?.payout).toBe(0.91);
  });

  it("falha fechado quando a resposta não contém proposal.id", async () => {
    const deriv = mockDeriv({ ask_price: "0.50", payout: "0.90" });
    const result = await new ForexProposalEngineV1(deriv).request(base);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("PROPOSAL_MISSING_ID");
  });

  it("não chama buy — D15 só consulta proposal", async () => {
    const deriv = mockDeriv({ id: "proposal-123", ask_price: "0.50" });
    const buy = vi.fn();
    deriv.buy = buy;
    await new ForexProposalEngineV1(deriv).request(base);
    expect(buy).not.toHaveBeenCalled();
  });

  it("propaga rejeição da Deriv como PROPOSAL_REJECTED", async () => {
    const deriv = { probeProposal: vi.fn().mockRejectedValue(new Error("Trade is not offered for this duration")) } as any;
    const result = await new ForexProposalEngineV1(deriv).request(base);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("PROPOSAL_REJECTED");
    expect(result.reason).toContain("Trade is not offered");
  });
});
