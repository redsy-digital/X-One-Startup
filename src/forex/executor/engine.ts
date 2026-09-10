import type { ForexExecutionAuthorization } from "../execution-guard";
import type { ForexProposalSnapshot } from "../proposal";
import {
  FOREX_TRADE_EXECUTOR_VERSION,
  type ForexBuyGateway,
  type ForexTradeExecutionResult,
  type ForexTradeExecutorInput,
} from "./types";

/**
 * D17 — Forex Trade Executor.
 *
 * The executor is intentionally narrow: it cannot choose a direction, stake,
 * duration, or contract. It can only execute a proposal that has an explicit
 * D16 EXECUTION_AUTHORIZED decision.
 *
 * D17 has its own in-flight latch as a second defence against duplicate buys.
 * It is released after the gateway responds, whether success or failure.
 */
export class ForexTradeExecutorV1 {
  private inFlight = false;

  constructor(private readonly gateway: ForexBuyGateway) {}

  isInFlight(): boolean {
    return this.inFlight;
  }

  async execute(input: ForexTradeExecutorInput): Promise<ForexTradeExecutionResult> {
    const { authorization, proposal, now } = input;
    const base = {
      executedAt: now,
      decisionId: authorization.decisionId,
      proposalId: proposal?.id ?? authorization.proposalId,
    };

    if (!authorization.authorized || authorization.code !== "EXECUTION_AUTHORIZED") {
      return {
        executed: false,
        code: "EXECUTION_NOT_AUTHORIZED",
        reason: "D17 recusou a execução porque a autorização D16 não é EXECUTION_AUTHORIZED.",
        ...base,
      };
    }

    if (!proposal?.id || authorization.proposalId !== proposal.id ||
        !Number.isFinite(proposal.askPrice) || proposal.askPrice <= 0) {
      return {
        executed: false,
        code: "INVALID_PROPOSAL",
        reason: "Proposal/ask_price inválidos ou não correspondem à autorização D16.",
        ...base,
      };
    }

    // D16 authorizes a specific proposal, but D17 also verifies the exact price
    // that it is about to send. No repricing or stake changes are permitted here.
    if (authorization.proposalId !== proposal.id) {
      return {
        executed: false,
        code: "PRICE_MISMATCH",
        reason: "A Proposal não corresponde à autorização de execução.",
        ...base,
      };
    }

    if (this.inFlight) {
      return {
        executed: false,
        code: "DUPLICATE_EXECUTION",
        reason: "Já existe uma compra em andamento; D17 bloqueia uma segunda execução concorrente.",
        ...base,
      };
    }

    this.inFlight = true;
    try {
      const result = await this.gateway.buyProposal(proposal.id, proposal.askPrice);

      if (!result?.contractId) {
        return {
          executed: false,
          code: "BUY_RESPONSE_INVALID",
          reason: "A Deriv respondeu ao buy sem um contract_id válido; D17 não considera a compra confirmada.",
          ...base,
          raw: result?.raw,
        };
      }

      return {
        executed: true,
        code: "TRADE_EXECUTED",
        reason: "Compra confirmada pela Deriv com contract_id válido.",
        ...base,
        contractId: result.contractId,
        transactionId: result.transactionId,
        buyPrice: result.buyPrice,
        payout: result.payout,
        purchaseTime: result.purchaseTime,
        startTime: result.startTime,
        balanceAfter: result.balanceAfter,
        raw: result.raw,
      };
    } catch (error: any) {
      return {
        executed: false,
        code: "BUY_REJECTED",
        reason: error?.message || "A Deriv rejeitou a compra.",
        ...base,
      };
    } finally {
      this.inFlight = false;
    }
  }
}

export const forexTradeExecutorVersion = FOREX_TRADE_EXECUTOR_VERSION;
