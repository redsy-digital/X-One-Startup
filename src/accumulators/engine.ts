import { derivService } from "../lib/deriv";
import { saveTrade } from "../lib/storage";
import { logger } from "../lib/logger";
import { useBotStore } from "../store/useBotStore";
import { useSessionStore } from "../store/useSessionStore";
import { useAccumulatorsStore } from "./store";
import {
  createAccumulatorsRiskState, resetAccumulatorsRisk, resolveAccumulatorsLoss, resolveAccumulatorsWin,
  type AccumulatorsRiskState,
} from "./risk";
import { growthRateLabel, type AccumulatorsConfig, type AccumulatorsRiskConfig, type AccumulatorsTradeResult } from "./types";

const MIN_STAKE = 0.35;

export interface AccumulatorsEngineConfig extends AccumulatorsConfig, AccumulatorsRiskConfig {
  symbol: string;
  isAuthorized: boolean;
  isBotRunning: boolean;
  balance: number | null;
  onForceStop: (reason: string) => void;
}

export class AccumulatorsEngineV1 {
  private config: AccumulatorsEngineConfig;
  private risk: AccumulatorsRiskState;
  private activeContractId: string | null = null;
  private activeSubscriptionId: string | null = null;
  private activeIsManual = false;
  private sellRequested = false;
  private processing = false;
  private sessionInitialBalance: number | null = null;
  private lastProcessedContractId: string | null = null;
  private destroyed = false;
  private entryInFlight = false;
  private readonly unsubs: Array<() => void> = [];
  private limitTriggered = false;

  constructor(config: AccumulatorsEngineConfig) {
    this.config = config;
    this.risk = createAccumulatorsRiskState(config);
    this.bindEvents();
  }

  updateConfig(config: AccumulatorsEngineConfig) {
    this.config = config;
    this.checkSessionLimits();
  }

  start() {
    if (this.destroyed || !this.config.isAuthorized || !this.config.isBotRunning) return;
    if (this.config.balance === null) {
      this.fail("Saldo Deriv ainda não disponível. Aguardar autorização completa.");
      return;
    }
    if (this.sessionInitialBalance === null) {
      this.sessionInitialBalance = this.config.balance;
      this.limitTriggered = false;
      this.risk = resetAccumulatorsRisk(this.config);
      useAccumulatorsStore.getState().resetRuntime(this.risk.currentStake);
      useSessionStore.getState().resetSession();
      logger.system(`Accumulators V1 iniciado | Growth ${growthRateLabel(this.config.growthRate)} | ${this.config.tickCount} ticks | stake $${this.risk.currentStake.toFixed(2)}`);
    }
    void this.enterNextTrade();
  }

  stop() {
    if (this.destroyed) return;
    const hadWork = this.sessionInitialBalance !== null || this.processing || this.entryInFlight;
    this.config = { ...this.config, isBotRunning: false };
    this.entryInFlight = false;
    useBotStore.getState().setLossCooldown(null);
    if (!this.processing) {
      this.sessionInitialBalance = null;
      this.limitTriggered = false;
      this.setRuntime({ isProcessing: false });
    }
    if (hadWork) logger.system("Accumulators V1: novas entradas bloqueadas.");
  }

  destroy() {
    this.destroyed = true;
    this.unsubs.forEach((unsubscribe) => unsubscribe());
    this.unsubs.length = 0;
    this.forgetActiveSubscription();
  }

  /** Compra manual — fora do loop automático, sem martingale/risco associados. */
  async manualBuy() {
    if (this.destroyed || !this.config.isAuthorized) return;
    if (this.activeContractId) {
      this.fail("Já existe um contrato Accumulators em aberto.");
      return;
    }
    await this.enterTrade(this.config.stake, true);
  }

