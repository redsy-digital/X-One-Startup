import { derivService } from "../lib/deriv";
import { logger } from "../lib/logger";
import { saveTrade } from "../lib/storage";
import { useBotStore } from "../store/useBotStore";
import { useSessionStore } from "../store/useSessionStore";
import { useAccumulatorStore } from "./store";
import {
  createAccumulatorRisk,
  resolveAccumulatorLoss,
  resolveAccumulatorWin,
  type AccumulatorRiskState,
} from "./risk";
import type { AccumulatorCloseMode, AccumulatorConfig } from "./types";
import { DEFAULT_ACCUMULATOR_FILTERS, evaluateAccumulatorEntry } from "./filters";

const MIN_STAKE = 1;
const DEFAULT_GROWTH_RATE = 0.01;
const DEFAULT_CLOSE_MODE: AccumulatorCloseMode = "ticks";

export interface AccumulatorEngineConfig extends AccumulatorConfig {
  isAuthorized: boolean;
  isBotRunning: boolean;
  balance: number | null;
  onForceStop: (reason: string) => void;
}

export class AccumulatorEngineV1 {
  private config: AccumulatorEngineConfig;
  private risk: AccumulatorRiskState;
  private activeContractId: string | null = null;
  private activeSubscriptionId: string | null = null;
  private processing = false;
  private entryInFlight = false;
  private destroyed = false;
  private lastProcessedContractId: string | null = null;
  private lastSpotKey: string | null = null;
  private limitTriggered = false;
  private manualContract = false;
  private closeRequested = false;
  private activeCloseMode: AccumulatorCloseMode = DEFAULT_CLOSE_MODE;
  private activeProfitTarget: number | null = null;
  private closeReason: string | null = null;
  private profitMartingaleActive = false;
  private lastWasKnockout = false;
  private tickBuffer: number[] = [];
  private filterWaitTicks = 0;
  private filterHistoryLoading = false;
  private readonly unsubs: Array<() => void> = [];

  constructor(config: AccumulatorEngineConfig) {
    this.config = this.normalizeConfig(config);
    this.risk = createAccumulatorRisk(this.config);
    this.bindEvents();
  }

  updateConfig(config: AccumulatorEngineConfig) {
    const previousSymbol = this.config.symbol;
    this.config = this.normalizeConfig(config);
    if (previousSymbol !== this.config.symbol) {
      this.tickBuffer = [];
      this.filterWaitTicks = 0;
      this.setRuntime({ filterBlocked: false, filterReasons: [], filterWaitTicksRemaining: 0, filterSamples: 0 });
    }
    this.checkSessionLimits();
    if (this.config.isBotRunning && this.config.isAuthorized && !this.activeContractId && !this.entryInFlight) {
      void this.enter();
    }
  }

  start() {
    if (this.destroyed || !this.config.isAuthorized || !this.config.isBotRunning || this.activeContractId || this.entryInFlight) return;
    if (this.config.balance === null) return this.fail("Saldo Deriv ainda não disponível.");

    if (!this.activeContractId) {
      this.risk = createAccumulatorRisk(this.config);
      this.limitTriggered = false;
      this.manualContract = false;
      this.profitMartingaleActive = false;
      this.lastWasKnockout = false;
      useAccumulatorStore.getState().resetRuntime(this.risk.currentStake, this.config.durationTicks);
      this.setRuntime({ filterBlocked: false, filterReasons: [], filterWaitTicksRemaining: 0, filterSamples: this.tickBuffer.length });
      useSessionStore.getState().resetSession();
      void this.prepareFilterBuffer();
      logger.system(`Accumulators V1 iniciado | ${this.config.symbol} | ${this.closeModeLabel()} | stake $${this.risk.currentStake.toFixed(2)}`);
    }
    void this.enter();
  }

  stop() {
    this.config = { ...this.config, isBotRunning: false };
    useBotStore.getState().setLossCooldown(null);
    if (!this.processing && !this.entryInFlight) {
      this.setRuntime({ isProcessing: false, activeContractId: null });
    }
  }

  destroy() {
    this.destroyed = true;
    this.unsubs.forEach((u) => u());
    this.unsubs.length = 0;
    this.forgetSubscription();
  }

