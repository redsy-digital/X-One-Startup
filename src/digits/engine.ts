import { derivService } from "../lib/deriv";
import { saveTrade } from "../lib/storage";
import { logger } from "../lib/logger";
import { useBotStore } from "../store/useBotStore";
import { useSessionStore } from "../store/useSessionStore";
import { useDigitsStore } from "./store";
import { createDigitsRiskState, resetDigitsRisk, resolveDigitsLoss, resolveDigitsWin, type DigitsRiskState } from "./risk";
import { digitsContractLabel, digitsContractNeedsDigit, type DigitsConfig, type DigitsRiskConfig, type DigitsTradeResult, type DigitsContractType } from "./types";

const DIGITS_DURATION = 1;
const MIN_STAKE = 0.35;

export function randomDigitsTarget(): number {
  return Math.floor(Math.random() * 10);
}

export interface DigitsEngineConfig extends DigitsConfig, DigitsRiskConfig {
  symbol: string;
  isAuthorized: boolean;
  isBotRunning: boolean;
  balance: number | null;
  onForceStop: (reason: string) => void;
}

export class DigitsEngineV1 {
  private config: DigitsEngineConfig;
  private risk: DigitsRiskState;
  private activeContractId: string | null = null;
  private activeSubscriptionId: string | null = null;
  private activeTargetDigit: number | null = null;
  private activeContractType: DigitsContractType | null = null;
  private activeUsedAdvancedMartingale = false;
  /** Last settled exit digit used as the next target in Follow Up mode. */
  private followUpTargetDigit: number | null = null;
  private processing = false;
  private sessionInitialBalance: number | null = null;
  private lastProcessedContractId: string | null = null;
  private destroyed = false;
  private entryInFlight = false;
  private readonly unsubs: Array<() => void> = [];
  private limitTriggered = false;

  constructor(config: DigitsEngineConfig) {
    this.config = config;
    this.risk = createDigitsRiskState(config);
    this.bindEvents();
  }