  /** Fecha o contrato ativo antes do bot/expiração — usado tanto pelo botão manual como pelo fecho por contagem de ticks. */
  async closeActiveContract(reason = "Fecho manual") {
    if (!this.activeContractId || this.sellRequested) return;
    this.sellRequested = true;
    try {
      logger.trade(`◼ Accumulators: a fechar contrato ${this.activeContractId} (${reason})`);
      await derivService.sellContract(this.activeContractId, 0);
    } catch (error: any) {
      this.sellRequested = false;
      logger.error(`Accumulators V1: falha ao fechar contrato — ${error?.message || error}`);
    }
  }

  private bindEvents() {
    this.unsubs.push(derivService.on("proposal_open_contract", (data) => this.handleContractUpdate(data)));
  }

  private async enterNextTrade() {
    if (this.destroyed || this.processing || this.entryInFlight) return;
    if (!this.config.isBotRunning || !this.config.isAuthorized) return;
    if (!this.config.symbol) return;

    if (this.risk.cooldownUntil !== null) {
      const remaining = this.risk.cooldownUntil - Date.now();
      if (remaining > 0) {
        logger.risk(`Accumulators cooldown pós-perdas: ${Math.ceil(remaining / 1000)}s restantes`);
        return;
      }
      this.risk = { ...this.risk, cooldownUntil: null, consecutiveLosses: 0, martingaleStep: 0, currentStake: this.config.stake };
      this.syncRiskRuntime();
      useBotStore.getState().setLossCooldown(null);
    }

    await this.enterTrade(this.risk.currentStake, false);
  }

  private async enterTrade(stake: number, isManual: boolean) {
    if (!Number.isFinite(stake) || stake < MIN_STAKE) {
      this.fail(`Stake inválida para Accumulators: mínimo operacional $${MIN_STAKE.toFixed(2)}.`);
      return;
    }
    if (this.config.balance !== null && stake > this.config.balance) {
      this.fail(`Stake $${stake.toFixed(2)} superior ao saldo disponível $${this.config.balance.toFixed(2)}.`);
      if (!isManual) this.forceStop("Saldo insuficiente para a próxima stake");
      return;
    }

    this.entryInFlight = true;
    this.setRuntime({
      isProcessing: true,
      error: null,
      currentStakeInTrade: stake,
      isManualTrade: isManual,
      ticksElapsed: 0,
      currentContractValue: null,
    });
    logger.trade(`▶ Accumulators ${growthRateLabel(this.config.growthRate)} | $${stake.toFixed(2)} | ${this.config.symbol}${isManual ? " | manual" : ""}`);

    try {
      const proposal = await derivService.getAccumulatorsProposal(
        this.config.symbol,
        stake,
        this.config.growthRate,
      );

      if (this.destroyed || (!isManual && !this.config.isBotRunning)) {
        this.entryInFlight = false;
        this.setRuntime({ isProcessing: false });
        return;
      }

      const proposalId = String(proposal?.id ?? "");
      const askPrice = Number(proposal?.ask_price);
      if (!proposalId || !Number.isFinite(askPrice) || askPrice <= 0) {
        throw new Error("Proposal Accumulators inválida: ID ou ask_price ausente.");
      }

      const buy = await derivService.buyProposal(proposalId, askPrice);
      this.entryInFlight = false;
      this.activeContractId = buy.contractId;
      this.activeIsManual = isManual;
      this.sellRequested = false;
      this.processing = true;
      this.setRuntime({
        isProcessing: true,
        activeContractId: buy.contractId,
        currentStakeInTrade: buy.buyPrice ?? askPrice,
        ticksElapsed: 0,
        currentContractValue: buy.buyPrice ?? askPrice,
        isManualTrade: isManual,
        entries: useAccumulatorsStore.getState().runtime.entries + 1,
      });
      logger.trade(`✓ Accumulators BUY confirmado | ID ${buy.contractId} | $${(buy.buyPrice ?? askPrice).toFixed(2)}`);

      derivService.send({ proposal_open_contract: 1, contract_id: buy.contractId, subscribe: 1 });

      saveTrade({
        market: "synthetic",
        id: buy.contractId,
        time: (buy.purchaseTime ?? Math.floor(Date.now() / 1000)) * 1000,
        symbol: this.config.symbol,
        type: "ACCU",
        stake: buy.buyPrice ?? askPrice,
        status: "PENDING",
      });
    } catch (error: any) {
      this.entryInFlight = false;
      this.processing = false;
      this.setRuntime({ isProcessing: false, activeContractId: null, error: error?.message || "Falha ao executar Accumulators." });
      logger.error(`Accumulators V1: ${error?.message || error}`);
    }
  }