  async closeActiveContract() {
    if (!this.config.isAuthorized) return { ok: false, message: "Deriv não está autorizado." };
    let contractId = this.activeContractId;
    let external = false;

    if (!contractId) {
      try {
        const contracts = await derivService.getPortfolio();
        const found = contracts.find(
          (c: any) => String(c.contract_type).toUpperCase() === "ACCU" && String(c.underlying_symbol ?? c.symbol) === this.config.symbol,
        );
        if (!found?.contract_id) return { ok: false, message: "Nenhum contrato Accumulator aberto neste ativo." };
        contractId = String(found.contract_id);
        external = true;
        this.activeContractId = contractId;
        this.manualContract = true;
        this.processing = true;
        this.setRuntime({ activeContractId: contractId, isProcessing: true, isManualContract: true });
        derivService.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
      } catch (e: any) {
        return { ok: false, message: e?.message || "Não foi possível localizar o contrato Accumulator." };
      }
    }

    try {
      await derivService.sellContract(contractId);
      logger.trade(`■ ACCU fechado manualmente | ${contractId}${external ? " | operação manual detectada" : ""}`);
      return { ok: true };
    } catch (e: any) {
      const message = e?.message || "Falha ao fechar contrato Accumulator.";
      this.fail(message);
      return { ok: false, message };
    }
  }

  async openManualContract(options?: { stake?: number; growthRate?: number }) {
    if (this.destroyed || this.processing || this.entryInFlight || !this.config.isAuthorized || this.activeContractId) return;
    if (this.config.balance === null) return this.fail("Saldo Deriv ainda não disponível.");
    await this.enter(true, options);
  }

  private bindEvents() {
    this.unsubs.push(derivService.on("proposal_open_contract", (data) => this.handleContractUpdate(data)));
    this.unsubs.push(derivService.on("tick", (data) => this.handleTick(data)));
  }

  private async prepareFilterBuffer() {
    if (!this.filtersActive()) return;
    const symbol = this.config.symbol;
    this.filterHistoryLoading = true;
    try {
      const history = await derivService.getRawTicksHistory(symbol, 120);
      if (this.destroyed || symbol !== this.config.symbol) return;
      const live = this.tickBuffer.slice(-40);
      this.tickBuffer = [...history.prices, ...live].slice(-160);
      this.setRuntime({ filterSamples: this.tickBuffer.length });
    } catch (e: any) {
      logger.error(`ACCU filtros: histórico de ticks indisponível | ${e?.message || e}`);
    } finally {
      this.filterHistoryLoading = false;
    }
  }

  private handleTick(data: any) {
    const tick = data?.tick;
    if (!tick) return;
    const symbol = String(tick.symbol ?? "");
    const quote = Number(tick.quote);
    if (symbol !== this.config.symbol || !Number.isFinite(quote)) return;
    this.tickBuffer = [...this.tickBuffer, quote].slice(-160);
    if (!this.filtersActive()) return;

    const evaluation = evaluateAccumulatorEntry(this.tickBuffer, this.config.filters);
    this.setRuntime({
      filterBlocked: !evaluation.allowed,
      filterReasons: evaluation.reasons,
      filterSamples: evaluation.samples,
      filterWaitTicksRemaining: this.filterWaitTicks,
    });

    if (this.filterWaitTicks > 0) {
      this.filterWaitTicks -= 1;
      this.setRuntime({ filterWaitTicksRemaining: this.filterWaitTicks });
      if (this.filterWaitTicks === 0 && this.config.isBotRunning && !this.activeContractId && !this.entryInFlight && !this.filterHistoryLoading) {
        void this.enter();
      }
    }
  }

  private filtersActive() {
    return Object.values(this.config.filters ?? DEFAULT_ACCUMULATOR_FILTERS).some(Boolean);
  }

