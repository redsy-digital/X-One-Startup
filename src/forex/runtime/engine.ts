import type { Candle, StrategyProfile } from "../../types";
import { derivService } from "../../lib/deriv";
import { logger } from "../../lib/logger";
import { ForexFeatureEngineV1 } from "../features";
import { ForexStructureEngineV1 } from "../structure";
import { ForexRegimeEngineV1 } from "../regime";
import { ForexDirectionEngineV1, FOREX_DIRECTION_DEFAULT_CONFIG } from "../direction";
import { ForexExperimentalAtrDirectionV1 } from "../direction/experimental";
import { ForexExperimentalDirectionBridgeV1 } from "../direction/bridge";
import { ForexCalendarServiceImpl } from "../calendar/service";
import { DerivForexCalendarProvider } from "../calendar/deriv";
import { ForexRiskEngineV1 } from "../risk";
import { DEFAULT_FOREX_RISK_CONFIG, type ForexRiskState } from "../risk/types";
import { ForexDecisionEngineV1 } from "../decision-engine";
import { ForexProposalEngineV1 } from "../proposal";
import { ForexExecutionGuardV1 } from "../execution-guard";
import { ForexTradeExecutorV1 } from "../executor";
import type { ForexContractMonitorGateway, ForexContractSnapshot } from "../demo";
import { useForexRuntimeStore } from "../../store/useForexRuntimeStore";
import { useForexRiskStore } from "../../store/useForexRiskStore";
import { getForexSession } from "../session";
import { useMarketStore } from "../../store/useMarketStore";
import { useConnectionStore } from "../../store/useConnectionStore";
import { forexMarketDataService, isWithinSchedule } from "../market-data";
import { saveTrade } from "../../lib/storage";

const SYMBOL = "frxEURUSD";
const DURATION_MINUTES = 15;
const CALENDAR_PROVIDER = new DerivForexCalendarProvider(derivService);
const CALENDAR = new ForexCalendarServiceImpl(CALENDAR_PROVIDER);

class DerivContractMonitor implements ForexContractMonitorGateway {
  private listeners = new Set<(snapshot: ForexContractSnapshot) => void>();
  private active: string | null = null;
  private unsubscribe: (() => void) | null = null;

  subscribeContract(contractId: string): void {
    this.active = contractId;
    derivService.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
  }

  onContractUpdate(listener: (snapshot: ForexContractSnapshot) => void): () => void {
    this.listeners.add(listener);
    if (!this.unsubscribe) {
      this.unsubscribe = derivService.on("proposal_open_contract", (data: any) => {
        const raw = data?.proposal_open_contract;
        if (!raw) return;
        const id = String(raw.contract_id ?? "");
        if (!id || id !== this.active) return;
        const snapshot: ForexContractSnapshot = {
          contractId: id,
          status: raw.is_sold ? (Number(raw.profit ?? 0) >= 0 ? "WON" : "LOST") : "OPEN",
          isSold: Boolean(raw.is_sold),
          contractType: raw.contract_type,
          buyPrice: finite(raw.buy_price),
          payout: finite(raw.payout),
          profit: finite(raw.profit),
          entryPrice: finite(raw.entry_tick),
          exitPrice: finite(raw.exit_tick),
          dateStart: finite(raw.date_start),
          dateExpiry: finite(raw.date_expiry),
          raw,
        };
        for (const cb of this.listeners) cb(snapshot);
      });
    }
    return () => this.listeners.delete(listener);
  }

  get hasActiveContract(): boolean {
    return this.active !== null;
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.active) derivService.send({ forget: this.active });
    this.active = null;
    this.listeners.clear();
  }
}