  updateConfig(config: DigitsEngineConfig) {
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
      this.followUpTargetDigit = null;
      this.limitTriggered = false;
      this.risk = resetDigitsRisk(this.config);
      useDigitsStore.getState().resetRuntime(this.risk.currentStake);
      useSessionStore.getState().resetSession();
      logger.system(`Digits V1 iniciado | ${this.contractLabel()} | stake $${this.risk.currentStake.toFixed(2)}`);
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
      this.setRuntime({ isProcessing: false, activeContractId: null });
    }
    if (hadWork) logger.system("Digits V1: novas entradas bloqueadas.");
  }

  destroy() {
    this.destroyed = true;
    this.unsubs.forEach((unsubscribe) => unsubscribe());
    this.unsubs.length = 0;
    this.forgetActiveSubscription();
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
        logger.risk(`Digits cooldown pós-perdas: ${Math.ceil(remaining / 1000)}s restantes`);
        return;
      }
      this.risk = { ...this.risk, cooldownUntil: null, consecutiveLosses: 0, martingaleStep: 0, currentStake: this.config.stake };
      this.syncRiskRuntime();
      useBotStore.getState().setLossCooldown(null);
    }

    const stake = this.risk.currentStake;
    if (!Number.isFinite(stake) || stake < MIN_STAKE) {
      this.fail(`Stake inválida para Digits: mínimo operacional $${MIN_STAKE.toFixed(2)}.`);
      return;
    }

    if (this.config.balance !== null && stake > this.config.balance) {
      this.fail(`Stake $${stake.toFixed(2)} superior ao saldo disponível $${this.config.balance.toFixed(2)}.`);
      this.forceStop("Saldo insuficiente para a próxima stake");
      return;
    }

    const advancedActive =
      this.config.useMartingale &&
      this.config.useAdvancedMartingale &&
      !this.risk.advancedMartingaleExhausted &&
      this.risk.advancedMartingaleStep > 0 &&
      this.risk.advancedMartingaleStep <= this.config.maxAdvancedMartingaleSteps;

    const contract = advancedActive
      ? this.config.advancedMartingaleContract
      : this.config.contract;
    const targetDigit = advancedActive
      ? this.config.advancedMartingaleTargetDigit
      : this.resolveTargetDigit();

    if (digitsContractNeedsDigit(contract) && (!Number.isInteger(targetDigit) || targetDigit < 0 || targetDigit > 9)) {
      this.fail("Dígito alvo inválido. O alvo deve estar entre 0 e 9.");
      return;
    }

    this.entryInFlight = true;
    this.setRuntime({
      isProcessing: true,
      error: null,
      currentContract: contract,
      currentTargetDigit: digitsContractNeedsDigit(contract) ? targetDigit : null,
      currentStakeInTrade: stake,
      nextContract: contract,
      nextTargetDigit: digitsContractNeedsDigit(contract) ? targetDigit : null,
      nextStake: stake,
    });
    const entryLabel = digitsContractLabel(contract, targetDigit);
    logger.trade(`▶ Digits ${entryLabel} | $${stake.toFixed(2)} | ${this.config.symbol}`);

    try {
      const proposal = await derivService.getDigitsProposal(
        this.config.symbol,
        contract,
        stake,
        DIGITS_DURATION,
        targetDigit,
      );

      if (!this.config.isBotRunning || this.destroyed) {
        this.entryInFlight = false;
        this.setRuntime({ isProcessing: false });
        return;
      }

      const proposalId = String(proposal?.id ?? "");
      const askPrice = Number(proposal?.ask_price);
      if (!proposalId || !Number.isFinite(askPrice) || askPrice <= 0) {
        throw new Error("Proposal Digits inválida: ID ou ask_price ausente.");
      }

      const buy = await derivService.buyProposal(proposalId, askPrice);
      this.entryInFlight = false;
      this.activeContractId = buy.contractId;
      this.activeContractType = contract;
      this.activeTargetDigit = digitsContractNeedsDigit(contract) ? targetDigit : null;
      this.activeUsedAdvancedMartingale = advancedActive;
      this.processing = true;
      this.setRuntime({
        isProcessing: true,
        activeContractId: buy.contractId,
        currentContract: contract,
        currentTargetDigit: digitsContractNeedsDigit(contract) ? targetDigit : null,
        currentStakeInTrade: buy.buyPrice ?? askPrice,
        nextContract: contract,
        nextTargetDigit: digitsContractNeedsDigit(contract) ? targetDigit : null,
        nextStake: buy.buyPrice ?? askPrice,
        entries: useDigitsStore.getState().runtime.entries + 1,
      });
      logger.trade(`✓ Digits BUY confirmado | ${entryLabel} | ID ${buy.contractId} | $${(buy.buyPrice ?? askPrice).toFixed(2)}`);

      derivService.send({ proposal_open_contract: 1, contract_id: buy.contractId, subscribe: 1 });

      saveTrade({
        market: "synthetic",
        id: buy.contractId,
        time: (buy.purchaseTime ?? Math.floor(Date.now() / 1000)) * 1000,
        symbol: this.config.symbol,
        type: contract,
        targetDigit: this.activeTargetDigit ?? undefined,
        stake: buy.buyPrice ?? askPrice,
        status: "PENDING",
      });
    } catch (error: any) {
      this.entryInFlight = false;
      this.processing = false;
      this.setRuntime({ isProcessing: false, activeContractId: null, error: error?.message || "Falha ao executar Digits." });
      logger.error(`Digits V1: ${error?.message || error}`);
    }
  }

  private handleContractUpdate(data: any) {
    const contract = data?.proposal_open_contract;
    if (!contract || !contract.is_sold) return;
    const contractId = String(contract.contract_id ?? "");
    if (!contractId || contractId !== this.activeContractId || contractId === this.lastProcessedContractId) return;

    this.lastProcessedContractId = contractId;
    this.processing = false;
    this.activeContractId = null;
    this.forgetActiveSubscription(data);

    const resolvedTargetDigit = this.activeTargetDigit;
    // New API uses exit_spot. Keep exit_tick as a compatibility fallback for
    // older payloads so Follow Up remains resilient during migration.
    const settledContractType = this.activeContractType ?? this.config.contract;
    const exitDigit = digitsContractNeedsDigit(settledContractType)
      ? this.extractLastDigit(contract.exit_spot ?? contract.exit_tick)
      : null;
    const isWin = String(contract.status).toLowerCase() === "won";
    const result: DigitsTradeResult = isWin ? "WON" : "LOST";
    const profit = Number(contract.profit ?? 0);
    const stake = Number(contract.buy_price ?? this.risk.currentStake);

    this.setRuntime({
      isProcessing: false,
      activeContractId: null,
      lastResult: result,
      lastProfit: Number.isFinite(profit) ? profit : 0,
      lastTradeAt: Date.now(),
      lastContract: this.activeContractType,
      lastTargetDigit: resolvedTargetDigit,
      lastExitDigit: exitDigit,
      lastStake: Number.isFinite(stake) ? stake : this.risk.currentStake,
      currentContract: null,
      currentTargetDigit: null,
      currentStakeInTrade: null,
      error: null,
    });

    saveTrade({
      market: "synthetic",
      id: contractId,
      time: Number(contract.date_start) > 0 ? Number(contract.date_start) * 1000 : Date.now(),
      symbol: String(contract.underlying_symbol ?? contract.symbol ?? this.config.symbol),
      type: settledContractType,
      targetDigit: resolvedTargetDigit ?? undefined,
      stake: Number.isFinite(stake) ? stake : this.risk.currentStake,
      status: result,
      profit: Number.isFinite(profit) ? profit : 0,
      entryPrice: this.toNumber(contract.entry_tick),
      exitPrice: this.toNumber(contract.exit_spot ?? contract.exit_tick),
    });

    if (!this.activeUsedAdvancedMartingale && this.config.targetDigit === "follow_up" && digitsContractNeedsDigit(this.config.contract)) {
      if (exitDigit !== null) {
        this.followUpTargetDigit = exitDigit;
        logger.trade(`↪ Follow Up | próximo alvo: ${exitDigit}`);
      } else {
        logger.error("Digits V1: não foi possível extrair o último dígito do resultado; Follow Up não pode continuar com segurança.");
        this.forceStop("Follow Up sem dígito de resultado válido");
      }
    }

    if (isWin) {
      logger.trade(`✓ WIN | ${digitsContractLabel(this.config.contract, resolvedTargetDigit ?? this.config.targetDigit)} | ${this.formatMoney(profit)} | ID ${contractId}`);
      useSessionStore.getState().recordWin(profit);
      this.risk = resolveDigitsWin(this.risk, this.config, profit);
    } else {
      logger.trade(`✗ LOSS | ${digitsContractLabel(this.config.contract, resolvedTargetDigit ?? this.config.targetDigit)} | ${this.formatMoney(profit)} | ID ${contractId}`);
      useSessionStore.getState().recordLoss(profit);
      this.risk = resolveDigitsLoss(this.risk, this.config, Date.now(), this.activeUsedAdvancedMartingale);
    }

    this.activeTargetDigit = null;
    this.activeContractType = null;
    this.activeUsedAdvancedMartingale = false;

    const nextAdvancedActive =
      this.config.useMartingale &&
      this.config.useAdvancedMartingale &&
      !this.risk.advancedMartingaleExhausted &&
      this.risk.advancedMartingaleStep > 0 &&
      this.risk.advancedMartingaleStep <= this.config.maxAdvancedMartingaleSteps;
    const nextContract = nextAdvancedActive ? this.config.advancedMartingaleContract : this.config.contract;
    const nextTarget = digitsContractNeedsDigit(nextContract)
      ? (nextAdvancedActive
        ? this.config.advancedMartingaleTargetDigit
        : this.previewNextTargetDigit())
      : null;
    this.syncRiskRuntime();
    this.setRuntime({
      nextContract,
      nextTargetDigit: nextTarget,
      nextStake: this.risk.currentStake,
    });

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
    const runtime = useDigitsStore.getState().runtime;
    this.setRuntime({
      currentStake: this.risk.currentStake,
      martingaleStep: this.risk.martingaleStep,
    advancedMartingaleStep: this.risk.advancedMartingaleStep,
      consecutiveLosses: this.risk.consecutiveLosses,
      isProcessing: this.processing || this.entryInFlight,
      activeContractId: this.activeContractId,
      entries: runtime.entries,
    });
  }

  private setRuntime(patch: Partial<ReturnType<typeof useDigitsStore.getState>["runtime"]>) {
    useDigitsStore.getState().setRuntime(patch);
  }

  private forgetActiveSubscription(data?: any) {
    const subscriptionId = this.activeSubscriptionId ?? data?.subscription?.id;
    if (subscriptionId) {
      derivService.send({ forget: String(subscriptionId) });
    }
    this.activeSubscriptionId = null;
  }

  private randomDigit(): number {
    return randomDigitsTarget();
  }

  private previewNextTargetDigit(): number | null {
    if (!digitsContractNeedsDigit(this.config.contract)) return null;
    if (typeof this.config.targetDigit === "number") return this.config.targetDigit;
    if (this.config.targetDigit === "follow_up") return this.followUpTargetDigit;
    // Random is intentionally not generated until the next entry is actually submitted.
    return null;
  }

  private resolveTargetDigit(): number {
    if (!digitsContractNeedsDigit(this.config.contract)) return 0;

    if (typeof this.config.targetDigit === "number") return this.config.targetDigit;

    if (this.config.targetDigit === "random") return this.randomDigit();

    // Defensive normalization: UI Select values are strings. A numeric
    // string must remain a fixed target and must NEVER fall through to the
    // Random/Follow Up branches.
    const numericTarget = Number(this.config.targetDigit);
    if (Number.isInteger(numericTarget) && numericTarget >= 0 && numericTarget <= 9) {
      return numericTarget;
    }

    // Follow Up needs a seed for the first trade because no previous
    // settled contract exists yet. We use one random digit, then every
    // subsequent trade follows the previous contract's exit digit.
    return this.followUpTargetDigit ?? this.randomDigit();
  }

  private extractLastDigit(value: unknown): number | null {
    const text = String(value ?? "").trim();
    for (let i = text.length - 1; i >= 0; i--) {
      const char = text[i];
      if (char >= "0" && char <= "9") return Number(char);
    }
    return null;
  }

  private contractLabel() {
    return digitsContractLabel(this.config.contract, this.config.targetDigit);
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
    logger.error(`Digits V1: ${message}`);
  }
}