  private canEnterWithFilters() {
    if (!this.filtersActive()) {
      this.filterWaitTicks = 0;
      this.setRuntime({ filterBlocked: false, filterReasons: [], filterWaitTicksRemaining: 0, filterSamples: this.tickBuffer.length });
      return true;
    }
    if (this.filterHistoryLoading) {
      this.setRuntime({ filterBlocked: true, filterReasons: ["Aguardando histórico de ticks"], filterSamples: this.tickBuffer.length });
      return false;
    }
    const evaluation = evaluateAccumulatorEntry(this.tickBuffer, this.config.filters);
    this.setRuntime({ filterBlocked: !evaluation.allowed, filterReasons: evaluation.reasons, filterSamples: evaluation.samples });
    if (evaluation.allowed) {
      this.filterWaitTicks = 0;
      this.setRuntime({ filterWaitTicksRemaining: 0 });
      return true;
    }
    this.filterWaitTicks = 3;
    this.setRuntime({ filterBlocked: true, filterWaitTicksRemaining: 3 });
    logger.system(`ACCU entrada adiada pelos filtros | ${evaluation.reasons.join(" · ")} | aguardar 3 ticks`);
    return false;
  }

  private async enter(manual = false, overrides?: { stake?: number; growthRate?: number }) {
    if (this.destroyed || this.processing || this.entryInFlight || (!manual && !this.config.isBotRunning) || !this.config.isAuthorized || this.activeContractId) return;

    // Manual operations deliberately bypass predictive entry filters. The filters
    // are a guard only for the automatic reopen -> close -> reopen cycle.
    if (!manual && !this.canEnterWithFilters()) return;

    if (this.risk.cooldownUntil !== null) {
      const remaining = this.risk.cooldownUntil - Date.now();
      if (remaining > 0) return;
      this.risk = createAccumulatorRisk(this.config);
      this.syncRisk();
      useBotStore.getState().setLossCooldown(null);
    }

    const requestedStake = manual && overrides?.stake !== undefined ? Number(overrides.stake) : this.risk.currentStake;
    const stake = Number.isFinite(requestedStake) ? Math.max(MIN_STAKE, requestedStake) : requestedStake;
    if (!Number.isFinite(stake) || stake < MIN_STAKE) return this.fail(`Stake inválida para Accumulators: mínimo $${MIN_STAKE.toFixed(2)}.`);
    const growthRate = manual && overrides?.growthRate !== undefined ? Number(overrides.growthRate) : this.config.growthRate;
    if (!Number.isFinite(growthRate) || ![0.01, 0.02, 0.03, 0.04, 0.05].includes(growthRate)) return this.fail("Growth Rate ACCU inválido. Escolha entre 1% e 5%.");
    if (this.config.balance !== null && stake > this.config.balance) {
      this.fail(`Stake $${stake.toFixed(2)} superior ao saldo disponível $${this.config.balance.toFixed(2)}.`);
      this.forceStop("Saldo insuficiente para a próxima stake");
      return;
    }

    const closeMode = this.resolveActiveCloseMode();
    const profitTarget = this.resolveActiveProfitTarget(stake, closeMode);
    if (closeMode === "profit_percent" && (!Number.isFinite(profitTarget) || profitTarget <= 0)) {
      return this.fail("Percentagem de lucro inválida.");
    }
    if (closeMode === "contract_take_profit" && (!Number.isFinite(profitTarget) || profitTarget <= 0)) {
      return this.fail("Take Profit do contrato inválido.");
    }

    this.entryInFlight = true;
    this.manualContract = manual;
    this.closeRequested = false;
    this.closeReason = null;
    this.activeCloseMode = closeMode;
    this.activeProfitTarget = profitTarget;
    this.setRuntime({
      isProcessing: true,
      error: null,
      ticksElapsed: 0,
      ticksTarget: this.config.durationTicks,
      currentStake: stake,
      currentSpot: null,
      currentValue: null,
      currentProfit: null,
      currentProfitPercent: null,
      currentHighBarrier: null,
      currentLowBarrier: null,
      activeCloseMode: closeMode,
      activeProfitTarget: profitTarget,
      closeReason: null,
      profitMartingaleActive: this.profitMartingaleActive,
      isManualContract: manual,
    });

    try {
      // Do NOT send duration/date_expiry for ACCU: the contract itself is no-expiry.
      // The selected close rule belongs to X-One's execution layer.
      const proposal = await derivService.getAccumulatorProposal(this.config.symbol, stake, growthRate);
      const id = String(proposal?.id ?? "");
      const ask = Number(proposal?.ask_price);
      if (!id || !Number.isFinite(ask) || ask <= 0) throw new Error("Proposal ACCU inválida: ID ou ask_price ausente.");

      const buy = await derivService.buyProposal(id, ask);
      if ((!manual && !this.config.isBotRunning) || this.destroyed) {
        this.entryInFlight = false;
        this.setRuntime({ isProcessing: false });
        return;
      }

      this.entryInFlight = false;
      this.activeContractId = buy.contractId;
      this.processing = true;
      this.lastSpotKey = null;
      this.setRuntime({
        activeContractId: buy.contractId,
        isProcessing: true,
        ticksElapsed: 0,
        ticksTarget: this.config.durationTicks,
        entries: useAccumulatorStore.getState().runtime.entries + 1,
        currentStake: buy.buyPrice ?? stake,
      });

      logger.trade(`${manual ? "▶ ACCU MANUAL" : "▶ ACCU"} ${this.config.symbol} | $${stake.toFixed(2)} | ${this.closeModeLabel(closeMode, profitTarget)} | crescimento ${Math.round(growthRate * 100)}%`);
      derivService.send({ proposal_open_contract: 1, contract_id: buy.contractId, subscribe: 1 });

      saveTrade({
        market: "synthetic",
        id: buy.contractId,
        time: (buy.purchaseTime ?? Math.floor(Date.now() / 1000)) * 1000,
        symbol: this.config.symbol,
        type: "ACCU",
        stake: buy.buyPrice ?? stake,
        status: "PENDING",
      });
    } catch (e: any) {
      this.entryInFlight = false;
      this.processing = false;
      this.setRuntime({ isProcessing: false, activeContractId: null, error: e?.message || "Falha ao abrir Accumulator." });
      logger.error(`Accumulators V1: ${e?.message || e}`);
    }
  }

