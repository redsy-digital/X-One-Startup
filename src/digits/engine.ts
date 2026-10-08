import { derivService } from "../lib/deriv";
import { saveTrade } from "../lib/storage";
import { logger } from "../lib/logger";
import { useBotStore } from "../store/useBotStore";
import { useSessionStore } from "../store/useSessionStore";
import { useDigitsStore } from "./store";
import { createDigitsRiskState, resetDigitsRisk, resolveDigitsLoss, resolveDigitsWin, type DigitsRiskState } from "./risk";
import { digitsContractLabel, digitsContractNeedsDigit, type DigitsConfig, type DigitsRiskConfig, type DigitsTradeResult, type DigitsContractType } from "./types";
import { consumeDigitsSequence, consumeOverUnderSequence, INITIAL_DIGITS_SEQUENCE_STATE, INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE, type DigitsSequenceMode, type DigitsSequenceState, type DigitsOverUnderSequenceState } from "./sequenceStrategy";
import { extractLastDigit, extractLastDigitFromTick } from "./digit";
import { useMarketStore } from "../store/useMarketStore";
import { calculateDigitPercentageStats } from "./percentageStats";
import { findAbsenceSignal, findSaturationSignal } from "./percentageStrategy";
import { findAlternatingSignal, findAnchorSignal, findBlockDensitySignal } from "./parityProbabilityStrategy";
import { advanceTwinSplittingState, findMirrorSymmetrySignal } from "./matchProbabilityStrategy";

const DEFAULT_DIGITS_DURATION = 3;
const MIN_STAKE = 0.35;
const PREWARM_MAX_AGE_MS = 3000;
const PREWARM_REFRESH_AGE_MS = 1800;

export function randomDigitsTarget(): number {
  return Math.floor(Math.random() * 10);
}

export interface DigitsEngineConfig extends DigitsConfig, DigitsRiskConfig {
  symbol: string;
  isAuthorized: boolean;
  isBotRunning: boolean;
  balance: number | null;
  onForceStop: (reason: string) => void;
  sequenceStrategyEnabled: boolean;
  sequenceStrategyMode: DigitsSequenceMode;
  sequenceLength: number;
  overUnderSequenceStrategyEnabled: boolean;
  overUnderSequenceLength: number;
  overUnderOverBarrier: number;
  overUnderUnderBarrier: number;
  percentageSaturationStrategyEnabled: boolean;
  percentageSaturationThreshold: number;
  percentageAbsenceStrategyEnabled: boolean;
  percentageAbsenceStreak: number;
  percentageWindow: number;
  parityBlockDensityEnabled: boolean;
  parityBlockWindow: number;
  parityBlockThreshold: number;
  parityAlternatingEnabled: boolean;
  parityAlternatingLength: number;
  parityAnchorEnabled: boolean;
  matchTwinEnabled: boolean;
  matchTwinRestTicks: number;
  matchMirrorEnabled: boolean;
  matchMirrorWindow: number;
  matchMirrorDominance: number;
  isBotPaused: boolean;
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
  private sequenceState: DigitsSequenceState = INITIAL_DIGITS_SEQUENCE_STATE;
  private strategyEntryInFlight = false;
  private strategyPendingContract: DigitsContractType | null = null;
  private strategyPendingTargetDigit: number | null = null;
  private overUnderSequenceState: DigitsOverUnderSequenceState = INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE;
  private percentageSignalKey: string | null = null;
  private parityProbabilitySignalKey: string | null = null;
  private matchProbabilitySignalKey: string | null = null;
  private liveMatchDigits: number[] = [];
  private lastLiveMatchDigit: number | null = null;
  private twinTargetDigit: number | null = null;
  private twinRemainingTicks = 0;
  private diagnosticTickCount = 0;
  private lastDiagnosticEpoch: number | null = null;
  private lastDiagnosticReceivedAt: number | null = null;
  private prewarmedProposals = new Map<DigitsContractType, {
    proposal: any;
    contract: DigitsContractType;
    stake: number;
    duration: number;
    targetDigit: number | null;
    preparedAt: number;
  }>();
  private prewarmInFlightContracts = new Set<DigitsContractType>();
  private contractRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private contractRecoveryStartedAt: number | null = null;

  constructor(config: DigitsEngineConfig) {
    this.config = config;
    this.risk = createDigitsRiskState(config);
    this.bindEvents();
  }

