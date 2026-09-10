import type { ForexBuyGateway } from "../executor";
import {
  FOREX_DEMO_TRADING_VERSION,
  type ForexContractMonitorGateway,
  type ForexContractSnapshot,
  type ForexDemoBuyInput,
  type ForexDemoExecutionResult,
} from "./types";

/**
 * D19 — Demo Trading orchestration.
 *
 * This layer is deliberately DEMO-only. It is not a generic live executor and
 * refuses to call the buy gateway unless the account has been explicitly
 * verified as demo + authorized.
 */
export class ForexDemoTradingV1 {
  private buyInFlight = false;
  private activeContractId: string | null = null;
  private unsubscribeContract: (() => void) | null = null;

  constructor(
    private readonly buyGateway: ForexBuyGateway,
    private readonly monitor: ForexContractMonitorGateway,
  ) {}

  isBuyInFlight(): boolean { return this.buyInFlight; }
  getActiveContractId(): string | null { return this.activeContractId; }

  async executeDemoBuy(input: ForexDemoBuyInput): Promise<ForexDemoExecutionResult> {
    const base = { accountId: input.account?.accountId ?? "" };

    if (!input.account?.authorized) {
      return { executed: false, code: "ACCOUNT_NOT_AUTHORIZED", reason: "A conta Deriv não está autorizada.", ...base };
    }

    if (!input.account.isDemo) {
      return { executed: false, code: "DEMO_ONLY_BLOCK", reason: "D19 é DEMO-ONLY e bloqueia qualquer conta que não esteja explicitamente identificada como Demo.", ...base };
    }

    if (!input.proposalId || !Number.isFinite(input.price) || input.price <= 0) {
      return { executed: false, code: "INVALID_BUY_INPUT", reason: "Proposal ID ou preço inválido para execução Demo.", ...base };
    }

    if (this.buyInFlight || this.activeContractId) {
      return { executed: false, code: "DUPLICATE_BUY", reason: "Já existe uma compra/posição Demo ativa; nova compra bloqueada.", ...base };
    }

    this.buyInFlight = true;
    try {
      const result = await this.buyGateway.buyProposal(input.proposalId, input.price);
      if (!result?.contractId) {
        return { executed: false, code: "BUY_RESPONSE_INVALID", reason: "A Deriv não devolveu contract_id; a compra não será considerada confirmada.", ...base, raw: result?.raw };
      }

      this.activeContractId = result.contractId;
      this.monitor.subscribeContract(result.contractId);

      return {
        executed: true,
        code: "DEMO_BUY_EXECUTED",
        reason: "Compra Demo confirmada pela Deriv; contract_id recebido.",
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
      return { executed: false, code: "BUY_REJECTED", reason: error?.message || "A Deriv rejeitou a compra Demo.", ...base };
    } finally {
      this.buyInFlight = false;
    }
  }

  watchActiveContract(onUpdate: (snapshot: ForexContractSnapshot) => void): () => void {
    if (!this.activeContractId) return () => undefined;
    this.unsubscribeContract?.();
    this.unsubscribeContract = this.monitor.onContractUpdate((snapshot) => {
      if (snapshot.contractId !== this.activeContractId) return;
      onUpdate(snapshot);
      if (snapshot.isSold) this.clearActiveContract();
    });
    return () => {
      this.unsubscribeContract?.();
      this.unsubscribeContract = null;
    };
  }

  clearActiveContract(): void {
    this.unsubscribeContract?.();
    this.unsubscribeContract = null;
    this.activeContractId = null;
  }

  recoverContract(contractId: string): void {
    if (!contractId) return;
    this.activeContractId = contractId;
    this.monitor.subscribeContract(contractId);
  }
}

export const forexDemoTradingVersion = FOREX_DEMO_TRADING_VERSION;