  private handleContractUpdate(data: any) {
    const c = data?.proposal_open_contract;
    if (!c?.contract_id) return;
    const id = String(c.contract_id);
    if (id !== this.activeContractId || id === this.lastProcessedContractId) return;

    const spot = this.toNumber(c.current_spot ?? c.exit_spot ?? c.entry_spot ?? c.entry_tick);
    const highBarrier = this.toNumber(c.current_spot_high_barrier ?? c.high_barrier);
    const lowBarrier = this.toNumber(c.current_spot_low_barrier ?? c.low_barrier);
    const profit = this.toNumber(c.profit);
    const profitPercent = this.toNumber(c.profit_percentage);
    const bidPrice = this.toNumber(c.bid_price);
    const tickPassed = this.toNumber(c.tick_passed);

    if (Number.isFinite(spot)) {
      const key = `${c.current_spot_time ?? ""}:${spot}`;
      if (key !== this.lastSpotKey) {
        this.lastSpotKey = key;
        const elapsed = Number.isFinite(tickPassed) ? Math.max(0, Math.floor(tickPassed)) : this.runtimeTicks() + 1;
        const previousPoints = useAccumulatorStore.getState().runtime.chartPoints;
        const point: import("./types").AccumulatorChartPoint = {
          time: Number(c.current_spot_time ?? Math.floor(Date.now() / 1000)),
          price: spot,
          high: Number.isFinite(highBarrier) ? highBarrier : null,
          low: Number.isFinite(lowBarrier) ? lowBarrier : null,
        };
        const nextPoints = [...previousPoints.filter(p => p.time !== point.time), point].slice(-300);
        this.setRuntime({
          ticksElapsed: Math.min(elapsed, this.config.durationTicks),
          currentSpot: spot,
          currentHighBarrier: Number.isFinite(highBarrier) ? highBarrier : null,
          currentLowBarrier: Number.isFinite(lowBarrier) ? lowBarrier : null,
          currentValue: Number.isFinite(bidPrice) ? bidPrice : null,
          currentProfit: Number.isFinite(profit) ? profit : null,
          currentProfitPercent: Number.isFinite(profitPercent) ? profitPercent : this.calculateProfitPercent(c),
          chartPoints: nextPoints,
        });

        if (!c.is_sold && !this.closeRequested && this.shouldClose(elapsed, profit, profitPercent, c)) {
          void this.requestAutomaticClose(id, this.getCloseReason(elapsed, profit, profitPercent, c));
        }
      }
    } else {
      this.setRuntime({
        currentProfit: Number.isFinite(profit) ? profit : null,
        currentProfitPercent: Number.isFinite(profitPercent) ? profitPercent : this.calculateProfitPercent(c),
        currentHighBarrier: Number.isFinite(highBarrier) ? highBarrier : null,
        currentLowBarrier: Number.isFinite(lowBarrier) ? lowBarrier : null,
      });
    }

    if (!c.is_sold && String(c.status ?? "").toLowerCase() !== "sold" && String(c.status ?? "").toLowerCase() !== "lost" && String(c.status ?? "").toLowerCase() !== "won") return;
    this.settle(c);
  }