function finite(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export class ForexRuntimeIntegrationV1 {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastCandleTime = 0;
  private riskState: ForexRiskState = {
    sessionPnl: 0, dailyPnl: 0, consecutiveLosses: 0, tradesThisSession: 0, openPositions: 0,
  };
  private readonly monitor = new DerivContractMonitor();
  private readonly executor = new ForexTradeExecutorV1(derivService);
  private readonly decision = new ForexDecisionEngineV1();
  private readonly proposal = new ForexProposalEngineV1(derivService);
  private readonly guard = new ForexExecutionGuardV1();
  private readonly experimentalDirection = new ForexExperimentalAtrDirectionV1();
  private readonly experimentalBridge = new ForexExperimentalDirectionBridgeV1();

  start() {
    if (this.running) return;
    this.running = true;
    this.lastCandleTime = 0;
    const store = useForexRuntimeStore.getState();
    store.patch({ stage: "SCANNING", message: "Runtime Forex activo: a aguardar avaliação real.", lastError: null, executionEnabled: true });
    logger.system("[Forex Runtime] D19 Runtime Integration iniciado.");
    this.timer = setInterval(() => void this.evaluate(), 5000);
    void this.evaluate();
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Stop bloqueia novas avaliações/entradas, mas não abandona um contrato já aberto.
    // O monitor continua ativo para que o resultado Demo seja reconciliado.
    if (!this.monitor.hasActiveContract) {
      this.monitor.dispose();
      this.riskState.openPositions = 0;
    }
    const current = useForexRuntimeStore.getState();
    useForexRuntimeStore.getState().patch({
      stage: current.activeContract ? "OPEN" : "STOPPED",
      message: current.activeContract
        ? "Bot parado para novas entradas; contrato ativo continua a ser monitorado."
        : "Bot parado. Sem novas avaliações.",
      executionEnabled: false,
      activeContract: current.activeContract,
    });
    logger.system("[Forex Runtime] D19 Runtime Integration parado.");
  }

  async evaluate() {
    if (!this.running) return;
    const state = useForexRuntimeStore.getState();
    const now = Math.floor(Date.now() / 1000);
    const market = useMarketSnapshot();
    if (!market) {
      state.patch({ stage: "WAIT_DATA", message: "A aguardar candles Forex.", lastEvaluationAt: now, evaluations: state.evaluations + 1 });
      return;
    }

    // Evaluate only on a new completed/current candle to avoid spamming Proposal.
    if (market.candles.length < 60) {
      state.patch({ stage: "WAIT_DATA", message: `Dados insuficientes: ${market.candles.length}/60 candles.`, lastEvaluationAt: now, evaluations: state.evaluations + 1 });
      return;
    }

    const last = market.candles.at(-1)!;
    if (last.time === this.lastCandleTime) {
      // Still refresh an active contract.
      return;
    }
    this.lastCandleTime = last.time;

    try {
      const info = await derivService.getActiveSymbols(["CALL", "PUT"]);
      const meta = info.find((x: any) => x?.underlying_symbol === SYMBOL);
      const schedule = await forexMarketDataService.getTradingSchedule(SYMBOL, "today");
      const open = Boolean(
        meta &&
        Number(meta.exchange_is_open) === 1 &&
        Number(meta.is_trading_suspended) !== 1 &&
        isWithinSchedule(schedule, Date.now()),
      );
      if (!open) {
        state.patch({ stage: "WAIT_MARKET", message: "Mercado Forex fechado/suspenso.", lastEvaluationAt: now, evaluations: state.evaluations + 1 });
        logger.block("[Forex Runtime] Mercado fechado/suspenso.");
        return;
      }

      const timeframeMinutes = Math.max(1, Math.round(market.timeframe / 60));
      const marketContext = {
        market: "forex" as const, symbol: SYMBOL, timeframeMinutes,
        candles: market.candles, serverTime: now, marketOpen: true, dataAsOf: last.time,
      };
      const feature = new ForexFeatureEngineV1().calculate(marketContext);
      const current = last.close;
      const atr = feature.values.atrPct * current;
      const structure = new ForexStructureEngineV1().analyze({ candles: market.candles, timeframeMinutes, atr, calculatedAt: now });
      const regime = new ForexRegimeEngineV1().classify(feature, marketContext, structure, getForexSession(now * 1000));
      const direction = new ForexDirectionEngineV1(FOREX_DIRECTION_DEFAULT_CONFIG).decide(feature, regime, marketContext, structure);
      const experimentalDirection = this.experimentalDirection.decide(market.candles, timeframeMinutes, now);
      const experimentalBridge = this.experimentalBridge.publish(experimentalDirection, timeframeMinutes, now);
      logger.signal(`[Forex Experimental] ATR14-INVERSE | ${experimentalDirection.direction} | percentile=${experimentalDirection.percentile.toFixed(3)} score=${experimentalDirection.score.toFixed(3)} | EXECUTABLE=false`);
      logger.signal(`[Forex Experimental Bridge] ${experimentalBridge.direction} | candidate=${experimentalBridge.candidate} | productionEligible=false | executable=false`);

      const [calendar] = await Promise.all([
        CALENDAR.getSnapshot(["EUR", "USD"], now),
      ]);

          const connection = useConnectionStore.getState();
      const balance = Number(connection.balance ?? 0);
      const riskConfig = useForexRiskStore.getState().config;
      const riskEngine = new ForexRiskEngineV1({ ...DEFAULT_FOREX_RISK_CONFIG, ...riskConfig });
      const risk = riskEngine.evaluate({
        now, stake: riskConfig.maxStakePerTrade, accountBalance: balance,
        symbol: SYMBOL, direction: direction.direction === "NONE" ? "CALL" : direction.direction, calendar,
        state: this.riskState,
      });

      const decision = this.decision.evaluate({
        market: marketContext,
        profile: "balanced" as StrategyProfile,
        features: feature, structure, regime, signal: direction, calendar,
        contract: { candidate: { contractType: direction.direction === "NONE" ? "CALL" : direction.direction, duration: DURATION_MINUTES, durationUnit: "m" } },
        risk,
        now,
      });

      state.patch({
        stage: mapDecisionStage(decision.state), message: decision.reason,
        lastDecision: decision, lastError: null, lastEvaluationAt: now, evaluations: state.evaluations + 1,
        demoVerified: connection.isDemo && connection.isAuthorized,
        experimentalDirection,
        experimentalBridge,
      });
      logger.signal(`[Forex Runtime] ${decision.state} | ${decision.reasonCode} | ${decision.direction} | score=${decision.score.toFixed(3)} conf=${decision.confidence.toFixed(3)}`);

      if (!this.running || decision.state !== "PROPOSAL_CHECK" || decision.direction === "NONE") return;

      const p = await this.proposal.request({
        symbol: SYMBOL, direction: decision.direction, stake: risk.stake,
        durationMinutes: DURATION_MINUTES, currency: connection.activeAccount?.currency ?? derivService.getAccountCurrency(),
      });
      state.patch({ stage: "PROPOSAL", message: p.reason, lastProposal: p.proposal ?? null });
      if (!this.running) return;
      logger.trade(`[Forex Runtime] D15 ${p.code} | ${p.reason}`);
      if (!p.valid || !p.proposal) return;

      const authorization = this.guard.authorize({
        now, decision, proposal: p.proposal, calendar, riskAllowed: risk.allowed,
        state: { botRunning: this.running, connectionOpen: derivService.isSocketOpen(), openPositions: this.riskState.openPositions },
      });
      state.patch({ stage: "GUARD", message: authorization.reason, lastAuthorization: authorization });
      logger.system(`[Forex Runtime] D16 ${authorization.code} | ${authorization.reason}`);
      if (!authorization.authorized) return;
      if (!this.running) return;

      const account = useConnectionStore.getState();
      if (!account.isDemo || !account.isAuthorized || !account.activeAccount?.account_id) {
        state.patch({ stage: "ERROR", message: "D19 bloqueou: conta Demo não está explicitamente verificada.", lastError: "DEMO_ONLY_BLOCK" });
        return;
      }

      state.patch({ stage: "EXECUTING", message: "D16 autorizado; D17 a enviar BUY Demo." });
      this.riskState.openPositions = 1;

      const execution = await this.executor.execute({
        authorization,
        proposal: p.proposal,
        now,
      });

      logger.trade(`[Forex Runtime] D17 ${execution.code} | ${execution.reason}`);
      if (!execution.executed || !execution.contractId) {
        this.riskState.openPositions = 0;
        state.patch({ stage: "ERROR", message: execution.reason, lastError: execution.code });
        return;
      }

      state.patch({
        stage: "OPEN",
        message: `Contrato Demo aberto: ${execution.contractId}`,
        activeContract: {
          contractId: execution.contractId, status: "OPEN", isSold: false,
          contractType: p.proposal.requested.direction,
          buyPrice: execution.buyPrice, payout: execution.payout,
          dateStart: execution.startTime, raw: execution.raw,
        },
      });

      this.monitor.onContractUpdate((snapshot) => {
        const s = useForexRuntimeStore.getState();
        if (snapshot.isSold) {
          this.riskState.openPositions = 0;
          if (snapshot.status === "LOST") this.riskState.consecutiveLosses += 1;
          else if (snapshot.status === "WON") this.riskState.consecutiveLosses = 0;
          this.riskState.tradesThisSession += 1;
          const pnl = snapshot.profit ?? 0;
          this.riskState.sessionPnl += pnl;
          this.riskState.dailyPnl += pnl;
          const decisionSnapshot = useForexRuntimeStore.getState().lastDecision;
          const proposalSnapshot = useForexRuntimeStore.getState().lastProposal;
          saveTrade({
            market: "forex",
            id: snapshot.contractId,
            time: (snapshot.dateStart ?? Math.floor(Date.now() / 1000)) * 1000,
            symbol: SYMBOL,
            type: proposalSnapshot?.requested.direction ?? (decisionSnapshot?.direction === "PUT" ? "PUT" : "CALL"),
            stake: proposalSnapshot?.requested.stake ?? 0.5,
            status: snapshot.status === "WON" ? "WON" : "LOST",
            profit: pnl,
            entryPrice: snapshot.entryPrice ?? snapshot.buyPrice,
            exitPrice: snapshot.exitPrice,
            confidence: decisionSnapshot?.confidence,
            score: decisionSnapshot?.score,
          });
          s.patch({ stage: "CLOSED", message: `Contrato encerrado: ${snapshot.status} | P&L ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`, activeContract: null, lastResult: snapshot });
          logger.trade(`[Forex Runtime] CONTRATO ${snapshot.status} | P&L=${pnl.toFixed(2)} | contract_id=${snapshot.contractId}`);
          this.monitor.dispose();
        } else {
          s.patch({ stage: "OPEN", message: `Contrato ${snapshot.contractId} aberto; a monitorar.`, activeContract: snapshot });
        }
      });
      this.monitor.subscribeContract(execution.contractId);
    } catch (error: any) {
      logger.error(`[Forex Runtime] ${error?.message || error}`);
      state.patch({ stage: "ERROR", message: error?.message || "Erro no runtime Forex.", lastError: error?.message || String(error), lastEvaluationAt: now, evaluations: state.evaluations + 1 });
    }
  }
}

function mapDecisionStage(state: string): any {
  switch (state) {
    case "WAIT_MARKET": return "WAIT_MARKET";
    case "WAIT_DATA": return "WAIT_DATA";
    case "WAIT_SIGNAL": return "WAIT_SIGNAL";
    case "NEWS_BLOCK": return "NEWS_BLOCK";
    case "RISK_BLOCK": return "RISK_BLOCK";
    case "WAIT_CONTRACT": return "WAIT_CONTRACT";
    case "PROPOSAL_CHECK": return "PROPOSAL";
    default: return "SCANNING";
  }
}

function useMarketSnapshot() {
  return useMarketStore.getState();
}

export const forexRuntimeIntegrationV1 = new ForexRuntimeIntegrationV1();
