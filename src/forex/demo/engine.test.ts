import { describe, expect, it, vi } from "vitest";
import { ForexDemoTradingV1 } from "./engine";

const gateway = { buyProposal: vi.fn() };
const monitor = { subscribeContract: vi.fn(), onContractUpdate: vi.fn(() => () => undefined) };
const account = { isDemo: true, accountId: "VRTC123", currency: "USD", authorized: true };

function make() { return new ForexDemoTradingV1(gateway, monitor); }

describe("D19 Demo Trading", () => {
  it("blocks non-demo accounts before buy", async () => {
    const engine = make();
    const result = await engine.executeDemoBuy({ proposalId: "p1", price: 0.5, account: { ...account, isDemo: false } });
    expect(result.code).toBe("DEMO_ONLY_BLOCK");
    expect(gateway.buyProposal).not.toHaveBeenCalled();
  });

  it("blocks unauthorized accounts", async () => {
    const result = await make().executeDemoBuy({ proposalId: "p1", price: 0.5, account: { ...account, authorized: false } });
    expect(result.code).toBe("ACCOUNT_NOT_AUTHORIZED");
  });

  it("executes only after explicit demo verification and starts monitoring", async () => {
    gateway.buyProposal.mockResolvedValueOnce({ contractId: "c1", transactionId: "t1", buyPrice: 0.5, payout: 0.9 });
    const result = await make().executeDemoBuy({ proposalId: "p1", price: 0.5, account });
    expect(result.executed).toBe(true);
    expect(result.contractId).toBe("c1");
    expect(monitor.subscribeContract).toHaveBeenCalledWith("c1");
  });

  it("blocks duplicate active buys", async () => {
    gateway.buyProposal.mockResolvedValueOnce({ contractId: "c2" });
    const engine = make();
    await engine.executeDemoBuy({ proposalId: "p1", price: 0.5, account });
    const second = await engine.executeDemoBuy({ proposalId: "p2", price: 0.5, account });
    expect(second.code).toBe("DUPLICATE_BUY");
    expect(gateway.buyProposal).toHaveBeenCalledTimes(1);
  });

  it("does not treat a buy response without contract_id as executed", async () => {
    gateway.buyProposal.mockResolvedValueOnce({ raw: { buy: {} } });
    const result = await make().executeDemoBuy({ proposalId: "p1", price: 0.5, account });
    expect(result.code).toBe("BUY_RESPONSE_INVALID");
    expect(result.executed).toBe(false);
  });
});