  private async requestAutomaticClose(contractId: string, reason: string) {
    if (this.closeRequested || this.destroyed || !this.config.isAuthorized) return;
    this.closeRequested = true;
    this.closeReason = reason;
    this.setRuntime({ closeReason: reason });
    try {
      const current = useAccumulatorStore.getState().runtime;
      logger.trade(`■ ACCU auto-close | ${reason} | lucro ${this.format(current.currentProfit ?? 0)}`);
      await derivService.sellContract(contractId);
    } catch (e: any) {
      this.closeRequested = false;
      const message = e?.message || "Falha ao fechar Accumulator automaticamente.";
      this.setRuntime({ error: message });
      logger.error(`Accumulators V1: ${message}`);
    }
  }

  private shouldClose(elapsed: number, profit: number, profitPercent: number, c: any) {
    if (this.profitMartingaleActive) return profit >= this.config.profitMartingaleTarget;
    switch (this.config.closeMode) {
      case "profit_percent": return profitPercent >= this.config.profitPercentTarget;
      case "contract_take_profit": return profit >= this.config.contractTakeProfit;
      case "ticks":
      default: return elapsed >= this.config.durationTicks;
    }
  }

  private getCloseReason(elapsed: number, profit: number, profitPercent: number, c: any) {
    void c;
    if (this.profitMartingaleActive) return `Profit Martingale: +$${profit.toFixed(2)} alvo $${this.config.profitMartingaleTarget.toFixed(2)}`;
    switch (this.config.closeMode) {
      case "profit_percent": return `Profit ${profitPercent.toFixed(2)}% atingido (alvo ${this.config.profitPercentTarget.toFixed(2)}%)`;
      case "contract_take_profit": return `Take Profit do contrato: +$${profit.toFixed(2)} (alvo $${this.config.contractTakeProfit.toFixed(2)})`;
      case "ticks":
      default: return `Limite de ${elapsed} ticks atingido`;
    }
  }

  private resolveActiveCloseMode(): AccumulatorCloseMode {
    if (this.profitMartingaleActive) return "contract_take_profit";
    return this.config.closeMode;
  }

  private resolveActiveProfitTarget(stake: number, mode: AccumulatorCloseMode): number | null {
    if (this.profitMartingaleActive) return this.config.profitMartingaleTarget;
    if (mode === "profit_percent") return stake * (this.config.profitPercentTarget / 100);
    if (mode === "contract_take_profit") return this.config.contractTakeProfit;
    return null;
  }

  private runtimeTicks() { return useAccumulatorStore.getState().runtime.ticksElapsed; }