  private handleContractUpdate(data: any) {
    const contract = data?.proposal_open_contract;
    if (!contract) return;
    const contractId = String(contract.contract_id ?? "");
    if (!contractId || contractId !== this.activeContractId) return;

    if (!contract.is_sold) {
      // Cada actualização de um contrato ACCU em aberto chega por tick.
      const ticksElapsed = useAccumulatorsStore.getState().runtime.ticksElapsed + 1;
      const bidPrice = this.toNumber(contract.bid_price);
      this.setRuntime({
        ticksElapsed,
        currentContractValue: bidPrice ?? useAccumulatorsStore.getState().runtime.currentContractValue,
      });
      if (this.config.tickCount > 0 && ticksElapsed >= this.config.tickCount && !this.sellRequested) {
        void this.closeActiveContract(`limite de ${this.config.tickCount} ticks atingido`);
      }
      return;
    }

    if (contractId === this.lastProcessedContractId) return;
    this.lastProcessedContractId = contractId;
    this.processing = false;
    this.activeContractId = null;
    this.sellRequested = false;
    this.forgetActiveSubscription(data);

    const isManual = this.activeIsManual;
    const profit = Number(contract.profit ?? 0);
    const stake = Number(contract.buy_price ?? this.risk.currentStake);
    const isWin = Number.isFinite(profit) ? profit >= 0 : String(contract.status).toLowerCase() === "won";
    const result: AccumulatorsTradeResult = isWin ? "WON" : "LOST";
    const ticksElapsed = useAccumulatorsStore.getState().runtime.ticksElapsed;

    this.setRuntime({
      isProcessing: false,
      activeContractId: null,
      lastResult: result,
      lastProfit: Number.isFinite(profit) ? profit : 0,
      lastTradeAt: Date.now(),
      lastStake: Number.isFinite(stake) ? stake : this.risk.currentStake,
      lastTicks: ticksElapsed,
      currentStakeInTrade: null,
      currentContractValue: null,
      error: null,
    });

    saveTrade({
      market: "synthetic",
      id: contractId,
      time: Number(contract.date_start) > 0 ? Number(contract.date_start) * 1000 : Date.now(),
      symbol: String(contract.underlying_symbol ?? contract.symbol ?? this.config.symbol),
      type: "ACCU",
      stake: Number.isFinite(stake) ? stake : this.risk.currentStake,
      status: result,
      profit: Number.isFinite(profit) ? profit : 0,
      entryPrice: this.toNumber(contract.entry_tick),
      exitPrice: this.toNumber(contract.exit_spot ?? contract.exit_tick ?? contract.sell_spot),
    });

    this.activeIsManual = false;

    // Trades manuais ficam fora da máquina de risco/martingale — não contam
    // para stake seguinte, cooldown ou paragem forçada por perdas seguidas.
    if (isManual) {
      logger.trade(`${isWin ? "✓ WIN" : "✗ LOSS"} (manual) | ${this.formatMoney(profit)} | ID ${contractId}`);
      useSessionStore.getState()[isWin ? "recordWin" : "recordLoss"](profit);
      return;
    }

    if (isWin) {
      logger.trade(`✓ WIN | ${growthRateLabel(this.config.growthRate)} | ${this.formatMoney(profit)} | ID ${contractId}`);
      useSessionStore.getState().recordWin(profit);
      this.risk = resolveAccumulatorsWin(this.risk, this.config);
    } else {
      logger.trade(`✗ LOSS | ${growthRateLabel(this.config.growthRate)} | ${this.formatMoney(profit)} | ID ${contractId}`);
      useSessionStore.getState().recordLoss(profit);
      this.risk = resolveAccumulatorsLoss(this.risk, this.config, Date.now());
    }

    this.syncRiskRuntime();

    if (isWin) {
      useBotStore.getState().setLossCooldown(null);
    } else if (this.risk.consecutiveLosses >= this.config.maxConsecutiveLosses && this.config.cooldownAfterLoss <= 0) {
      const reason = `${this.config.maxConsecutiveLosses} perdas consecutivas — limite de risco atingido`;
      logger.risk(`⛔ ${reason}`);
      this.forceStop(reason);
    } else if (this.risk.cooldownUntil !== null) {
      const reason = `${this.config.maxConsecutiveLosses} perdas consecutivas — cooldown de ${this.config.cooldownAfterLoss}s`;
      useBotStore.getState().setLossCooldown({ reason, until: this.risk.cooldownUntil });
      logger.risk(`⚠ ${reason}`);
    }

    if (this.config.isBotRunning) {
      const delay = isWin ? 0 : (this.risk.cooldownUntil ? this.config.cooldownAfterLoss * 1000 : 0);
      if (delay > 0) {
        window.setTimeout(() => {
          if (!this.destroyed && this.config.isBotRunning) void this.enterNextTrade();
        }, delay);
      } else {
        void this.enterNextTrade();
      }
    } else {
      this.sessionInitialBalance = null;
    }
  }

