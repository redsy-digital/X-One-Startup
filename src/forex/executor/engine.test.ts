import { describe, expect, it, vi } from "vitest";
import { ForexTradeExecutorV1 } from "./engine";
import type { ForexExecutionAuthorization } from "../execution-guard";
import type { ForexProposalSnapshot } from "../proposal";

const proposal: ForexProposalSnapshot = {
  id: "proposal-1",
  askPrice: 0.5,
  payout: 0.9,
  requested: {
    symbol: "frxEURUSD",
    direction: "CALL",
    stake: 0.5,
    durationMinutes: 15,
    currency: "USD",
  },
  receivedAt: 1000,
};

const auth: ForexExecutionAuthorization = {
  authorized: true,
  code: "EXECUTION_AUTHORIZED",
  reason: "ok",
  checkedAt: 1000,
  decisionId: "decision-1",
  proposalId: "proposal-1",
};

describe("D17 Forex Trade Executor", () => {
  it("executa apenas após autorização D16 e devolve contract_id", async () => {
    const buyProposal = vi.fn().mockResolvedValue({ contractId: "contract-1", transactionId: "tx-1", buyPrice: 0.5 });
    const executor = new ForexTradeExecutorV1({ buyProposal });

    const result = await executor.execute({ authorization: auth, proposal, now: 1001 });

    expect(result.executed).toBe(true);
    expect(result.code).toBe("TRADE_EXECUTED");
    expect(result.contractId).toBe("contract-1");
    expect(buyProposal).toHaveBeenCalledWith("proposal-1", 0.5);
  });

  it("não compra sem EXECUTION_AUTHORIZED", async () => {
    const buyProposal = vi.fn();
    const executor = new ForexTradeExecutorV1({ buyProposal });
    const denied = { ...auth, authorized: false, code: "RISK_BLOCK" as const };

    const result = await executor.execute({ authorization: denied, proposal, now: 1001 });

    expect(result.executed).toBe(false);
    expect(result.code).toBe("EXECUTION_NOT_AUTHORIZED");
    expect(buyProposal).not.toHaveBeenCalled();
  });

  it("não compra Proposal diferente da autorização", async () => {
    const buyProposal = vi.fn();
    const executor = new ForexTradeExecutorV1({ buyProposal });
    const otherProposal = { ...proposal, id: "proposal-2" };

    const result = await executor.execute({ authorization: auth, proposal: otherProposal, now: 1001 });

    expect(result.executed).toBe(false);
    expect(result.code).toBe("INVALID_PROPOSAL");
    expect(buyProposal).not.toHaveBeenCalled();
  });

  it("impede duas compras concorrentes", async () => {
    let resolveBuy!: (value: any) => void;
    const buyProposal = vi.fn(() => new Promise((resolve) => { resolveBuy = resolve; }));
    const executor = new ForexTradeExecutorV1({ buyProposal });

    const first = executor.execute({ authorization: auth, proposal, now: 1001 });
    const second = await executor.execute({ authorization: auth, proposal, now: 1002 });

    expect(second.code).toBe("DUPLICATE_EXECUTION");
    expect(buyProposal).toHaveBeenCalledTimes(1);

    resolveBuy({ contractId: "contract-1" });
    const firstResult = await first;
    expect(firstResult.executed).toBe(true);
  });

  it("não considera buy confirmado sem contract_id", async () => {
    const buyProposal = vi.fn().mockResolvedValue({ raw: { msg_type: "buy", buy: {} } });
    const executor = new ForexTradeExecutorV1({ buyProposal });

    const result = await executor.execute({ authorization: auth, proposal, now: 1001 });

    expect(result.executed).toBe(false);
    expect(result.code).toBe("BUY_RESPONSE_INVALID");
  });

  it("converte erro da Deriv em BUY_REJECTED sem lançar para o caller", async () => {
    const buyProposal = vi.fn().mockRejectedValue(new Error("Insufficient balance"));
    const executor = new ForexTradeExecutorV1({ buyProposal });

    const result = await executor.execute({ authorization: auth, proposal, now: 1001 });

    expect(result.executed).toBe(false);
    expect(result.code).toBe("BUY_REJECTED");
    expect(result.reason).toContain("Insufficient balance");
  });
});