  private settle(c: any) {
    if (!this.activeContractId || this.lastProcessedContractId === String(c.contract_id)) return;
    this.lastProcessedContractId = String(c.contract_id);

    const profit = this.toNumber(c.profit) ?? 0;
    const status = String(c.status ?? "").toLowerCase();
    const isKnockout = status === "lost" || (Number(c.is_sold) === 0 && status === "lost");
    const result = profit > 0 ? "WON" : "LOST" as const;
    const stake = this.toNumber(c.buy_price) ?? this.risk.currentStake;
    const activeCloseReason = this.closeReason;
    const wasProfitMartingale = this.profitMartingaleActive;
    const wasManualContract = this.manualContract;

    this.processing = false;
    this.activeContractId = null;
    this.closeRequested = false;
    this.forgetSubscription(c);

    const finalTicks = this.toNumber(c.tick_passed);
    this.setRuntime({
      isProcessing: false,
      activeContractId: null,
      lastContractId: String(c.contract_id),
      lastStake: Number.isFinite(stake) ? stake : this.risk.currentStake,
      lastResult: result,
      lastProfit: profit,
      lastTradeAt: Date.now(),
      ticksElapsed: Number.isFinite(finalTicks) ? Math.max(0, Math.floor(finalTicks!)) : this.runtimeTicks(),
      currentProfit: profit,
      currentProfitPercent: this.toNumber(c.profit_percentage) ?? this.calculateProfitPercent(c),
      currentValue: this.toNumber(c.bid_price),
      currentSpot: this.toNumber(c.exit_spot ?? c.current_spot),
      currentHighBarrier: this.toNumber(c.current_spot_high_barrier ?? c.high_barrier),
      currentLowBarrier: this.toNumber(c.current_spot_low_barrier ?? c.low_barrier),
      activeCloseMode: null,
      activeProfitTarget: null,
      closeReason: activeCloseReason,
      lastWasKnockout: isKnockout,
      profitMartingaleActive: wasProfitMartingale,
      isManualContract: false,
    });

    saveTrade({
      market: "synthetic",
      id: String(c.contract_id),
      time: Number(c.date_start) > 0 ? Number(c.date_start) * 1000 : Date.now(),
      symbol: String(c.underlying_symbol ?? c.symbol ?? this.config.symbol),
      type: "ACCU",
      stake: Number.isFinite(stake) ? stake : this.risk.currentStake,
      status: result,
      profit,
      entryPrice: this.toNumber(c.entry_spot ?? c.entry_tick),
      exitPrice: this.toNumber(c.exit_spot),
    });

    if (result === "WON") {
      useSessionStore.getState().recordWin(profit);
      if (!wasManualContract) this.risk = resolveAccumulatorWin(this.config);
      logger.trade(`✓ ACCU ${wasManualContract ? "MANUAL " : ""}WIN | ${this.format(profit)} | ${this.config.symbol}`);
      if (!wasManualContract) this.profitMartingaleActive = false;
    } else {
      useSessionStore.getState().recordLoss(profit);
      if (!wasManualContract) this.risk = resolveAccumulatorLoss(this.risk, this.config, Date.now());
      logger.trade(`✗ ACCU ${wasManualContract ? "MANUAL " : ""}LOSS${isKnockout ? " / KNOCK-OUT" : ""} | ${this.format(profit)} | ${this.config.symbol}`);
      if (!wasManualContract) this.profitMartingaleActive = Boolean(this.config.useProfitMartingale && isKnockout);
    }

    this.lastWasKnockout = isKnockout;
    this.syncRisk();
    this.checkLimits();

    if (this.config.isBotRunning && !this.destroyed && !this.limitTriggered) {
      const delay = this.risk.cooldownUntil ? this.config.cooldownAfterLoss * 1000 : 0;
      if (delay) {
        const until = this.risk.cooldownUntil!;
        useBotStore.getState().setLossCooldown({ reason: `Cooldown após ${this.config.maxConsecutiveLosses} perdas consecutivas`, until });
        setTimeout(() => { if (this.config.isBotRunning) void this.enter(); }, delay);
      } else {
        void this.enter();
      }
    } else if (!this.config.isBotRunning) {
    }
  }

  private syncRisk() {
    this.setRuntime({
      currentStake: this.risk.currentStake,
      martingaleStep: this.risk.martingaleStep,
      consecutiveLosses: this.risk.consecutiveLosses,
    });
  }

  /**
   * Accumulators use the realized P&L of the current X-One session.
   *
   * IMPORTANT: do not derive these limits from the account balance. ACCU contracts
   * can still be open while the account balance already reflects the stake, and
   * that would make the session SL/TP trigger before the contract is settled.
   * The session store is updated only when an ACCU contract is settled.
   */
  private getSessionPnl() {
    return useSessionStore.getState().pnl;
  }