  updateConfig(config: DigitsEngineConfig) {
    const previousEnabled = this.config.sequenceStrategyEnabled;
    const previousMode = this.config.sequenceStrategyMode;
    const previousLength = this.config.sequenceLength;
    const previousContract = this.config.contract;
    const previousStake = this.config.stake;
    const previousDuration = this.config.contractDurationTicks;
    const previousSymbol = this.config.symbol;
    const previousTargetDigit = this.config.targetDigit;
    const previousOverUnderEnabled = this.config.overUnderSequenceStrategyEnabled;
    const previousOverUnderLength = this.config.overUnderSequenceLength;
    const previousOverUnderOverBarrier = this.config.overUnderOverBarrier;
    const previousOverUnderUnderBarrier = this.config.overUnderUnderBarrier;
    const previousPaused = this.config.isBotPaused;
    const previousSatEnabled = this.config.percentageSaturationStrategyEnabled;
    const previousSatThreshold = this.config.percentageSaturationThreshold;
    const previousAbsEnabled = this.config.percentageAbsenceStrategyEnabled;
    const previousAbsStreak = this.config.percentageAbsenceStreak;
    const previousPercentageWindow = this.config.percentageWindow;
    const previousBlockEnabled = this.config.parityBlockDensityEnabled;
    const previousBlockWindow = this.config.parityBlockWindow;
    const previousBlockThreshold = this.config.parityBlockThreshold;
    const previousAlternatingEnabled = this.config.parityAlternatingEnabled;
    const previousAlternatingLength = this.config.parityAlternatingLength;
    const previousAnchorEnabled = this.config.parityAnchorEnabled;
    const previousMatchTwinEnabled = this.config.matchTwinEnabled;
    const previousMatchTwinRestTicks = this.config.matchTwinRestTicks;
    const previousMatchMirrorEnabled = this.config.matchMirrorEnabled;
    const previousMatchMirrorWindow = this.config.matchMirrorWindow;
    const previousMatchMirrorDominance = this.config.matchMirrorDominance;
    this.config = config;
    if (previousEnabled !== config.sequenceStrategyEnabled || previousMode !== config.sequenceStrategyMode || previousLength !== config.sequenceLength || previousContract !== config.contract || previousStake !== config.stake || previousDuration !== config.contractDurationTicks || previousSymbol !== config.symbol || previousTargetDigit !== config.targetDigit || previousOverUnderEnabled !== config.overUnderSequenceStrategyEnabled || previousOverUnderLength !== config.overUnderSequenceLength || previousOverUnderOverBarrier !== config.overUnderOverBarrier || previousOverUnderUnderBarrier !== config.overUnderUnderBarrier || previousSatEnabled !== config.percentageSaturationStrategyEnabled || previousSatThreshold !== config.percentageSaturationThreshold || previousAbsEnabled !== config.percentageAbsenceStrategyEnabled || previousAbsStreak !== config.percentageAbsenceStreak || previousPercentageWindow !== config.percentageWindow || previousBlockEnabled !== config.parityBlockDensityEnabled || previousBlockWindow !== config.parityBlockWindow || previousBlockThreshold !== config.parityBlockThreshold || previousAlternatingEnabled !== config.parityAlternatingEnabled || previousAlternatingLength !== config.parityAlternatingLength || previousAnchorEnabled !== config.parityAnchorEnabled || previousMatchTwinEnabled !== config.matchTwinEnabled || previousMatchTwinRestTicks !== config.matchTwinRestTicks || previousMatchMirrorEnabled !== config.matchMirrorEnabled || previousMatchMirrorWindow !== config.matchMirrorWindow || previousMatchMirrorDominance !== config.matchMirrorDominance) {
      this.resetSequenceStrategy();
      this.resetSequenceDiagnostics();
      this.clearPrewarmedProposal("configuração alterada");
    }
    if (previousPaused !== config.isBotPaused) {
      if (config.isBotPaused) {
        this.resetSequenceStrategy();
        this.resetOverUnderSequence();
        this.clearPrewarmedProposal("operação pausada");
        logger.system("Digits: operação pausada — novas entradas bloqueadas.");
      } else if (config.isBotRunning) {
        // A pausa preserva a sessão, mas a sequência temporal recomeça limpa.
        // O stake base alterado durante a pausa passa a valer imediatamente;
        // mantemos o nível de Martingale já alcançado.
        if (this.config.useMartingale && this.risk.martingaleStep > 0) {
          this.risk = { ...this.risk, currentStake: Math.round(config.stake * Math.pow(config.martingaleMultiplier, this.risk.martingaleStep) * 100) / 100 };
        } else {
          this.risk = { ...this.risk, currentStake: config.stake, martingaleStep: config.useMartingale ? this.risk.martingaleStep : 0 };
        }
        this.resetSequenceStrategy();
        this.resetOverUnderSequence();
        this.resetSequenceDiagnostics();
        this.syncRiskRuntime();
        this.clearPrewarmedProposal("retoma após pausa");
        logger.system("Digits: operação retomada — sequência reiniciada.");
      }
    }
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
      this.resetSequenceStrategy();
      this.resetOverUnderSequence();
      this.resetSequenceDiagnostics();
      this.clearPrewarmedProposal("nova sessão");
      useDigitsStore.getState().resetRuntime(this.risk.currentStake);
      useSessionStore.getState().resetSession();
      logger.system(`Digits V1 iniciado | ${this.contractLabel()} | stake $${this.risk.currentStake.toFixed(2)}`);
    }
    if (this.config.sequenceStrategyEnabled || this.config.overUnderSequenceStrategyEnabled || this.config.percentageSaturationStrategyEnabled || this.config.percentageAbsenceStrategyEnabled || this.config.parityBlockDensityEnabled || this.config.parityAlternatingEnabled || this.config.parityAnchorEnabled || this.config.matchTwinEnabled || this.config.matchMirrorEnabled) {
      this.resetSequenceDiagnostics();
      if (this.config.sequenceStrategyEnabled) logger.system(`Sequência Par/Ímpar activa | ${this.config.sequenceStrategyMode === "multiple" ? "Múltipla" : this.config.contract === "DIGITEVEN" ? "Par" : "Ímpar"} | sequência ${this.config.sequenceLength}`);
      if (this.config.overUnderSequenceStrategyEnabled) logger.system(`Sequência Over/Under activa | sequência ${this.config.overUnderSequenceLength} | baixos ≤${this.config.overUnderOverBarrier} | altos ≥${this.config.overUnderUnderBarrier}`);
      if (this.config.percentageSaturationStrategyEnabled) logger.system(`Percentual Saturação activo | janela ${this.config.percentageWindow} | limiar ${this.config.percentageSaturationThreshold.toFixed(1)}% | Differs`);
      if (this.config.percentageAbsenceStrategyEnabled) logger.system(`Percentual Ausência activo | janela ${this.config.percentageWindow} | streak ≥${this.config.percentageAbsenceStreak} | Match`);
      if (this.config.parityBlockDensityEnabled) logger.system(`Densidade de Bloco activa | janela ${this.config.parityBlockWindow} | limiar ${this.config.parityBlockThreshold.toFixed(1)}%`);
      if (this.config.parityAlternatingEnabled) logger.system(`Padrão Intermitente activo | alternância ${this.config.parityAlternatingLength} ticks`);
      if (this.config.parityAnchorEnabled) logger.system(`Dígito Âncora activo | âncoras 0/9`);
      if (this.config.matchTwinEnabled) logger.system(`Match Twin-Splitting activo | descanso ${this.config.matchTwinRestTicks} ticks`);
      if (this.config.matchMirrorEnabled) logger.system(`Match Simetria Espelho activa | janela ${this.config.matchMirrorWindow} | domínio ${this.config.matchMirrorDominance.toFixed(1)}%`);
      logger.telemetry("[WS] Diagnóstico de ticks activo | epoch + intervalos de recepção serão registados.");
      return;
    }
    void this.enterNextTrade();
  }

  stop() {
    if (this.destroyed) return;
    const hadWork = this.sessionInitialBalance !== null || this.processing || this.entryInFlight;
    this.config = { ...this.config, isBotRunning: false };
    this.entryInFlight = false;
    this.resetSequenceStrategy();
    this.resetOverUnderSequence();
    this.resetSequenceDiagnostics();
    this.clearPrewarmedProposal("bot parado");
    // Se já existe um contrato comprado, mantém a reconciliação activa até
    // ele liquidar, mesmo que o utilizador pare o bot. Só cancelamos o poll
    // quando não há contrato pendente.
    if (!this.activeContractId) this.stopContractRecovery();
    useBotStore.getState().setLossCooldown(null);
    if (!this.processing) {
      this.sessionInitialBalance = null;
      this.resetSequenceStrategy();
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
    this.clearPrewarmedProposal("engine destruída");
    this.stopContractRecovery();
  }

  private bindEvents() {
    this.unsubs.push(derivService.on("proposal_open_contract", (data) => this.handleContractUpdate(data)));
    this.unsubs.push(derivService.on("tick_telemetry", (data) => this.handleTick(data)));
  }

  private async enterNextTrade() {
    if (this.destroyed || this.processing || this.entryInFlight) return;
    if (!this.config.isBotRunning || !this.config.isAuthorized || this.config.isBotPaused) return;
    if (!this.config.symbol) return;
    if ((this.config.sequenceStrategyEnabled || this.config.overUnderSequenceStrategyEnabled || this.config.percentageSaturationStrategyEnabled || this.config.percentageAbsenceStrategyEnabled || this.config.parityBlockDensityEnabled || this.config.parityAlternatingEnabled || this.config.parityAnchorEnabled || this.config.matchTwinEnabled || this.config.matchMirrorEnabled) && !this.strategyPendingContract) return;

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

    // A strategy-generated signal is authoritative for the contract family.
    // Advanced Martingale may still control the stake progression, but it must
    // never replace a freshly selected strategy contract (e.g. Match becoming
    // Even/Odd after a loss). When there is no strategy signal, preserve the
    // existing Advanced Martingale contract behavior.
    const strategySelectedContract = this.strategyPendingContract !== null;
    const contract = strategySelectedContract
      ? this.strategyPendingContract
      : advancedActive
        ? this.config.advancedMartingaleContract
        : this.config.contract;
    const targetDigit = strategySelectedContract
      ? (this.strategyPendingTargetDigit ?? this.resolveTargetDigit())
      : advancedActive
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
      const duration = Math.max(1, Math.min(100, Math.round(this.config.contractDurationTicks || DEFAULT_DIGITS_DURATION)));
      const prepared = this.takeValidPrewarmedProposal(contract, stake, duration, targetDigit);
      let proposal: any;
      if (prepared) {
        proposal = prepared.proposal;
        logger.telemetry(`[ENTRY] Proposal prewarm utilizada | ${contract} | stake=${stake} | duration=${duration} | age=${Date.now() - prepared.preparedAt}ms`);
      } else {
        const proposalStartedAt = Date.now();
        if (this.config.sequenceStrategyEnabled || this.config.parityBlockDensityEnabled || this.config.parityAlternatingEnabled || this.config.parityAnchorEnabled || this.config.percentageSaturationStrategyEnabled || this.config.percentageAbsenceStrategyEnabled || this.config.matchTwinEnabled || this.config.matchMirrorEnabled) logger.telemetry(`[ENTRY] Proposal pedido iniciado | +${proposalStartedAt - (this.lastDiagnosticReceivedAt ?? proposalStartedAt)}ms desde último tick recebido`);
        proposal = await derivService.getDigitsProposal(this.config.symbol, contract, stake, duration, targetDigit);
        const proposalReceivedAt = Date.now();
        if (this.config.sequenceStrategyEnabled || this.config.parityBlockDensityEnabled || this.config.parityAlternatingEnabled || this.config.parityAnchorEnabled || this.config.percentageSaturationStrategyEnabled || this.config.percentageAbsenceStrategyEnabled || this.config.matchTwinEnabled || this.config.matchMirrorEnabled) logger.telemetry(`[ENTRY] Proposal resposta | ${proposalReceivedAt - proposalStartedAt}ms após pedido | ID ${String(proposal?.id ?? "—")}`);
      }

      if (!this.config.isBotRunning || this.config.isBotPaused || this.destroyed) {
        this.entryInFlight = false;
        this.setRuntime({ isProcessing: false });
        return;
      }

      const proposalId = String(proposal?.id ?? "");
      const askPrice = Number(proposal?.ask_price);
      if (!proposalId || !Number.isFinite(askPrice) || askPrice <= 0) {
        throw new Error("Proposal Digits inválida: ID ou ask_price ausente.");
      }

      const buyStartedAt = Date.now();
      if (this.config.sequenceStrategyEnabled) logger.telemetry(`[ENTRY] BUY pedido iniciado | +${buyStartedAt - (this.lastDiagnosticReceivedAt ?? buyStartedAt)}ms desde último tick recebido`);
      const buy = await derivService.buyProposal(proposalId, askPrice);
      const buyReceivedAt = Date.now();
      if (this.config.sequenceStrategyEnabled) {
        const purchaseTimeMs = Number.isFinite(Number(buy.purchaseTime)) ? Number(buy.purchaseTime) * 1000 : null;
        const serverPurchaseDelta = purchaseTimeMs !== null ? buyReceivedAt - purchaseTimeMs : null;
        logger.telemetry(`[ENTRY] BUY resposta | ${buyReceivedAt - buyStartedAt}ms após envio | ID ${buy.contractId} | purchase_time=${buy.purchaseTime ?? "—"}${serverPurchaseDelta !== null ? ` | Δcliente-Deriv ${Math.round(serverPurchaseDelta)}ms` : ""}`);
      }
      this.strategyPendingContract = null;
      this.strategyPendingTargetDigit = null;
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
      this.startContractRecovery(buy.contractId);

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
      this.strategyPendingContract = this.strategyPendingContract ?? null;
      this.entryInFlight = false;
      this.processing = false;
      this.setRuntime({ isProcessing: false, activeContractId: null, error: error?.message || "Falha ao executar Digits." });
      logger.error(`Digits V1: ${error?.message || error}`);
    }
  }

  private handleContractUpdate(data: any) {
    const contract = data?.proposal_open_contract;
    if (!contract) return;
    const incomingContractId = String(contract.contract_id ?? "");
    if (incomingContractId && incomingContractId === this.activeContractId && data?.subscription?.id) {
      this.activeSubscriptionId = String(data.subscription.id);
    }
    if (!contract.is_sold) return;
    const contractId = String(contract.contract_id ?? "");
    if (!contractId || contractId !== this.activeContractId || contractId === this.lastProcessedContractId) return;

    this.stopContractRecovery();
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

    // Evaluate TP/SL immediately from realized session P&L before allowing
    // another entry. This avoids waiting for the account-balance subscription.
    this.checkSessionLimits();
    if (this.limitTriggered) {
      this.activeTargetDigit = null;
      this.activeContractType = null;
      this.activeUsedAdvancedMartingale = false;
      return;
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
      if (this.config.sequenceStrategyEnabled || this.config.overUnderSequenceStrategyEnabled) {
        this.resetSequenceStrategy();
        this.resetOverUnderSequence();
        return;
      }
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

  private handleTick(data: any) {
    if (this.destroyed || !this.config.isBotRunning || !this.config.isAuthorized || (!this.config.sequenceStrategyEnabled && !this.config.overUnderSequenceStrategyEnabled && !this.config.percentageSaturationStrategyEnabled && !this.config.percentageAbsenceStrategyEnabled && !this.config.parityBlockDensityEnabled && !this.config.parityAlternatingEnabled && !this.config.parityAnchorEnabled && !this.config.matchTwinEnabled && !this.config.matchMirrorEnabled)) return;
    const tick = data?.tick;
    if (!tick) return;
    const symbol = String(tick.symbol ?? "");
    if (symbol !== this.config.symbol) return;
    const digit = this.extractTickLastDigit(tick);
    if (digit === null) return;

    const epoch = Number(tick.epoch);
    const receivedAt = Number(data?._xoneTransport?.socketReceivedAt) || Date.now();
    const parsedAt = Number(data?._xoneTransport?.parsedAt) || receivedAt;
    const parseMs = Math.max(0, parsedAt - receivedAt);
    const serverGapMs = this.lastDiagnosticEpoch !== null && Number.isFinite(epoch)
      ? (epoch - this.lastDiagnosticEpoch) * 1000
      : null;
    const localGapMs = this.lastDiagnosticReceivedAt !== null
      ? receivedAt - this.lastDiagnosticReceivedAt
      : null;
    const driftMs = serverGapMs !== null && localGapMs !== null
      ? localGapMs - serverGapMs
      : null;
    const ordering = this.lastDiagnosticEpoch !== null && Number.isFinite(epoch)
      ? epoch === this.lastDiagnosticEpoch
        ? "DUPLICADO"
        : epoch < this.lastDiagnosticEpoch
          ? "FORA_DE_ORDEM"
          : ""
      : "";

    this.diagnosticTickCount += 1;
    this.lastDiagnosticEpoch = Number.isFinite(epoch) ? epoch : this.lastDiagnosticEpoch;
    this.lastDiagnosticReceivedAt = receivedAt;

    const formatDelta = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${Math.round(value)}ms`;
    logger.telemetry(
      `[WS TICK #${this.diagnosticTickCount}] ${this.config.symbol} | dígito ${digit} | epoch ${Number.isFinite(epoch) ? epoch : "—"} | ΔDeriv ${formatDelta(serverGapMs)} | Δlocal ${formatDelta(localGapMs)} | drift ${formatDelta(driftMs)} | parse ${parseMs}ms${ordering ? ` | ${ordering}` : ""}`
    );

    if (this.config.isBotPaused) {
      logger.telemetry(`[WS TICK #${this.diagnosticTickCount}] operação pausada | tick observado, sem entrada.`);
      return;
    }

    // The strategy is an entry gate. It only observes ticks while no contract
    // is open and never uses historical ticks, so the configured sequence
    // starts from the moment the bot is started. We still log ticks while a
    // proposal/buy is in flight so a late entry can be diagnosed afterwards.
    if (this.processing || this.entryInFlight || this.strategyEntryInFlight) {
      logger.telemetry(`[WS TICK #${this.diagnosticTickCount}] ignorado pela estratégia | entrada/contrato em processamento.`);
      return;
    }

    // Match-specific strategies use only live ticks from the current session.
    this.liveMatchDigits.push(digit);
    if (this.liveMatchDigits.length > 1000) this.liveMatchDigits.shift();

    // Twin-Splitting: detect X,X, rest exactly N ticks, then trigger Match X.
    if (this.config.matchTwinEnabled) {
      if (this.twinTargetDigit !== null) {
        const advanced = advanceTwinSplittingState(
          { targetDigit: this.twinTargetDigit, remaining: this.twinRemainingTicks },
          this.config.matchTwinRestTicks,
        );
        this.twinTargetDigit = advanced.state.targetDigit;
        this.twinRemainingTicks = advanced.state.remaining;
        if (advanced.signal) {
          this.matchProbabilitySignalKey = `twin-splitting:${advanced.signal.targetDigit}`;
          const decisionAt = Date.now();
          this.strategyPendingContract = "DIGITMATCH";
          this.strategyPendingTargetDigit = advanced.signal.targetDigit;
          logger.signal(`Digit Match probabilístico | ${advanced.signal.reason} | trigger tick #${this.diagnosticTickCount} | decisão +${Math.max(0, decisionAt - receivedAt)}ms após recepção`);
          this.maybePrewarmPercentageProposal("DIGITMATCH", advanced.signal.targetDigit);
          this.strategyEntryInFlight = true;
          void this.enterNextTrade().finally(() => { this.strategyEntryInFlight = false; });
          this.lastLiveMatchDigit = digit;
          return;
        }
      } else if (this.lastLiveMatchDigit !== null && this.lastLiveMatchDigit === digit) {
        this.twinTargetDigit = digit;
        this.twinRemainingTicks = Math.max(0, Math.round(this.config.matchTwinRestTicks));
        logger.telemetry(`[MATCH-TWIN] gémeo ${digit} detectado | descanso ${this.twinRemainingTicks} ticks`);
      }
    }

    // Mirror-Symmetry is a Match-specific live-window strategy. The existing
    // percentage absence strategy remains the audited Statistical Vacuum.
    if (this.config.matchMirrorEnabled) {
      const mirror = findMirrorSymmetrySignal(this.liveMatchDigits, this.config.matchMirrorWindow, this.config.matchMirrorDominance);
      if (!mirror) this.matchProbabilitySignalKey = null;
      else if (this.matchProbabilitySignalKey !== `${mirror.name}:${mirror.targetDigit}`) {
        this.matchProbabilitySignalKey = `${mirror.name}:${mirror.targetDigit}`;
        const decisionAt = Date.now();
        this.strategyPendingContract = "DIGITMATCH";
        this.strategyPendingTargetDigit = mirror.targetDigit;
        logger.signal(`Digit Match probabilístico | ${mirror.reason} | trigger tick #${this.diagnosticTickCount} | decisão +${Math.max(0, decisionAt - receivedAt)}ms após recepção`);
        this.maybePrewarmPercentageProposal("DIGITMATCH", mirror.targetDigit);
        this.strategyEntryInFlight = true;
        void this.enterNextTrade().finally(() => { this.strategyEntryInFlight = false; });
        this.lastLiveMatchDigit = digit;
        return;
      }
    }

    this.lastLiveMatchDigit = digit;
    if (this.config.overUnderSequenceStrategyEnabled) {
      const result = consumeOverUnderSequence(this.overUnderSequenceState, digit, {
        sequenceLength: this.config.overUnderSequenceLength,
        overBarrier: this.config.overUnderOverBarrier,
        underBarrier: this.config.overUnderUnderBarrier,
      });
      this.overUnderSequenceState = result.state;
      const label = result.state.group === "high" ? "alto" : result.state.group === "low" ? "baixo" : "neutro";
      logger.telemetry(`[SEQUENCE O/U] tick #${this.diagnosticTickCount} | ${label} ${result.state.count}/${this.config.overUnderSequenceLength}${result.triggerContract ? ` | TRIGGER → ${result.triggerContract === "DIGITUNDER" ? "Under" : "Over"} ${result.triggerTargetDigit}` : ""}`);
      if (!result.triggerContract) {
        this.maybePrewarmOverUnderProposal(result.state);
        return;
      }
      const decisionAt = Date.now();
      this.strategyPendingContract = result.triggerContract;
      this.strategyPendingTargetDigit = result.triggerTargetDigit;
      this.strategyEntryInFlight = true;
      logger.signal(`Sequência Over/Under | ${this.config.overUnderSequenceLength} ${result.state.group === "high" ? "altos" : "baixos"} consecutivos | entrada ${result.triggerContract === "DIGITUNDER" ? "Under" : "Over"} ${result.triggerTargetDigit} | trigger tick #${this.diagnosticTickCount} | decisão +${Math.max(0, decisionAt - receivedAt)}ms após recepção`);
      void this.enterNextTrade().finally(() => { this.strategyEntryInFlight = false; });
      return;
    }

    if (this.config.parityBlockDensityEnabled || this.config.parityAlternatingEnabled || this.config.parityAnchorEnabled) {
      const marketTicks = useMarketStore.getState().ticks;
      const latestMarketTick = marketTicks[marketTicks.length - 1];
      const currentEpoch = Number(tick.epoch);
      const statsTicks = Number.isFinite(currentEpoch) && latestMarketTick?.time !== currentEpoch
        ? [...marketTicks, { time: currentEpoch, price: Number(tick.quote), pipSize: Number.isInteger(Number(tick.pip_size)) ? Number(tick.pip_size) : undefined }]
        : marketTicks;
      const digits = statsTicks.map((item) => extractLastDigitFromTick(item)).filter((value): value is number => value != null);
      const signal = this.config.parityBlockDensityEnabled
        ? findBlockDensitySignal(digits, this.config.parityBlockWindow, this.config.parityBlockThreshold)
        : null;
      const alternating = !signal && this.config.parityAlternatingEnabled
        ? findAlternatingSignal(digits, this.config.parityAlternatingLength)
        : null;
      const anchor = !signal && !alternating && this.config.parityAnchorEnabled
        ? findAnchorSignal(digits)
        : null;
      const chosen = signal ?? alternating ?? anchor;
      if (!chosen) {
        this.parityProbabilitySignalKey = null;
      } else {
        const key = `${chosen.name}:${chosen.entryContract}`;
        logger.telemetry(`[PARITY-PROB] tick #${this.diagnosticTickCount} | ${chosen.name} | ${chosen.reason}`);
        if (this.parityProbabilitySignalKey !== key) {
          this.parityProbabilitySignalKey = key;
          const decisionAt = Date.now();
          this.strategyPendingContract = chosen.entryContract;
          this.strategyPendingTargetDigit = null;
          logger.signal(`Par/Ímpar probabilístico | ${chosen.name} | ${chosen.reason} | entrada ${chosen.entryContract === "DIGITEVEN" ? "Par" : "Ímpar"} | trigger tick #${this.diagnosticTickCount} | decisão +${Math.max(0, decisionAt - receivedAt)}ms após recepção`);
          this.maybePrewarmParityProposal(chosen.entryContract);
          this.strategyEntryInFlight = true;
          void this.enterNextTrade().finally(() => { this.strategyEntryInFlight = false; });
        }
      }
      if (chosen) return;
    }

    if (this.config.percentageSaturationStrategyEnabled || this.config.percentageAbsenceStrategyEnabled) {
      const marketTicks = useMarketStore.getState().ticks;
      const latestMarketTick = marketTicks[marketTicks.length - 1];
      const currentEpoch = Number(tick.epoch);
      const statsTicks = Number.isFinite(currentEpoch) && latestMarketTick?.time !== currentEpoch
        ? [...marketTicks, { time: currentEpoch, price: Number(tick.quote), pipSize: Number.isInteger(Number(tick.pip_size)) ? Number(tick.pip_size) : undefined }]
        : marketTicks;
      const distribution = calculateDigitPercentageStats(statsTicks, this.config.percentageWindow);
      const signal = this.config.percentageSaturationStrategyEnabled
        ? findSaturationSignal(distribution.stats, this.config.percentageSaturationThreshold)
        : null;
      const absenceSignal = this.config.percentageAbsenceStrategyEnabled
        ? findAbsenceSignal(distribution.stats, this.config.percentageAbsenceStreak)
        : null;
      const chosen = signal ?? absenceSignal;
      if (!chosen) {
        this.percentageSignalKey = null;
      } else {
        const key = `${chosen.contract}:${chosen.targetDigit}`;
        logger.telemetry(`[PERCENTAGE] tick #${this.diagnosticTickCount} | ${chosen.contract} alvo ${chosen.targetDigit} | ${chosen.reason}`);
        if (this.percentageSignalKey !== key) {
          this.percentageSignalKey = key;
          const decisionAt = Date.now();
          this.strategyPendingContract = chosen.contract;
          this.strategyPendingTargetDigit = chosen.targetDigit;
          logger.signal(`Distribuição percentual | ${chosen.reason} | entrada ${chosen.contract === "DIGITDIFF" ? "Differs" : "Match"} ${chosen.targetDigit} | trigger tick #${this.diagnosticTickCount} | decisão +${Math.max(0, decisionAt - receivedAt)}ms após recepção`);
          this.maybePrewarmPercentageProposal(chosen.contract, chosen.targetDigit);
          this.strategyEntryInFlight = true;
          void this.enterNextTrade().finally(() => { this.strategyEntryInFlight = false; });
        }
      }
      return;
    }

    // Sequence Par/Ímpar is an explicit strategy, never a fallback. If it is
    // disabled, the tick must stop here instead of falling through into the
    // sequence state machine after another strategy declined to signal.
    if (!this.config.sequenceStrategyEnabled) return;

    const result = consumeDigitsSequence(this.sequenceState, digit, {
      mode: this.config.sequenceStrategyMode, sequenceLength: this.config.sequenceLength,
      entryContract: this.config.contract === "DIGITODD" ? "DIGITODD" : "DIGITEVEN",
    });
    this.sequenceState = result.state;
    const sequenceCountForLog = result.triggerContract ? this.config.sequenceLength : result.state.count;
    logger.telemetry(`[SEQUENCE] tick #${this.diagnosticTickCount} | ${result.state.parity ?? "—"} ${sequenceCountForLog}/${this.config.sequenceLength}${result.triggerContract ? ` | TRIGGER → ${result.triggerContract === "DIGITEVEN" ? "Par" : "Ímpar"}` : ""}`);
    if (!result.triggerContract) { this.maybePrewarmProposal(result.state); return; }
    const decisionAt = Date.now();
    this.strategyPendingContract = result.triggerContract;
    this.strategyPendingTargetDigit = null;
    this.strategyEntryInFlight = true;
    logger.signal(`Sequência Par/Ímpar | ${this.config.sequenceLength} ${digit % 2 === 0 ? "pares" : "ímpares"} consecutivos | entrada ${result.triggerContract === "DIGITEVEN" ? "Par" : "Ímpar"} | trigger tick #${this.diagnosticTickCount} | decisão +${Math.max(0, decisionAt - receivedAt)}ms após recepção`);
    void this.enterNextTrade().finally(() => { this.strategyEntryInFlight = false; });
  }

  private resetSequenceStrategy() {
    this.sequenceState = INITIAL_DIGITS_SEQUENCE_STATE;
    this.strategyPendingContract = null;
    this.strategyPendingTargetDigit = null;
    this.strategyEntryInFlight = false;
    this.percentageSignalKey = null;
    this.parityProbabilitySignalKey = null;
    this.matchProbabilitySignalKey = null;
    this.liveMatchDigits = [];
    this.lastLiveMatchDigit = null;
    this.twinTargetDigit = null;
    this.twinRemainingTicks = 0;
  }

  private resetOverUnderSequence() {
    this.overUnderSequenceState = INITIAL_DIGITS_OVER_UNDER_SEQUENCE_STATE;
  }

  private resetSequenceDiagnostics() {
    this.diagnosticTickCount = 0;
    this.lastDiagnosticEpoch = null;
    this.lastDiagnosticReceivedAt = null;
  }

  private checkSessionLimits() {
    if (!this.config.isBotRunning || this.sessionInitialBalance === null) return;
    // Session limits are based on the session P&L ledger, not the account
    // balance. Balance updates are transport/UI data and can arrive after a
    // contract settles; the session store records the exact realized profit
    // or loss of each Digits contract.
    const sessionPnl = useSessionStore.getState().pnl;

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

  /**
   * Starts a lightweight reconciliation loop after BUY. It does not create
   * entries and never changes strategy timing; it only repairs the case where
   * the final `is_sold` event was not delivered to the engine.
   */
  private startContractRecovery(contractId: string) {
    this.stopContractRecovery();
    this.contractRecoveryStartedAt = Date.now();

    const poll = async () => {
      if (this.destroyed || this.lastProcessedContractId === contractId || this.activeContractId !== contractId) {
        this.stopContractRecovery();
        return;
      }

      const elapsed = Date.now() - (this.contractRecoveryStartedAt ?? Date.now());
      if (elapsed >= 30000) {
        logger.error(`Digits V1: reconciliação do contrato ${contractId} excedeu 30s; mantém-se Pendente para evitar inventar resultado.`);
        this.stopContractRecovery();
        return;
      }

      try {
        const snapshot = await derivService.getOpenContract(contractId);
        if (snapshot?.is_sold) {
          logger.telemetry(`[ENTRY] Reconciliação encontrou resultado | ID ${contractId}`);
          this.handleContractUpdate({ proposal_open_contract: snapshot });
          return;
        }
      } catch (error: any) {
        logger.telemetry(`[ENTRY] Reconciliação contrato ${contractId} falhou | ${error?.message || error}`);
      }

      if (!this.destroyed && this.activeContractId === contractId && this.lastProcessedContractId !== contractId) {
        this.contractRecoveryTimer = window.setTimeout(() => { void poll(); }, 1500);
      }
    };

    this.contractRecoveryTimer = window.setTimeout(() => { void poll(); }, 1200);
  }

  private stopContractRecovery() {
    if (this.contractRecoveryTimer !== null) {
      window.clearTimeout(this.contractRecoveryTimer);
      this.contractRecoveryTimer = null;
    }
    this.contractRecoveryStartedAt = null;
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
    return extractLastDigit(value);
  }

  private extractTickLastDigit(tick: any): number | null {
    return extractLastDigitFromTick({ price: Number(tick?.quote), pipSize: Number.isInteger(Number(tick?.pip_size)) ? Number(tick.pip_size) : undefined });
  }

  private maybePrewarmPercentageProposal(contract: "DIGITDIFF" | "DIGITMATCH", targetDigit: number) {
    if (this.processing || this.entryInFlight || this.config.isBotPaused) return;
    const stake = this.risk.currentStake;
    const duration = Math.max(1, Math.min(100, Math.round(this.config.contractDurationTicks || DEFAULT_DIGITS_DURATION)));
    const cached = this.prewarmedProposals.get(contract);
    if (cached && cached.stake === stake && cached.duration === duration && cached.targetDigit === targetDigit && Date.now() - cached.preparedAt <= PREWARM_REFRESH_AGE_MS) return;
    if (cached) this.prewarmedProposals.delete(contract);
    if (this.prewarmInFlightContracts.has(contract)) return;
    this.prewarmInFlightContracts.add(contract);
    const startedAt = Date.now();
    logger.telemetry(`[ENTRY] Proposal prewarm percentual iniciado | ${contract} ${targetDigit} | stake=${stake} | duration=${duration}`);
    void derivService.getDigitsProposal(this.config.symbol, contract, stake, duration, targetDigit)
      .then((proposal) => {
        if (!this.config.isBotRunning || this.config.isBotPaused || this.destroyed) return;
        const id = String(proposal?.id ?? ""); const askPrice = Number(proposal?.ask_price);
        if (!id || !Number.isFinite(askPrice) || askPrice <= 0 || this.risk.currentStake !== stake) return;
        this.prewarmedProposals.set(contract, { proposal, contract, stake, duration, targetDigit, preparedAt: Date.now() });
        logger.telemetry(`[ENTRY] Proposal prewarm percentual pronta | ${contract} ${targetDigit} | ID ${id} | ${Date.now() - startedAt}ms`);
      })
      .catch((error) => logger.telemetry(`[ENTRY] Proposal prewarm percentual descartada | ${contract} ${targetDigit} | ${error?.message || error}`))
      .finally(() => this.prewarmInFlightContracts.delete(contract));
  }

  private maybePrewarmParityProposal(contract: "DIGITEVEN" | "DIGITODD") {
    if (this.processing || this.entryInFlight || this.strategyEntryInFlight || this.config.isBotPaused) return;
    const stake = this.risk.currentStake;
    const duration = Math.max(1, Math.min(100, Math.round(this.config.contractDurationTicks || DEFAULT_DIGITS_DURATION)));
    if (!Number.isFinite(stake) || stake < MIN_STAKE) return;
    const cached = this.prewarmedProposals.get(contract);
    if (cached && cached.stake === stake && cached.duration === duration && Date.now() - cached.preparedAt <= PREWARM_REFRESH_AGE_MS) return;
    if (cached) this.prewarmedProposals.delete(contract);
    if (this.prewarmInFlightContracts.has(contract)) return;
    this.prewarmInFlightContracts.add(contract);
    const preparedAt = Date.now();
    logger.telemetry(`[ENTRY] Proposal prewarm Par/Ímpar iniciada | ${contract} | stake=${stake} | duration=${duration}`);
    void derivService.getDigitsProposal(this.config.symbol, contract, stake, duration, 0)
      .then((proposal) => {
        if (!this.config.isBotRunning || this.config.isBotPaused || this.destroyed || this.risk.currentStake !== stake) return;
        const id = String(proposal?.id ?? ""); const askPrice = Number(proposal?.ask_price);
        if (!id || !Number.isFinite(askPrice) || askPrice <= 0) return;
        this.prewarmedProposals.set(contract, { proposal, contract, stake, duration, targetDigit: null, preparedAt: Date.now() });
        logger.telemetry(`[ENTRY] Proposal prewarm Par/Ímpar pronta | ${contract} | ID ${id} | ${Date.now() - preparedAt}ms`);
      })
      .catch((error) => logger.telemetry(`[ENTRY] Proposal prewarm Par/Ímpar descartada | ${contract} | ${error?.message || error}`))
      .finally(() => this.prewarmInFlightContracts.delete(contract));
  }

  private maybePrewarmProposal(state: DigitsSequenceState) {
    if (!this.config.sequenceStrategyEnabled || this.processing || this.entryInFlight || this.strategyEntryInFlight) return;
    if (!state.parity) return;

    // Prewarm the contract that can be bought when the sequence completes.
    // This is deliberately independent of the current sequence count/parity
    // snapshot: the final trigger tick resets the sequence state to null, but
    // the prepared contract is still exactly the one the trigger needs.
    const contract: DigitsContractType = this.config.sequenceStrategyMode === "multiple"
      ? state.parity === "even" ? "DIGITODD" : "DIGITEVEN"
      : this.config.contract;
    const stake = this.risk.currentStake;
    const duration = Math.max(1, Math.min(100, Math.round(this.config.contractDurationTicks || DEFAULT_DIGITS_DURATION)));
    const targetDigit = digitsContractNeedsDigit(contract) ? this.resolveTargetDigit() : 0;
    if (!Number.isFinite(stake) || stake < MIN_STAKE) return;
    if (!this.isPrewarmConfigStillValid(contract, stake, duration, targetDigit)) return;

    const cached = this.prewarmedProposals.get(contract);
    if (cached) {
      const ageMs = Date.now() - cached.preparedAt;
      const targetMatches = !digitsContractNeedsDigit(contract) || cached.targetDigit === targetDigit;
      const cacheMatches = cached.contract === contract
        && cached.stake === stake
        && cached.duration === duration
        && targetMatches;

      if (!cacheMatches) {
        this.prewarmedProposals.delete(contract);
        logger.telemetry(`[ENTRY] Proposal prewarm descartada | contexto alterado | ${contract}`);
      } else if (ageMs <= PREWARM_REFRESH_AGE_MS) {
        return;
      } else if (ageMs > PREWARM_MAX_AGE_MS) {
        this.prewarmedProposals.delete(contract);
        logger.telemetry(`[ENTRY] Proposal prewarm descartada | expirada (${ageMs}ms) | ${contract}`);
      }
      // If the cached proposal is still inside the max-age window, keep it
      // usable while a background refresh is requested. This avoids turning
      // refresh latency into entry latency.
    }

    if (this.prewarmInFlightContracts.has(contract)) return;

    this.prewarmInFlightContracts.add(contract);
    const preparedAt = Date.now();
    logger.telemetry(`[ENTRY] Proposal prewarm iniciado | ${contract} | stake=${stake} | duration=${duration} | seq=${state.count}/${this.config.sequenceLength}`);
    void derivService.getDigitsProposal(this.config.symbol, contract, stake, duration, targetDigit)
      .then((proposal) => {
        if (!this.config.isBotRunning || this.destroyed || this.processing || this.entryInFlight || !this.isPrewarmConfigStillValid(contract, stake, duration, targetDigit)) {
          logger.telemetry(`[ENTRY] Proposal prewarm descartada | configuração mudou ou bot parou | ${contract}`);
          return;
        }
        const id = String(proposal?.id ?? "");
        const askPrice = Number(proposal?.ask_price);
        if (!id || !Number.isFinite(askPrice) || askPrice <= 0) {
          logger.telemetry(`[ENTRY] Proposal prewarm descartada | resposta inválida | ${contract}`);
          return;
        }
        this.prewarmedProposals.set(contract, {
          proposal,
          contract,
          stake,
          duration,
          targetDigit: digitsContractNeedsDigit(contract) ? targetDigit : null,
          preparedAt: Date.now(),
        });
        logger.telemetry(`[ENTRY] Proposal prewarm pronta | ${contract} | ID ${id} | ${Date.now() - preparedAt}ms`);
      })
      .catch((error) => logger.telemetry(`[ENTRY] Proposal prewarm descartada | ${contract} | ${error?.message || error}`))
      .finally(() => { this.prewarmInFlightContracts.delete(contract); });
  }

  private maybePrewarmOverUnderProposal(state: DigitsOverUnderSequenceState) {
    if (!this.config.overUnderSequenceStrategyEnabled || this.config.isBotPaused || this.processing || this.entryInFlight || this.strategyEntryInFlight) return;
    if (!state.group) return;
    const contract: DigitsContractType = state.group === "high" ? "DIGITUNDER" : "DIGITOVER";
    const targetDigit = state.group === "high" ? Math.max(0, Math.min(9, Math.round(this.config.overUnderUnderBarrier))) : Math.max(0, Math.min(9, Math.round(this.config.overUnderOverBarrier)));
    const stake = this.risk.currentStake;
    const duration = Math.max(1, Math.min(100, Math.round(this.config.contractDurationTicks || DEFAULT_DIGITS_DURATION)));
    if (!Number.isFinite(stake) || stake < MIN_STAKE) return;
    const cached = this.prewarmedProposals.get(contract);
    if (cached) {
      const ageMs = Date.now() - cached.preparedAt;
      if (cached.stake === stake && cached.duration === duration && cached.targetDigit === targetDigit && ageMs <= PREWARM_REFRESH_AGE_MS) return;
      if (ageMs > PREWARM_MAX_AGE_MS || cached.targetDigit !== targetDigit || cached.stake !== stake || cached.duration !== duration) {
        this.prewarmedProposals.delete(contract);
        logger.telemetry(`[ENTRY] Proposal prewarm descartada | contexto O/U alterado/expirado | ${contract} ${targetDigit}`);
      }
    }
    if (this.prewarmInFlightContracts.has(contract)) return;
    this.prewarmInFlightContracts.add(contract);
    const preparedAt = Date.now();
    logger.telemetry(`[ENTRY] Proposal prewarm iniciada | ${contract} ${targetDigit} | stake=${stake} | duration=${duration} | seq=${state.count}/${this.config.overUnderSequenceLength}`);
    void derivService.getDigitsProposal(this.config.symbol, contract, stake, duration, targetDigit)
      .then((proposal) => {
        if (!this.config.isBotRunning || this.config.isBotPaused || this.destroyed) return;
        const id = String(proposal?.id ?? ""); const askPrice = Number(proposal?.ask_price);
        if (!id || !Number.isFinite(askPrice) || askPrice <= 0) { logger.telemetry(`[ENTRY] Proposal prewarm O/U descartada | resposta inválida | ${contract} ${targetDigit}`); return; }
        const currentTarget = contract === "DIGITUNDER" ? Math.round(this.config.overUnderUnderBarrier) : Math.round(this.config.overUnderOverBarrier);
        if (currentTarget !== targetDigit || this.risk.currentStake !== stake) { logger.telemetry(`[ENTRY] Proposal prewarm O/U descartada | configuração mudou | ${contract} ${targetDigit}`); return; }
        this.prewarmedProposals.set(contract, { proposal, contract, stake, duration, targetDigit, preparedAt: Date.now() });
        logger.telemetry(`[ENTRY] Proposal prewarm pronta | ${contract} ${targetDigit} | ID ${id} | ${Date.now() - preparedAt}ms`);
      })
      .catch((error) => logger.telemetry(`[ENTRY] Proposal prewarm O/U descartada | ${contract} ${targetDigit} | ${error?.message || error}`))
      .finally(() => this.prewarmInFlightContracts.delete(contract));
  }

  private isPrewarmConfigStillValid(contract: DigitsContractType, stake: number, duration: number, targetDigit: number) {
    const expectedContract = this.config.sequenceStrategyMode === "multiple"
      ? contract
      : this.config.contract;
    return expectedContract === contract
      && Number(this.risk.currentStake) === stake
      && Math.max(1, Math.min(100, Math.round(this.config.contractDurationTicks || DEFAULT_DIGITS_DURATION))) === duration
      && this.config.isBotRunning;
  }

  private takeValidPrewarmedProposal(contract: DigitsContractType, stake: number, duration: number, targetDigit: number) {
    const cached = this.prewarmedProposals.get(contract);
    if (!cached) return null;

    const ageMs = Date.now() - cached.preparedAt;
    const targetMatches = !digitsContractNeedsDigit(contract) || cached.targetDigit === targetDigit;
    const valid = ageMs <= PREWARM_MAX_AGE_MS
      && cached.contract === contract
      && cached.stake === stake
      && cached.duration === duration
      && targetMatches;

    this.prewarmedProposals.delete(contract);
    if (!valid) {
      logger.telemetry(`[ENTRY] Proposal prewarm descartada | inválida/expirada (${ageMs}ms) | ${contract}`);
      return null;
    }
    return cached;
  }

  private clearPrewarmedProposal(reason: string) {
    if (this.prewarmedProposals.size > 0) {
      logger.telemetry(`[ENTRY] Proposal prewarm descartada | ${reason}`);
    }
    this.prewarmedProposals.clear();
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
