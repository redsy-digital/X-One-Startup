import { derivService } from "../lib/deriv";
import { logger } from "../lib/logger";
import { saveTrade } from "../lib/storage";
import { useSessionStore } from "../store/useSessionStore";
import { useBotStore } from "../store/useBotStore";
import { useMarketStore } from "../store/useMarketStore";
import { contractForDirection, directionFromPrices, findAlternatingSignal, findBlockDensitySignal, findSequenceSignal, findPercentChannelSignal } from "./strategy";
import type { RiseFallConfig, RiseFallContractType, RiseFallDirection, RiseFallRuntimeState } from "./types";

type PreparedProposal = { proposal: any; contract: RiseFallContractType; stake: number; duration: number; preparedAt: number };

const PROPOSAL_MAX_AGE_MS = 2400;
const PROPOSAL_RENEW_AFTER_MS = 1600;
const HISTORY_MAX = 1000;

export class RiseFallEngineV1 {
  private config: RiseFallConfig;
  private directions: RiseFallDirection[] = [];
  private directionStreak: RiseFallDirection[] = [];
  private prices: number[] = [];
  private trendBlockedDirection: RiseFallDirection | null = null;
  private previousPrice: number | null = null;
  private signalKey: string | null = null;
  private activeContractId: string | null = null;
  private activeContract: RiseFallContractType | null = null;
  private activeStake: number | null = null;
  private processing = false;
  private destroyed = false;
  private unsubs: Array<() => void> = [];
  private proposals = new Map<RiseFallContractType, PreparedProposal>();
  private prewarmInFlight = new Map<RiseFallContractType, Promise<PreparedProposal | null>>();
  private historySeeded = false;
  private pendingLivePrice: number | null = null;
  private risk = { currentStake: 0, martingaleStep: 0, consecutiveLosses: 0 };
  private runtime: RiseFallRuntimeState;
  private sessionInitialBalance: number | null = null;
  private limitTriggered = false;
  private lastProcessedContractId: string | null = null;
  private loggedProposalIds = new Map<string, string>();
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RiseFallConfig) {
    this.config = config;
    this.risk.currentStake = config.stake;
    this.runtime = this.makeRuntime();
  }

  private makeRuntime(): RiseFallRuntimeState {
    return {
      currentStake: this.risk.currentStake || this.config.stake,
      martingaleStep: this.risk.martingaleStep,
      consecutiveLosses: this.risk.consecutiveLosses,
      isProcessing: this.processing,
      activeContractId: this.activeContractId,
      currentContract: this.activeContract,
      lastContract: null,
      lastResult: null,
      lastProfit: null,
      lastStake: null,
      lastTradeAt: null,
      entries: 0,
      nextContract: this.config.contract,
      nextStake: this.risk.currentStake || this.config.stake,
      error: null,
    };
  }

  getRuntime() { return this.runtime; }

  private setRuntime(patch: Partial<RiseFallRuntimeState>) {
    this.runtime = { ...this.runtime, ...patch };
  }

  start() {
    if (this.destroyed || !this.config.isAuthorized || !this.config.isBotRunning) return;
    this.limitTriggered = false;
    this.historySeeded = false;
    this.pendingLivePrice = null;
    useSessionStore.getState().resetSession();
    if (this.sessionInitialBalance == null && this.config.balance != null) this.sessionInitialBalance = this.config.balance;
    if (!this.unsubs.length) {
      this.unsubs.push(derivService.on("tick", (data) => this.handleTick(data)));
      this.unsubs.push(derivService.on("proposal_open_contract", (data) => this.handleContractUpdate(data)));
    }
    logger.system(`Rise/Fall V1 iniciado | ${this.config.symbol} | duração ${this.config.durationTicks}t`);
    logger.system(`Rise/Fall estratégias | Sequência ${this.config.sequenceEnabled ? "ON" : "OFF"} | Densidade ${this.config.blockDensityEnabled ? "ON" : "OFF"} | Alternância ${this.config.alternatingEnabled ? "ON" : "OFF"}`);
    this.prewarmAll();
  }

  stop() {
    this.stopRecovery();
    this.invalidateProposals();
    if (!this.processing && this.activeContractId == null) this.resetSignalState();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  destroy() {
    this.destroyed = true;
    this.stop();
  }

  updateConfig(config: RiseFallConfig) {
    const changed = this.config.symbol !== config.symbol || this.config.durationTicks !== config.durationTicks ||
      this.config.stake !== config.stake || this.config.contract !== config.contract ||
      this.config.sequenceEnabled !== config.sequenceEnabled || this.config.sequenceLength !== config.sequenceLength ||
      this.config.blockDensityEnabled !== config.blockDensityEnabled || this.config.blockWindow !== config.blockWindow ||
      this.config.blockThreshold !== config.blockThreshold || this.config.alternatingEnabled !== config.alternatingEnabled ||
      this.config.alternatingLength !== config.alternatingLength || this.config.percentChannelEnabled !== config.percentChannelEnabled || this.config.percentChannelWindow !== config.percentChannelWindow || this.config.percentChannelThreshold !== config.percentChannelThreshold || this.config.percentChannelSequenceLength !== config.percentChannelSequenceLength || this.config.momentumFilterEnabled !== config.momentumFilterEnabled || this.config.trendProtectionEnabled !== config.trendProtectionEnabled || this.config.martingaleMultiplier !== config.martingaleMultiplier ||
      this.config.maxMartingaleSteps !== config.maxMartingaleSteps;
    this.config = config;
    if (changed && !this.processing && !this.activeContractId) {
      this.resetSignalState();
      this.invalidateProposals();
      this.risk.currentStake = this.risk.martingaleStep > 0 ? this.risk.currentStake : config.stake;
      this.setRuntime({ currentStake: this.risk.currentStake, nextStake: this.risk.currentStake, nextContract: config.contract });
      if (config.isBotRunning && config.isAuthorized) this.prewarmAll();
    }
  }

  private resetSignalState() {
    this.directions = [];
    this.directionStreak = [];
    this.prices = [];
    this.previousPrice = null;
    this.signalKey = null;
    this.historySeeded = false;
    this.pendingLivePrice = null;
  }

  private invalidateProposals() { this.proposals.clear(); }

  private seedHistoricalContext(currentEpoch?: number) {
    if (this.historySeeded) return;
    const market = useMarketStore.getState();
    if (market.historicalTicksLoading) return;
    const history = market.ticks
      .filter((t) => t.time < (currentEpoch ?? Number.POSITIVE_INFINITY))
      .sort((a, b) => a.time - b.time);
    if (!history.length) return;

    const usable = history.slice(-HISTORY_MAX);
    this.directions = [];
    let previous: number | null = null;
    for (const tick of usable) {
      const price = Number(tick.price);
      if (!Number.isFinite(price)) continue;
      const direction = directionFromPrices(previous, price);
      previous = price;
      if (direction) this.directions.push(direction);
    }
    this.directions = this.directions.slice(-HISTORY_MAX);
    this.directionStreak = [];
    for (const d of this.directions.slice().reverse()) { if (this.directionStreak.length && this.directionStreak[this.directionStreak.length - 1] !== d) break; this.directionStreak.unshift(d); }
    this.previousPrice = previous;
    this.prices = usable.map(t => Number(t.price)).filter(Number.isFinite).slice(-HISTORY_MAX);
    this.historySeeded = true;
    logger.telemetry(`[HISTORY] Rise/Fall contexto inicializado | ${usable.length} ticks | ${this.directions.length} direções | entrada só pode nascer de tick ao vivo`);
  }

  private prewarm(contract: RiseFallContractType): Promise<PreparedProposal | null> {
    if (this.destroyed || !this.config.isBotRunning || !this.config.isAuthorized) return Promise.resolve(null);
    const stake = this.risk.currentStake || this.config.stake;
    const duration = Math.max(1, Math.floor(this.config.durationTicks));
    const cached = this.proposals.get(contract);
    const age = cached ? Date.now() - cached.preparedAt : Infinity;
    const fresh = cached && cached.stake === stake && cached.duration === duration && age < PROPOSAL_MAX_AGE_MS;
    if (fresh && age < PROPOSAL_RENEW_AFTER_MS) return Promise.resolve(cached);
    if (fresh && age >= PROPOSAL_RENEW_AFTER_MS) {
      const existing = this.prewarmInFlight.get(contract);
      if (existing) return Promise.resolve(cached);
      // Renew in background before the entry window becomes stale.
    }

    const existing = this.prewarmInFlight.get(contract);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const proposal = await derivService.getRiseFallProposal(this.config.symbol, contract, stake, duration);
        if (this.destroyed) return null;
        const id = String(proposal?.id ?? "");
        const ask = Number(proposal?.ask_price);
        if (!id || !Number.isFinite(ask) || ask <= 0) throw new Error("Proposal Rise/Fall inválida.");
        const prepared = { proposal, contract, stake, duration, preparedAt: Date.now() };
        this.proposals.set(contract, prepared);
        const contextKey = `${contract}|${stake}|${duration}`;
        const lastLoggedId = this.loggedProposalIds.get(contextKey);
        if (lastLoggedId !== id) {
          this.loggedProposalIds.set(contextKey, id);
          logger.telemetry(`[ENTRY] Rise/Fall Proposal prewarm pronta | ${contract} | stake=${stake} | duration=${duration} | ID ${id}`);
        }
        return prepared;
      } catch (e: any) {
        logger.error(`[ENTRY] Rise/Fall Proposal prewarm falhou | ${contract} | ${e?.message || e}`);
        return null;
      } finally {
        this.prewarmInFlight.delete(contract);
      }
    })();
    this.prewarmInFlight.set(contract, promise);
    return promise;
  }

  private prewarmAll() { void this.prewarm("CALL"); void this.prewarm("PUT"); }

  private async getPrepared(contract: RiseFallContractType) {
    const p = this.proposals.get(contract);
    const stake = this.risk.currentStake || this.config.stake;
    const duration = Math.max(1, Math.floor(this.config.durationTicks));
    if (p && p.stake === stake && p.duration === duration && Date.now() - p.preparedAt <= PROPOSAL_MAX_AGE_MS) return p;
    if (p) this.proposals.delete(contract);
    const inFlight = this.prewarmInFlight.get(contract);
    if (inFlight) {
      logger.telemetry(`[ENTRY] Rise/Fall Proposal renewal em voo reutilizada | ${contract}`);
      return await inFlight;
    }
    return await this.prewarm(contract);
  }

  private async enter(contract: RiseFallContractType, reason: string, triggerAt: number, triggerEpoch: number | null) {
    if (this.processing || this.activeContractId || this.destroyed || !this.config.isBotRunning || this.config.isBotPaused || this.limitTriggered) return;
    const stake = this.risk.currentStake || this.config.stake;
    this.processing = true;
    this.setRuntime({ isProcessing: true, currentContract: contract, currentStake: stake, error: null });
    let prepared: PreparedProposal | null = null;
    try {
      prepared = await this.getPrepared(contract);
      if (!prepared) throw new Error(`Proposal Rise/Fall indisponível para ${contract}.`);
      if (Date.now() - prepared.preparedAt <= PROPOSAL_MAX_AGE_MS) {
        logger.telemetry(`[ENTRY] Rise/Fall Proposal prewarm utilizada | ${contract} | age=${Date.now() - prepared.preparedAt}ms`);
      }
      const proposalId = String(prepared.proposal?.id ?? "");
      const ask = Number(prepared.proposal?.ask_price);
      if (!proposalId || !Number.isFinite(ask) || ask <= 0) throw new Error("Proposal Rise/Fall inválida para BUY.");
      const buyRequestAt = Date.now();
      logger.signal(`Rise/Fall | ${reason} | entrada ${contract === "CALL" ? "Rise" : "Fall"} | decisão +${buyRequestAt - triggerAt}ms`);
      const buy = await derivService.buyProposal(proposalId, ask);
      const buyCompletedAt = Date.now();
      const serverPurchaseTime = Number(buy.purchaseTime);
      const triggerToServerPurchase = triggerEpoch != null && Number.isFinite(serverPurchaseTime)
        ? Math.round(serverPurchaseTime * 1000 - triggerEpoch * 1000)
        : null;
      this.activeContractId = buy.contractId;
      this.activeContract = contract;
      this.activeStake = stake;
      this.lastProcessedContractId = null;
      saveTrade({
        market: "synthetic",
        id: buy.contractId,
        time: Date.now(),
        symbol: this.config.symbol,
        type: contract,
        stake,
        status: "PENDING",
        profit: 0,
      });
      this.setRuntime({ isProcessing: true, activeContractId: buy.contractId, currentContract: contract, currentStake: stake, entries: this.runtime.entries + 1 });
      logger.telemetry(`[ENTRY] Rise/Fall Pendente | contrato ${buy.contractId} | stake=${stake}`);
      logger.telemetry(`[ENTRY] Rise/Fall BUY enviado | +${buyRequestAt - triggerAt}ms desde trigger`);
      logger.telemetry(`[ENTRY] Rise/Fall BUY resposta | ${buyCompletedAt - buyRequestAt}ms após envio | +${buyCompletedAt - triggerAt}ms desde trigger${triggerToServerPurchase !== null ? ` | Δtick→purchase=${triggerToServerPurchase}ms` : ""}`);
      derivService.send({ proposal_open_contract: 1, contract_id: buy.contractId, subscribe: 1 });
      this.startRecovery(buy.contractId);
    } catch (e: any) {
      this.processing = false;
      this.setRuntime({ isProcessing: false, currentContract: null, activeContractId: null, error: e?.message || String(e) });
      logger.error(`Rise/Fall entrada falhou | ${e?.message || e}`);
      void this.prewarm(contract);
    }
  }

  private handleTick(data: any) {
    const cooldown = useBotStore.getState().lossCooldown;
    if (this.destroyed || !this.config.isBotRunning || !this.config.isAuthorized || this.config.isBotPaused || this.processing || this.activeContractId || (cooldown && Date.now() < cooldown.until)) return;
    const tick = data?.tick;
    if (!tick || String(tick.symbol ?? "") !== this.config.symbol) return;
    const epoch = Number(tick.epoch ?? 0);
    if (!this.historySeeded) {
      this.seedHistoricalContext(epoch > 0 ? epoch - 0.000001 : undefined);
      if (!this.historySeeded) {
        this.pendingLivePrice = Number(tick.quote);
        return;
      }
    }
    const price = Number(tick.quote);
    if (!Number.isFinite(price)) return;
    const previousTickPrice = this.previousPrice;
    const direction = directionFromPrices(previousTickPrice, price);
    this.previousPrice = price;
    this.prices.push(price);
    const channelWindow = Math.max(5, Math.min(500, Math.floor(this.config.percentChannelWindow)));
    if (this.prices.length > Math.max(HISTORY_MAX, channelWindow)) this.prices.splice(0, this.prices.length - Math.max(HISTORY_MAX, channelWindow));
    if (!direction) { this.directionStreak = []; return; }
    if (this.directionStreak.length && this.directionStreak[this.directionStreak.length - 1] !== direction) this.directionStreak = [];
    this.directionStreak.push(direction);
    if (this.directionStreak.length > 1000) this.directionStreak.shift();
    this.directions.push(direction);
    if (this.config.trendProtectionEnabled && this.trendBlockedDirection && direction !== this.trendBlockedDirection) { this.trendBlockedDirection = null; logger.telemetry("Rise/Fall Trend Protection: sequência direcional quebrou; entradas desbloqueadas."); }
    if (this.directions.length > HISTORY_MAX) this.directions.splice(0, this.directions.length - HISTORY_MAX);

    let signal: { contract: RiseFallContractType; key: string; reason: string } | null = null;
    if (this.config.percentChannelEnabled) {
      const recentPrices = this.prices.slice(-channelWindow);
      const s = findPercentChannelSignal({ prices: recentPrices, directions: this.directionStreak, thresholdPercent: this.config.percentChannelThreshold, sequenceLength: this.config.percentChannelSequenceLength, momentumFilter: this.config.momentumFilterEnabled });
      if (s) signal = { contract: s.contract, key: `percent-channel:${this.directions.length}:${s.contract}:${recentPrices[recentPrices.length - 1]}`, reason: s.reason };
    }
    if (this.config.sequenceEnabled) {
      const s = findSequenceSignal(this.directions, this.config.sequenceLength);
      if (s) signal = { contract: s.contract, key: `seq:${this.directions.length}:${s.direction}:${this.config.sequenceLength}`, reason: `Sequência de ${this.config.sequenceLength} ${s.direction === "UP" ? "altas" : "baixas"}` };
    }
    if (!signal && this.config.blockDensityEnabled) {
      const s = findBlockDensitySignal(this.directions, this.config.blockWindow, this.config.blockThreshold);
      if (s) signal = { contract: s.contract, key: `density:${this.directions.length}:${s.dominant}:${s.percent.toFixed(2)}`, reason: `Densidade ${s.percent.toFixed(0)}% ${s.dominant === "UP" ? "alta" : "baixa"}` };
    }
    if (!signal && this.config.alternatingEnabled) {
      const s = findAlternatingSignal(this.directions, this.config.alternatingLength);
      if (s) signal = { contract: s.contract, key: `alt:${this.directions.length}:${s.lastDirection}:${this.config.alternatingLength}`, reason: `Alternância ${this.config.alternatingLength} ticks` };
    }
    if (signal && this.config.trendProtectionEnabled && this.trendBlockedDirection && direction === this.trendBlockedDirection) signal = null;
    if (!signal || signal.key === this.signalKey) {
      this.prewarmAll();
      return;
    }
    this.signalKey = signal.key;
    const triggerAt = Date.now();
    logger.signal(`Rise/Fall trigger detectado | ${signal.reason} | entrada ${signal.contract === "CALL" ? "Rise" : "Fall"} | trigger imediato`);
    void this.enter(signal.contract, signal.reason, triggerAt, epoch > 0 ? epoch : null);
  }

  private handleContractUpdate(data: any) {
    const c = data?.proposal_open_contract;
    if (!c) return;
    const id = String(c.contract_id ?? "");
    if (!id || id !== this.activeContractId || !c.is_sold || id === this.lastProcessedContractId) return;
    this.lastProcessedContractId = id;
    this.stopRecovery();
    const isWin = String(c.status).toLowerCase() === "won";
    const result = isWin ? "WON" : "LOST";
    const profit = Number(c.profit ?? 0);
    const stake = Number(c.buy_price ?? this.activeStake ?? this.risk.currentStake);
    const contract = this.activeContract ?? this.config.contract;
    this.processing = false;
    this.activeContractId = null;
    this.activeContract = null;
    this.activeStake = null;
    saveTrade({ market: "synthetic", id, time: Number(c.date_start) > 0 ? Number(c.date_start) * 1000 : Date.now(), symbol: String(c.underlying_symbol ?? c.symbol ?? this.config.symbol), type: contract, stake, status: result, profit: Number.isFinite(profit) ? profit : 0, entryPrice: this.toNumber(c.entry_tick), exitPrice: this.toNumber(c.exit_tick ?? c.exit_spot) });
    if (!isWin && this.config.trendProtectionEnabled) { this.trendBlockedDirection = contract === "PUT" ? "UP" : "DOWN"; logger.telemetry(`Rise/Fall Trend Protection ativada após LOSS | aguarda quebra de ${this.trendBlockedDirection}`); }
    if (isWin) {
      this.trendBlockedDirection = null;
      useSessionStore.getState().recordWin(profit);
      this.risk.currentStake = this.config.stake;
      this.risk.martingaleStep = 0;
      this.risk.consecutiveLosses = 0;
      useBotStore.getState().setLossCooldown(null);
      logger.trade(`✓ Rise/Fall WIN | ${contract} | ${this.formatMoney(profit)} | ID ${id}`);
    } else {
      useSessionStore.getState().recordLoss(profit);
      this.risk.consecutiveLosses += 1;
      if (this.config.useMartingale && this.risk.martingaleStep < this.config.maxMartingaleSteps) {
        this.risk.martingaleStep += 1;
        this.risk.currentStake = this.roundMoney(this.config.stake * Math.pow(this.config.martingaleMultiplier, this.risk.martingaleStep));
      } else {
        this.risk.martingaleStep = 0;
        this.risk.currentStake = this.config.stake;
      }
      logger.trade(`✗ Rise/Fall LOSS | ${contract} | ${this.formatMoney(profit)} | ID ${id}`);
      if (this.risk.consecutiveLosses >= this.config.maxConsecutiveLosses) {
        if (this.config.cooldownAfterLoss > 0) {
          const until = Date.now() + this.config.cooldownAfterLoss * 1000;
          useBotStore.getState().setLossCooldown({ reason: `${this.config.maxConsecutiveLosses} perdas consecutivas`, until });
          logger.risk(`⚠ Rise/Fall cooldown ${this.config.cooldownAfterLoss}s após perdas consecutivas`);
        } else {
          this.forceStop(`${this.config.maxConsecutiveLosses} perdas consecutivas — limite de risco atingido`);
          return;
        }
      }
    }
    this.setRuntime({ isProcessing: false, activeContractId: null, currentContract: null, lastContract: contract, lastResult: result as "WON" | "LOST", lastProfit: profit, lastStake: stake, lastTradeAt: Date.now(), currentStake: this.risk.currentStake, martingaleStep: this.risk.martingaleStep, consecutiveLosses: this.risk.consecutiveLosses, nextContract: this.config.contract, nextStake: this.risk.currentStake });
    this.checkSessionLimits();
    this.signalKey = null;
    this.resetSignalAfterSettlement();
    this.prewarmAll();
  }

  private resetSignalAfterSettlement() {
    this.directions = [];
    this.previousPrice = this.previousPrice;
  }

  private checkSessionLimits() {
    const pnl = useSessionStore.getState().pnl;
    if (this.config.targetProfit > 0 && pnl >= this.config.targetProfit) {
      this.limitTriggered = true;
      const amount = pnl;
      useSessionStore.getState().setModal({ show: true, type: "profit", amount });
      this.forceStop(`Meta de lucro atingida: ${this.formatMoney(pnl)}`);
    } else if (this.config.stopLoss > 0 && pnl <= -Math.abs(this.config.stopLoss)) {
      this.limitTriggered = true;
      const amount = pnl;
      useSessionStore.getState().setModal({ show: true, type: "loss", amount });
      this.forceStop(`Stop Loss atingido: ${this.formatMoney(pnl)}`);
    }
  }

  private forceStop(reason: string) {
    logger.risk(`⛔ Rise/Fall: ${reason}`);
    useBotStore.getState().setIsBotRunning(false);
    this.config = { ...this.config, isBotRunning: false };
  }

  private startRecovery(contractId: string) {
    this.stopRecovery();
    let attempts = 0;
    this.recoveryTimer = setInterval(async () => {
      attempts += 1;
      if (this.destroyed || !this.activeContractId || this.activeContractId !== contractId || attempts > 30) { this.stopRecovery(); return; }
      try {
        const snapshot = await derivService.getOpenContract(contractId);
        if (snapshot?.is_sold) this.handleContractUpdate({ proposal_open_contract: snapshot });
      } catch { /* live subscription remains the primary path */ }
    }, 1000);
  }

  private stopRecovery() { if (this.recoveryTimer) { clearInterval(this.recoveryTimer); this.recoveryTimer = null; } }
  private toNumber(v: any) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
  private formatMoney(v: number) { return `${v >= 0 ? "+" : ""}$${Number(v || 0).toFixed(2)}`; }
  private roundMoney(v: number) { return Math.round(v * 100) / 100; }
}