  private checkLimits() {
    if (!this.config.isBotRunning || this.limitTriggered) return;

    const pnl = this.getSessionPnl();
    if (this.config.targetProfit > 0 && pnl >= this.config.targetProfit) {
      this.limitTriggered = true;
      this.forceStop(`Take Profit da sessão atingido: +$${pnl.toFixed(2)}`, "take_profit", pnl);
    } else if (this.config.stopLoss > 0 && pnl <= -this.config.stopLoss) {
      this.limitTriggered = true;
      this.forceStop(`Stop Loss da sessão atingido: $${pnl.toFixed(2)}`, "stop_loss", pnl);
    } else if (this.risk.consecutiveLosses >= this.config.maxConsecutiveLosses && this.config.maxConsecutiveLosses > 0) {
      this.limitTriggered = true;
      this.forceStop(`${this.config.maxConsecutiveLosses} perdas consecutivas — limite de risco atingido`);
    }
  }

  private checkSessionLimits() {
    if (!this.config.isBotRunning || this.limitTriggered) return;

    const pnl = this.getSessionPnl();
    if (this.config.targetProfit > 0 && pnl >= this.config.targetProfit) {
      this.limitTriggered = true;
      this.forceStop(`Take Profit da sessão atingido: +$${pnl.toFixed(2)}`, "take_profit", pnl);
    } else if (this.config.stopLoss > 0 && pnl <= -this.config.stopLoss) {
      this.limitTriggered = true;
      this.forceStop(`Stop Loss da sessão atingido: $${pnl.toFixed(2)}`, "stop_loss", pnl);
    } else if (this.config.maxConsecutiveLosses > 0 && this.risk.consecutiveLosses >= this.config.maxConsecutiveLosses && this.config.cooldownAfterLoss <= 0) {
      this.limitTriggered = true;
      this.forceStop(`${this.config.maxConsecutiveLosses} perdas consecutivas — limite de risco atingido`);
    }
  }

  private forceStop(reason: string, limitType?: "take_profit" | "stop_loss", amount?: number) {
    this.config = { ...this.config, isBotRunning: false };
    if (limitType) {
      this.setRuntime({ sessionLimitReached: { type: limitType, amount: amount ?? 0, reason } });
    }
    this.config.onForceStop(reason);
    logger.risk(`⛔ ${reason}`);
  }

  private setRuntime(patch: Partial<ReturnType<typeof useAccumulatorStore.getState>["runtime"]>) {
    useAccumulatorStore.getState().setRuntime(patch);
  }

  private forgetSubscription(data?: any) {
    const id = this.activeSubscriptionId ?? data?.subscription?.id;
    if (id) derivService.send({ forget: String(id) });
    this.activeSubscriptionId = null;
  }

  private calculateProfitPercent(c: any): number | null {
    const p = this.toNumber(c.profit);
    const buy = this.toNumber(c.buy_price);
    if (p === null || buy === null || buy <= 0) return null;
    return (p / buy) * 100;
  }

  private toNumber(value: any): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private normalizeConfig(config: AccumulatorEngineConfig): AccumulatorEngineConfig {
    return {
      ...config,
      growthRate: config.growthRate || DEFAULT_GROWTH_RATE,
      closeMode: config.closeMode ?? DEFAULT_CLOSE_MODE,
      profitPercentTarget: Math.max(0.01, Number(config.profitPercentTarget ?? 25)),
      contractTakeProfit: Math.max(0.01, Number(config.contractTakeProfit ?? 0.5)),
      useProfitMartingale: Boolean(config.useProfitMartingale),
      profitMartingaleTarget: Math.max(0.01, Number(config.profitMartingaleTarget ?? 0.5)),
      filters: { ...DEFAULT_ACCUMULATOR_FILTERS, ...(config.filters ?? {}) },
    };
  }

  private closeModeLabel(mode = this.config.closeMode, target: number | null = null) {
    if (mode === "profit_percent") return `profit ${target?.toFixed(2) ?? this.config.profitPercentTarget.toFixed(2)}%`;
    if (mode === "contract_take_profit") return `TP contrato $${target?.toFixed(2) ?? this.config.contractTakeProfit.toFixed(2)}`;
    return `${this.config.durationTicks} ticks`;
  }

  private format(v: number) { return `${v >= 0 ? "+" : ""}$${Math.abs(v).toFixed(2)}`; }
  private fail(message: string) { this.setRuntime({ error: message, isProcessing: false }); logger.error(`Accumulators V1: ${message}`); }
}