  private checkSessionLimits() {
    if (!this.config.isBotRunning || this.sessionInitialBalance === null || this.config.balance === null) return;
    const sessionPnl = this.config.balance - this.sessionInitialBalance;

    if (this.limitTriggered) return;

    if (this.config.targetProfit > 0 && sessionPnl >= this.config.targetProfit) {
      this.limitTriggered = true;
      const message = `Take Profit atingido: ${this.formatMoney(sessionPnl)}`;
      logger.risk(`🎯 ${message}`);
      useSessionStore.getState().setModal({ show: true, type: "profit", amount: sessionPnl });
      this.forceStop(message);
    } else if (this.config.stopLoss > 0 && sessionPnl <= -this.config.stopLoss) {
      this.limitTriggered = true;
      const message = `Stop Loss atingido: ${this.formatMoney(sessionPnl)}`;
      logger.risk(`⛔ ${message}`);
      useSessionStore.getState().setModal({ show: true, type: "loss", amount: sessionPnl });
      this.forceStop(message);
    }
  }

  private forceStop(reason: string) {
    this.config = { ...this.config, isBotRunning: false };
    this.config.onForceStop(reason);
  }

  private syncRiskRuntime() {
    const runtime = useAccumulatorsStore.getState().runtime;
    this.setRuntime({
      currentStake: this.risk.currentStake,
      martingaleStep: this.risk.martingaleStep,
      consecutiveLosses: this.risk.consecutiveLosses,
      isProcessing: this.processing || this.entryInFlight,
      activeContractId: this.activeContractId,
      entries: runtime.entries,
    });
  }

  private setRuntime(patch: Partial<ReturnType<typeof useAccumulatorsStore.getState>["runtime"]>) {
    useAccumulatorsStore.getState().setRuntime(patch);
  }

  private forgetActiveSubscription(data?: any) {
    const subscriptionId = this.activeSubscriptionId ?? data?.subscription?.id;
    if (subscriptionId) {
      derivService.send({ forget: String(subscriptionId) });
    }
    this.activeSubscriptionId = null;
  }

  private formatMoney(value: number) {
    const n = Number.isFinite(value) ? value : 0;
    return `${n >= 0 ? "+" : ""}$${n.toFixed(2)}`;
  }

  private toNumber(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  private fail(message: string) {
    this.setRuntime({ error: message, isProcessing: false });
    logger.error(`Accumulators V1: ${message}`);
  }
}
