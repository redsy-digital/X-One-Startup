import React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3,
  Bell, CalendarDays, CheckCircle2, Clock3, Gauge, Info, LockKeyhole,
  Power, RefreshCw, ShieldCheck, SlidersHorizontal, Target, Timer,
  TrendingDown, TrendingUp, Wallet, X, Zap, Wifi, WifiOff,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { NeonCard } from "../components/NeonCard";
import { TradingChart } from "../components/TradingChart";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { cn } from "../lib/utils";
import { derivService } from "../lib/deriv";
import { logger } from "../lib/logger";
import { getTradeHistory } from "../lib/storage";
import type { TradeHistory } from "../types";
import { useConnectionStore, useMarketStore, useForexRiskStore } from "../store";
import { useBotStore } from "../store/useBotStore";
import { useForexRuntimeStore } from "../store/useForexRuntimeStore";
import { ForexFeatureEngineV1 } from "../forex/features";
import { ForexStructureEngineV1 } from "../forex/structure";
import { ForexRegimeEngineV1 } from "../forex/regime";
import { ForexDirectionEngineV1, FOREX_DIRECTION_DEFAULT_CONFIG } from "../forex/direction";
import { ForexExperimentalAtrDirectionV1 } from "../forex/direction/experimental";
import { getForexSession } from "../forex/session";
import { DerivForexCalendarProvider } from "../forex/calendar/deriv";
import { ForexCalendarServiceImpl } from "../forex/calendar/service";
import { extractEvents } from "../forex/calendar/deriv";
import type { ForexCalendarDecision, ForexEconomicEvent, ForexRegime, ForexDirection } from "../forex/decision-engine/types";
import { forexMarketDataService, isWithinSchedule } from "../forex/market-data";

const FOREX_SYMBOL = "frxEURUSD";
const FOREX_NAME = "EUR/USD";
const VALIDATED_DURATIONS = [15, 30, 60, 120];

function fmtPrice(value: number | null, pipSize = 0.00001) {
  if (value == null || !Number.isFinite(value)) return "—";
  const decimals = pipSize >= 0.01 ? 2 : 5;
  return value.toFixed(decimals);
}

function fmtMoney(value: number) {
  return `${value >= 0 ? "+" : "−"}$${Math.abs(value).toFixed(2)}`;
}

function minutesAgo(epochSeconds: number | null) {
  if (!epochSeconds) return "—";
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m`;
}

function stateLabel(state: string) {
  const map: Record<string, string> = {
    SCANNING: "A analisar", WAIT_DATA: "A aguardar dados", WAIT_MARKET: "Mercado fechado",
    WAIT_REGIME: "Regime incompatível", WAIT_SIGNAL: "Sem sinal", NEWS_BLOCK: "Bloqueado por notícias",
    WAIT_CONTRACT: "Sem contrato", RISK_BLOCK: "Risco bloqueado", PROPOSAL_CHECK: "A validar proposta",
    READY: "Pronto", EXECUTING: "A executar", COOLDOWN: "Cooldown", ENGINE_NOT_READY: "Engine em construção",
  };
  return map[state] ?? state;
}

function impactClass(impact: string) {
  if (impact === "critical") return "text-red-300 bg-red-500/10 border-red-500/20";
  if (impact === "high") return "text-orange-300 bg-orange-500/10 border-orange-500/20";
  if (impact === "medium") return "text-amber-300 bg-amber-500/10 border-amber-500/20";
  return "text-slate-300 bg-white/5 border-white/10";
}

function calendarLabel(decision: ForexCalendarDecision | null) {
  if (!decision) return "A consultar";
  if (decision.state === "BLOCK") return "BLOQUEADO";
  if (decision.state === "COOLDOWN") return "RESFRIAMENTO";
  if (decision.state === "WATCH") return "ATENÇÃO";
  if (decision.state === "UNKNOWN") return "DESCONHECIDO";
  return "LIMPO";
}

const RiskModal = ({ onClose }: { onClose: () => void }) => {
  const { config, update, reset } = useForexRiskStore();
  const field = (label: string, key: keyof typeof config, step = "0.01", min = 0) => (
    <label className="space-y-1" key={label}>
      <span className="text-[9px] uppercase tracking-widest font-black text-muted-foreground">{label}</span>
      <Input
        type="number" step={step} min={min} value={config[key] as number}
        onChange={(e) => {
          const value = Number(e.target.value);
          if (Number.isFinite(value)) update({ [key]: Math.max(min, value) } as Partial<typeof config>);
        }}
        className="h-9 bg-black/30 border-white/10 text-xs font-bold"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg rounded-2xl border border-emerald-500/20 bg-[#0d1110] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <p className="flex items-center gap-2 text-sm font-black uppercase tracking-widest"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Gestão de Risco · Forex</p>
            <p className="text-[9px] text-muted-foreground mt-1">Configuração V1 independente do motor de sintéticos.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8"><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto">
          {field("Stake máxima / operação ($)", "maxStakePerTrade", "0.01", 0.01)}
          {field("Posições simultâneas", "maxOpenPositions", "1", 1)}
          {field("Máx. operações / sessão", "maxTradesPerSession", "1", 1)}
          {field("Perda máxima / sessão ($)", "maxSessionLoss", "0.10", 0)}
          {field("Perda máxima diária ($)", "maxDailyLoss", "0.10", 0)}
          {field("Perdas consecutivas", "maxConsecutiveLosses", "1", 1)}
          {field("Cooldown após loss (s)", "cooldownAfterLossSeconds", "1", 0)}
          {field("Intervalo mínimo entre entradas (s)", "minEntryIntervalSeconds", "1", 0)}
          {field("Fracção máxima da conta (0–1)", "maxAccountRiskFraction", "0.001", 0)}
          <div className="col-span-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] text-amber-200/80 leading-relaxed">
            <LockKeyhole className="inline w-3 h-3 mr-1" /> Esta UI grava a configuração localmente. A aplicação do gate ao BUY será ligada ao Risk Engine Forex na D11.
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <Button variant="outline" onClick={reset} className="h-10 text-[10px] font-black uppercase">Restaurar V1</Button>
          <Button onClick={onClose} className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-700 font-black uppercase text-[10px]">Guardar e fechar</Button>
        </div>
      </motion.div>
    </div>
  );
};

export const ForexDashboardPage = () => {
  const { isAuthorized, balance } = useConnectionStore();
  const { market, setMarket, symbol, setSymbol, candles, ticks, timeframe, setTimeframe } = useMarketStore();
  const { config: risk } = useForexRiskStore();
  const { isBotRunning: botRunning, toggleBot } = useBotStore();
  const runtime = useForexRuntimeStore();
  const [showRisk, setShowRisk] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
  const [pipSize, setPipSize] = React.useState(0.00001);
  const [marketOpen, setMarketOpen] = React.useState(false);
  const [scheduleLabel, setScheduleLabel] = React.useState("A consultar");
  const [calendar, setCalendar] = React.useState<ForexCalendarDecision | null>(null);
  const [events, setEvents] = React.useState<ForexEconomicEvent[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [dashboardError, setDashboardError] = React.useState<string | null>(null);
  const [calendarError, setCalendarError] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<TradeHistory[]>([]);
  const connectionHealth = derivService.getConnectionHealth();
  const decisionEngineOperational = runtime.lastDecision !== null;


  const currentPrice = ticks.at(-1)?.price ?? candles.at(-1)?.close ?? null;
  const previousPrice = ticks.at(-2)?.price ?? candles.at(-2)?.close ?? null;
  const priceDirection = currentPrice != null && previousPrice != null ? (currentPrice >= previousPrice ? "UP" : "DOWN") : "UP";
  const session = React.useMemo(() => getForexSession(now), [now]);

  const analysis = React.useMemo(() => {
    if (candles.length < 60) return { feature: null, structure: null, regime: null, direction: null, experimentalDirection: null, error: `Dados insuficientes (${candles.length}/60 candles).` };
    try {
      const marketContext = forexMarketDataService.toDecisionMarketContext({
        symbol: FOREX_SYMBOL,
        timeframeMinutes: Math.max(1, timeframe / 60),
        candles,
        symbolInfo: { underlyingSymbol: FOREX_SYMBOL, name: FOREX_NAME, market: "forex", type: "forex", pipSize, exchangeIsOpen: marketOpen, tradingSuspended: false },
        schedule: null,
        marketOpen,
        dataAsOf: candles.at(-1)?.time ?? null,
        fetchedAt: Math.floor(now / 1000),
      });
      const feature = new ForexFeatureEngineV1().calculate(marketContext);
      const atr = feature.values.atrPct * (currentPrice ?? 1);
      const structure = new ForexStructureEngineV1().analyze({ candles, timeframeMinutes: Math.max(1, timeframe / 60), atr, calculatedAt: Math.floor(now / 1000) });
      const regime = new ForexRegimeEngineV1().classify(feature, marketContext, structure, session);
      const direction = new ForexDirectionEngineV1(FOREX_DIRECTION_DEFAULT_CONFIG).decide(feature, regime, marketContext, structure);
      const experimentalDirection = new ForexExperimentalAtrDirectionV1().decide(candles, Math.max(1, timeframe / 60), Math.floor(now / 1000));
      return { feature, structure, regime: regime.snapshot, direction: direction.snapshot, experimentalDirection, error: null };
    } catch (e: any) {
      return { feature: null, structure: null, regime: null, direction: null, experimentalDirection: null, error: e?.message || "Falha ao calcular o estado analítico." };
    }
  }, [candles, currentPrice, marketOpen, now, pipSize, session, timeframe]);

  const experimentalCandidate = runtime.experimentalBridge ?? analysis.experimentalDirection;

  const refreshHistory = React.useCallback(() => {
    const all = getTradeHistory();
    setHistory(all.filter(t => t.market === "forex" || t.symbol?.startsWith("frx")));
  }, []);

  const refreshMarketAndCalendar = React.useCallback(async () => {
    if (!isAuthorized || !derivService.isSocketOpen()) return;
    setRefreshing(true);
    setDashboardError(null);
    try {
      const info = await forexMarketDataService.getSymbolMetadata(FOREX_SYMBOL);
      const schedule = await forexMarketDataService.getTradingSchedule(FOREX_SYMBOL, "today");
      setPipSize(info.pipSize ?? 0.00001);
      const open = Boolean(info.exchangeIsOpen && !info.tradingSuspended && isWithinSchedule(schedule, Date.now()));
      setMarketOpen(open);
      setScheduleLabel(schedule?.openTimes?.length ? `${schedule.openTimes.join(" · ")} → ${schedule.closeTimes.join(" · ")}` : "Sem janela");

      const provider = new DerivForexCalendarProvider(derivService);
      const calendarService = new ForexCalendarServiceImpl(provider);
      const nowEpoch = Math.floor(Date.now() / 1000);
      try {
        const snapshot = await calendarService.getSnapshot(["EUR", "USD"], nowEpoch);
        setEvents(snapshot.relevantEvents);
        setCalendar(snapshot);
        setCalendarError(null);
      } catch (calendarErr: any) {
        // Do not turn a calendar transport problem into a generic dashboard error.
        // The engine must fail closed until the native Deriv calendar is available.
        setEvents([]);
        setCalendar(null);
        setCalendarError(calendarErr?.message || "Calendário económico indisponível.");
        logger.error(`Forex calendar: ${calendarErr?.message || calendarErr}`);
      }
    } catch (e: any) {
      setDashboardError(e?.message || "Não foi possível actualizar o estado Forex.");
    } finally {
      setRefreshing(false);
    }
  }, [isAuthorized]);

  React.useEffect(() => {
    if (market !== "forex") setMarket("forex");
  }, [market, setMarket]);

  React.useEffect(() => {
    refreshHistory();
    const onHistory = () => refreshHistory();
    window.addEventListener("trade_history_updated", onHistory);
    return () => window.removeEventListener("trade_history_updated", onHistory);
  }, [refreshHistory]);

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  React.useEffect(() => {
    refreshMarketAndCalendar();
    const id = window.setInterval(refreshMarketAndCalendar, 60_000);
    return () => window.clearInterval(id);
  }, [refreshMarketAndCalendar]);

  const wins = history.filter(t => t.status === "WON").length;
  const losses = history.filter(t => t.status === "LOST").length;
  const pnl = history.reduce((sum, t) => sum + (Number(t.profit) || 0), 0);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const dailyPnl = history.filter(t => t.time >= todayStart.getTime()).reduce((sum, t) => sum + (Number(t.profit) || 0), 0);
  const lastLoss = [...history].find(t => t.status === "LOST");
  const consecutiveLosses = (() => {
    let n = 0;
    for (const trade of history) {
      if (trade.status === "LOST") n++;
      else if (trade.status === "WON") break;
    }
    return n;
  })();
  const dataFreshness = candles.at(-1)?.time ?? null;
  const freshnessSec = dataFreshness ? Math.max(0, Math.floor(now / 1000 - dataFreshness)) : Infinity;
  const engineState = runtime.stage !== "STOPPED" ? runtime.stage : (!isAuthorized ? "WAIT_DATA" : !marketOpen ? "WAIT_MARKET" : candles.length < 60 ? "WAIT_DATA" : analysis.direction?.direction === "NONE" ? "WAIT_SIGNAL" : "SCANNING");
  const tradeGateOpen = runtime.stage === "PROPOSAL" || runtime.stage === "GUARD" || runtime.stage === "EXECUTING" || runtime.stage === "OPEN";
  const tradeGateReason = runtime.message || (!isAuthorized ? "Conta Deriv não autorizada" : !marketOpen ? "Mercado fechado" : candles.length < 60 ? "Histórico insuficiente" : analysis.direction?.direction === "NONE" ? "Sem sinal CALL/PUT aprovado" : "A aguardar runtime");
  const nextEvents = events.filter(e => e.eventTime >= Math.floor(now / 1000)).slice(0, 5);
  const cooldownUntil = lastLoss ? lastLoss.time + risk.cooldownAfterLossSeconds * 1000 : 0;
  const cooldownRemaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-emerald-400">FOREX ENGINE</span>
            <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/20 text-[8px]">V1</Badge>
            <Badge className={cn("text-[8px]", marketOpen ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20")}>{marketOpen ? "MERCADO ABERTO" : "MERCADO FECHADO"}</Badge>
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight mt-1">Forex Dashboard</h1>
          <p className="text-[10px] text-muted-foreground mt-1">{FOREX_NAME} · New API · Rise/Fall · Decision Engine V1 · sinal experimental separado da execução</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => refreshMarketAndCalendar()} disabled={refreshing} className="h-10 text-[10px] font-black uppercase border-white/10">
            <RefreshCw className={cn("w-3.5 h-3.5 mr-2", refreshing && "animate-spin")} /> Actualizar
          </Button>
          <Button variant="outline" onClick={() => setShowRisk(true)} className="h-10 text-[10px] font-black uppercase border-emerald-500/30 text-emerald-300">
            <SlidersHorizontal className="w-3.5 h-3.5 mr-2" /> Gestão de risco
          </Button>
          <Button onClick={() => toggleBot()} disabled={!isAuthorized || (!botRunning && !marketOpen)} className={cn("h-10 min-w-36 text-[10px] font-black uppercase", botRunning ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700")}>
            <Power className={cn("w-4 h-4 mr-2", botRunning && "animate-pulse")} /> {botRunning ? "Stop Bot" : "Start Bot"}
          </Button>
        </div>
      </div>

      {dashboardError && <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-200"><AlertTriangle className="inline w-3.5 h-3.5 mr-2" />{dashboardError}</div>}

      {/* Top metrics */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        {[
          { icon: Activity, label: "Preço", value: fmtPrice(currentPrice, pipSize), sub: `${priceDirection === "UP" ? "↑" : "↓"} movimento`, cls: priceDirection === "UP" ? "text-emerald-400" : "text-red-400" },
          { icon: Wallet, label: "Saldo", value: balance == null ? "—" : `$${Number(balance).toFixed(2)}`, sub: "conta Deriv", cls: "text-white" },
          { icon: Target, label: "P&L Forex", value: fmtMoney(pnl), sub: `${wins}W / ${losses}L`, cls: pnl >= 0 ? "text-emerald-400" : "text-red-400" },
          { icon: Gauge, label: "Engine", value: stateLabel(engineState), sub: `score ${analysis.direction ? analysis.direction.rawScore.toFixed(2) : "—"}`, cls: engineState === "READY" ? "text-emerald-400" : "text-amber-300" },
          { icon: Target, label: "Candidato experimental", value: experimentalCandidate?.direction ?? "NONE", sub: experimentalCandidate ? `ATR14 INVERSE · ${experimentalCandidate.candidate ? "candidato ativo" : "sem candidato"} · não executável` : "aguardando dados", cls: experimentalCandidate?.direction === "CALL" ? "text-emerald-400" : experimentalCandidate?.direction === "PUT" ? "text-red-400" : "text-amber-300" },
          { icon: Clock3, label: "Sessão", value: session.session.replace("_", " "), sub: session.overlap ? "overlap" : "UTC", cls: "text-cyan-300" },
          { icon: CalendarDays, label: "Calendário", value: calendarLabel(calendar), sub: calendarError ? "indisponível" : `${nextEvents.length} próximos`, cls: calendar?.state === "CLEAR" ? "text-emerald-400" : "text-amber-300" },
          { icon: connectionHealth.connected ? Wifi : WifiOff, label: "Conexão", value: connectionHealth.connected ? "CONECTADO" : "OFFLINE", sub: connectionHealth.connected ? `última msg ${minutesAgo(connectionHealth.lastMessageAt ? Math.floor(connectionHealth.lastMessageAt / 1000) : null)}` : "Deriv WebSocket", cls: connectionHealth.connected ? "text-emerald-400" : "text-red-400" },
        ].map(({ icon: Icon, label, value, sub, cls }) => (
          <NeonCard key={label} variant="blue" className="p-3">
            <div className="flex items-center gap-2"><Icon className={cn("w-3.5 h-3.5", cls)} /><span className="text-[8px] uppercase tracking-widest text-muted-foreground font-black">{label}</span></div>
            <p className={cn("text-sm font-black mt-2 truncate", cls)}>{value}</p>
            <p className="text-[8px] text-muted-foreground mt-0.5 truncate">{sub}</p>
          </NeonCard>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
        <div className="space-y-4 min-w-0">
          <NeonCard variant="cyan" className="p-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                {priceDirection === "UP" ? <ArrowUpRight className="w-5 h-5 text-emerald-400" /> : <ArrowDownRight className="w-5 h-5 text-red-400" />}
                <div><p className="text-xl font-black tracking-tight">{fmtPrice(currentPrice, pipSize)}</p><p className="text-[8px] text-muted-foreground uppercase tracking-widest">{FOREX_NAME} · pip {pipSize}</p></div>
                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px]">LIVE</Badge>
              </div>
              <div className="flex gap-2">
                <Select value={symbol} onValueChange={setSymbol}>
                  <SelectTrigger className="w-32 h-8 text-[10px] bg-black/20 border-white/10"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#111114] border-white/10 text-white"><SelectItem value={FOREX_SYMBOL}>EUR/USD</SelectItem></SelectContent>
                </Select>
                <Select value={String(timeframe)} onValueChange={v => setTimeframe(Number(v))}>
                  <SelectTrigger className="w-24 h-8 text-[10px] bg-black/20 border-white/10"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#111114] border-white/10 text-white">
                    <SelectItem value="60">1m</SelectItem><SelectItem value="300">5m</SelectItem><SelectItem value="900">15m</SelectItem><SelectItem value="1800">30m</SelectItem><SelectItem value="3600">1h</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <ErrorBoundary fallbackLabel="Erro no gráfico Forex"><TradingChart candles={candles} symbol={FOREX_NAME} /></ErrorBoundary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
              <div className="rounded-lg border border-white/5 bg-black/20 p-2"><p className="text-[8px] uppercase text-muted-foreground">Dados</p><p className="text-xs font-black">{candles.length} candles</p></div>
              <div className="rounded-lg border border-white/5 bg-black/20 p-2"><p className="text-[8px] uppercase text-muted-foreground">Freshness</p><p className={cn("text-xs font-black", freshnessSec < 180 ? "text-emerald-400" : "text-amber-400")}>{Number.isFinite(freshnessSec) ? `${freshnessSec}s` : "—"}</p></div>
              <div className="rounded-lg border border-white/5 bg-black/20 p-2"><p className="text-[8px] uppercase text-muted-foreground">Horário</p><p className="text-xs font-black truncate">{scheduleLabel}</p></div>
              <div className="rounded-lg border border-white/5 bg-black/20 p-2"><p className="text-[8px] uppercase text-muted-foreground">Último candle</p><p className="text-xs font-black">há {minutesAgo(dataFreshness)}</p></div>
            </div>
          </NeonCard>

          {/* Runtime truth */}
          <NeonCard variant="cyan" className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div><p className="text-[9px] uppercase tracking-widest text-muted-foreground font-black">D19 Runtime Integration</p>
              <p className="text-base font-black mt-1">{stateLabel(runtime.stage)}</p></div>
              <Badge className={cn(runtime.demoVerified ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" : "bg-red-500/10 text-red-300 border-red-500/20")}>{runtime.demoVerified ? "DEMO VERIFIED" : "DEMO NÃO VERIFICADA"}</Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-xl border border-white/5 bg-black/20 p-3"><p className="text-[8px] uppercase text-muted-foreground">Avaliações</p><p className="text-lg font-black">{runtime.evaluations}</p></div>
              <div className="rounded-xl border border-white/5 bg-black/20 p-3"><p className="text-[8px] uppercase text-muted-foreground">Proposal</p><p className="text-sm font-black">{runtime.lastProposal?.id ?? "—"}</p></div>
              <div className="rounded-xl border border-white/5 bg-black/20 p-3"><p className="text-[8px] uppercase text-muted-foreground">Contrato</p><p className="text-sm font-black">{runtime.activeContract?.contractId ?? "—"}</p></div>
              <div className="rounded-xl border border-white/5 bg-black/20 p-3"><p className="text-[8px] uppercase text-muted-foreground">Último resultado</p><p className="text-sm font-black">{runtime.lastResult?.status ?? "—"}</p></div>
            </div>
            <div className="mt-3 rounded-xl border border-white/5 bg-black/20 p-3 text-[9px] text-muted-foreground leading-relaxed">{runtime.message}</div>
            <div className="mt-2 rounded-xl border border-amber-500/15 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between gap-2"><span className="text-[8px] uppercase tracking-widest font-black text-amber-300">Research Direction Bridge</span><Badge className="text-[7px] bg-amber-500/10 text-amber-300 border-amber-500/20">RESEARCH ONLY</Badge></div>
              <div className="flex items-end justify-between gap-3 mt-2"><div><p className="text-2xl font-black">{runtime.experimentalBridge?.direction ?? "—"}</p><p className="text-[8px] text-muted-foreground">{runtime.experimentalBridge?.reason ?? "Ainda sem avaliação do runtime."}</p></div><div className="text-right"><p className="text-[8px] text-muted-foreground">score / conf.</p><p className="text-xs font-black">{runtime.experimentalBridge ? `${runtime.experimentalBridge.score.toFixed(3)} / ${runtime.experimentalBridge.confidence.toFixed(3)}` : "—"}</p></div></div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-[8px]"><div className="rounded-lg border border-white/5 bg-black/20 p-2"><span className="text-muted-foreground">Produção</span><span className="ml-1 font-black">NÃO ELEGÍVEL</span></div><div className="rounded-lg border border-white/5 bg-black/20 p-2"><span className="text-muted-foreground">Execução</span><span className="ml-1 font-black">BLOQUEADA</span></div></div>
            </div>
          </NeonCard>

          {/* Decision status */}
          <NeonCard variant="purple" className="p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div><p className="text-[9px] uppercase tracking-widest text-muted-foreground font-black">Decision Engine · estado actual</p><p className="text-base font-black mt-1">{stateLabel(engineState)}</p></div>
              <div className={cn("px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase", engineState === "READY" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : engineState === "NEWS_BLOCK" ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-amber-500/20 bg-amber-500/5 text-amber-300")}>{engineState}</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-xl border border-white/5 bg-black/20 p-3"><p className="text-[8px] uppercase text-muted-foreground">Direção</p><p className="text-lg font-black">{analysis.direction?.direction ?? "NONE"}</p><p className="text-[8px] text-muted-foreground">CALL/PUT</p></div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><p className="text-[8px] uppercase text-amber-300">Experimental Bridge</p><p className="text-lg font-black">{experimentalCandidate?.direction ?? "NONE"}</p><p className="text-[8px] text-amber-200/70">{experimentalCandidate?.candidate ? "CANDIDATO CALL/PUT" : "SEM CANDIDATO"} · não autoriza BUY</p></div>
              <div className="rounded-xl border border-white/5 bg-black/20 p-3"><p className="text-[8px] uppercase text-muted-foreground">Score</p><p className="text-lg font-black">{analysis.direction ? analysis.direction.rawScore.toFixed(3) : "—"}</p><p className="text-[8px] text-muted-foreground">não é probabilidade</p></div>
              <div className="rounded-xl border border-white/5 bg-black/20 p-3"><p className="text-[8px] uppercase text-muted-foreground">Regime</p><p className="text-sm font-black">{analysis.regime?.regime ?? "UNKNOWN"}</p><p className="text-[8px] text-muted-foreground">conf. {analysis.regime ? `${Math.round(analysis.regime.confidence * 100)}%` : "—"}</p></div>
              <div className="rounded-xl border border-white/5 bg-black/20 p-3"><p className="text-[8px] uppercase text-muted-foreground">Estrutura</p><p className="text-sm font-black">{analysis.structure?.direction ?? "UNKNOWN"}</p><p className="text-[8px] text-muted-foreground">{analysis.structure?.event ?? "NONE"}</p></div>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/5 p-3 text-[9px] text-amber-200/80 leading-relaxed">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{runtime.message || analysis.error || "Runtime ainda não realizou uma avaliação operacional."}</span>
            </div>
          </NeonCard>

          {/* Trade Gate */}
          <NeonCard variant={tradeGateOpen ? "cyan" : "purple"} className="p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div><p className="text-[9px] uppercase tracking-widest text-muted-foreground font-black">TRADE GATE</p><p className={cn("text-xl font-black mt-1", tradeGateOpen ? "text-emerald-400" : "text-amber-300")}>{tradeGateOpen ? "ENTRADA PERMITIDA" : "ENTRADA BLOQUEADA"}</p></div>
              <Badge className={cn("text-[8px]", tradeGateOpen ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" : "bg-amber-500/10 text-amber-300 border-amber-500/20")}>{tradeGateOpen ? "GO" : "NO-GO"}</Badge>
            </div>
            <p className="text-[9px] text-muted-foreground leading-relaxed">{tradeGateReason}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
              <div className="rounded-lg border border-white/5 bg-black/20 p-2"><p className="text-[8px] text-muted-foreground">Engine</p><p className="text-[9px] font-black">{decisionEngineOperational ? "OPERACIONAL" : "EM CONSTRUÇÃO"}</p></div>
              <div className="rounded-lg border border-white/5 bg-black/20 p-2"><p className="text-[8px] text-muted-foreground">Mercado</p><p className="text-[9px] font-black">{marketOpen ? "ABERTO" : "FECHADO"}</p></div>
              <div className="rounded-lg border border-white/5 bg-black/20 p-2"><p className="text-[8px] text-muted-foreground">Calendar</p><p className="text-[9px] font-black">{calendarError ? "OFFLINE" : calendarLabel(calendar)}</p></div>
              <div className="rounded-lg border border-white/5 bg-black/20 p-2"><p className="text-[8px] text-muted-foreground">Risk</p><p className="text-[9px] font-black">{consecutiveLosses >= risk.maxConsecutiveLosses ? "BLOCKED" : "CLEAR"}</p></div>
            </div>
          </NeonCard>

          {/* History */}
          <NeonCard variant="blue" className="p-4">
            <div className="flex items-center justify-between mb-3"><p className="text-[9px] uppercase tracking-widest text-muted-foreground font-black">Histórico de entradas · Forex</p><span className="text-[8px] text-muted-foreground">{history.length} registos</span></div>
            <div className="overflow-x-auto"><table className="w-full text-[9px]"><thead><tr className="text-muted-foreground border-b border-white/5"><th className="p-2 text-left">Hora</th><th className="p-2 text-left">Direção</th><th className="p-2 text-left">Stake</th><th className="p-2 text-left">Entrada</th><th className="p-2 text-left">Resultado</th><th className="p-2 text-right">P&L</th></tr></thead><tbody>
              {history.slice(0, 12).map(t => <tr key={t.id} className="border-b border-white/5"><td className="p-2 text-muted-foreground">{new Date(t.time).toLocaleTimeString()}</td><td className={cn("p-2 font-black", t.type === "CALL" ? "text-emerald-400" : "text-red-400")}>{t.type}</td><td className="p-2">${Number(t.stake).toFixed(2)}</td><td className="p-2 font-mono">{t.entryPrice ? fmtPrice(t.entryPrice, pipSize) : "—"}</td><td className="p-2">{t.status}</td><td className={cn("p-2 text-right font-black", Number(t.profit || 0) >= 0 ? "text-emerald-400" : "text-red-400")}>{t.profit == null ? "—" : fmtMoney(Number(t.profit))}</td></tr>)}
              {history.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Ainda não existem entradas Forex.</td></tr>}
            </tbody></table></div>
          </NeonCard>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <NeonCard variant="cyan" className="p-4">
            <div className="flex items-center justify-between"><p className="text-[9px] uppercase tracking-widest text-muted-foreground font-black">Bot Forex</p><div className={cn("w-2 h-2 rounded-full", botRunning ? "bg-emerald-400 animate-pulse" : "bg-slate-600")} /></div>
            <p className="text-xl font-black mt-2">{botRunning ? "RUNNING" : "STOPPED"}</p>
            <p className="text-[9px] text-muted-foreground mt-1">{botRunning ? (tradeGateOpen ? "Runtime integrado; a aguardar oportunidade válida." : `Activo, mas bloqueado: ${tradeGateReason}.`) : "STOPPED · ativação manual pendente."}</p>
            <div className="grid grid-cols-2 gap-2 mt-3"><div className="rounded-lg bg-black/20 border border-white/5 p-2"><p className="text-[8px] text-muted-foreground">Contrato</p><p className="text-xs font-black">Rise/Fall</p></div><div className="rounded-lg bg-black/20 border border-white/5 p-2"><p className="text-[8px] text-muted-foreground">Stake</p><p className="text-xs font-black">${risk.maxStakePerTrade.toFixed(2)} máx.</p></div></div>
          </NeonCard>

          <NeonCard variant="purple" className="p-4">
            <div className="flex items-center gap-2 mb-3"><ShieldCheck className="w-4 h-4 text-emerald-400" /><p className="text-[9px] uppercase tracking-widest font-black">Risk Engine</p></div>
            <div className="space-y-2">
              {[['Stake máx.', `$${risk.maxStakePerTrade.toFixed(2)}`], ['Loss sessão', fmtMoney(-Math.max(0, -pnl)) + ` / -$${risk.maxSessionLoss.toFixed(2)}`], ['Loss diário', fmtMoney(-Math.max(0, -dailyPnl)) + ` / -$${risk.maxDailyLoss.toFixed(2)}`], ['Loss streak', `${consecutiveLosses} / ${risk.maxConsecutiveLosses}`], ['Intervalo', `${risk.minEntryIntervalSeconds}s`]].map(([label, value]) => <div key={label} className="flex items-center justify-between border-b border-white/5 pb-1.5"><span className="text-[9px] text-muted-foreground">{label}</span><span className="text-[9px] font-black">{value}</span></div>)}
            </div>
            <div className={cn("mt-3 rounded-lg border p-2 text-[9px] font-black", consecutiveLosses >= risk.maxConsecutiveLosses ? "border-red-500/20 bg-red-500/5 text-red-300" : "border-emerald-500/20 bg-emerald-500/5 text-emerald-300")}>Risk status: {consecutiveLosses >= risk.maxConsecutiveLosses ? "BLOCKED" : "CLEAR"}</div>
            {cooldownRemaining > 0 && <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[9px] text-amber-300"><Timer className="inline w-3 h-3 mr-1" />Cooldown estimado: {cooldownRemaining}s</div>}
          </NeonCard>

          <NeonCard variant="blue" className="p-4">
            <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-amber-300" /><p className="text-[9px] uppercase tracking-widest font-black">Calendário económico</p></div><Badge className={cn("text-[8px]", calendar?.state === "BLOCK" ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20")}>{calendarLabel(calendar)}</Badge></div>
            <p className="text-[8px] text-muted-foreground mb-2">EUR + USD · fonte nativa Deriv</p>
            <div className="space-y-2">
              {nextEvents.map(event => <div key={event.eventId} className="rounded-lg border border-white/5 bg-black/20 p-2"><div className="flex items-center justify-between gap-2"><span className="text-[9px] font-black truncate">{event.name}</span><span className={cn("text-[7px] px-1.5 py-0.5 rounded border uppercase", impactClass(event.impact))}>{event.impact}</span></div><p className="text-[8px] text-muted-foreground mt-1">{event.currency} · {new Date(event.eventTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · em {Math.max(0, Math.round((event.eventTime * 1000 - now) / 60000))}m</p></div>)}
              {calendarError && <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[9px] text-amber-200"><AlertTriangle className="inline w-3 h-3 mr-1" />Calendário nativo Deriv indisponível nesta ligação. O Trade Gate permanece bloqueado por segurança.</div>}
              {!calendarError && nextEvents.length === 0 && <div className="rounded-lg border border-white/5 bg-black/20 p-3 text-[9px] text-muted-foreground">Nenhum evento próximo encontrado.</div>}
            </div>
          </NeonCard>

          <NeonCard variant="cyan" className="p-4">
            <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-cyan-300" /><p className="text-[9px] uppercase tracking-widest font-black">Performance da sessão</p></div><span className="text-[8px] text-muted-foreground">Forex</span></div>
            <div className="grid grid-cols-2 gap-2">
              {[['Trades', history.length.toString()], ['Win rate', history.length ? `${Math.round((wins / history.length) * 100)}%` : '—'], ['Wins / Losses', `${wins} / ${losses}`], ['P&L', fmtMoney(pnl)]].map(([label, value]) => <div key={label} className="rounded-lg border border-white/5 bg-black/20 p-2"><p className="text-[8px] text-muted-foreground">{label}</p><p className={cn("text-sm font-black mt-1", label === 'P&L' ? (pnl >= 0 ? 'text-emerald-400' : 'text-red-400') : '')}>{value}</p></div>)}
            </div>
          </NeonCard>

          <NeonCard variant="blue" className="p-4">
            <div className="flex items-center gap-2 mb-3"><Target className="w-4 h-4 text-cyan-300" /><p className="text-[9px] uppercase tracking-widest font-black">Contrato validado</p></div>
            <div className="grid grid-cols-2 gap-2">{VALIDATED_DURATIONS.map(d => <div key={d} className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-2 text-center"><p className="text-xs font-black text-emerald-300">{d}m</p><p className="text-[7px] uppercase text-muted-foreground">CALL/PUT</p></div>)}</div>
            <div className="mt-3 text-[8px] text-muted-foreground leading-relaxed">Baseline de investigação já confirmado: 15/30/60/120 min aceites e stake de $0,50 aceite. Higher/Lower fica fora do fluxo inicial.</div>
          </NeonCard>

          <NeonCard variant="purple" className="p-4">
            <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><Zap className="w-4 h-4 text-purple-300" /><p className="text-[9px] uppercase tracking-widest font-black">Pipeline</p></div><span className="text-[8px] text-muted-foreground">V1</span></div>
            {[['Market', marketOpen, 'Trading Times'], ['Data', candles.length >= 60 && freshnessSec < 180, '60+ candles / fresh'], ['Features', !!analysis.feature, 'sem gaps'], ['Regime', !!analysis.regime && analysis.regime.regime !== 'UNKNOWN', 'compatível'], ['Signal', !!analysis.direction?.tradable, 'CALL/PUT'], ['Calendar', !!calendar && !calendarError && calendar.state !== 'BLOCK', 'fonte válida'], ['Risk', consecutiveLosses < risk.maxConsecutiveLosses && cooldownRemaining === 0, 'gate de risco'], ['Research', !!experimentalCandidate?.candidate, 'CALL/PUT experimental · não executável'], ['Contract', !!runtime.lastProposal, 'D15 Proposal']].map(([label, ok, sub]) => <div key={String(label)} className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0"><span className={cn("w-1.5 h-1.5 rounded-full", ok ? "bg-emerald-400" : "bg-red-400")} /><span className="text-[9px] font-bold w-16">{label}</span><span className="text-[8px] text-muted-foreground truncate">{sub}</span>{ok ? <CheckCircle2 className="ml-auto w-3 h-3 text-emerald-400" /> : <AlertTriangle className="ml-auto w-3 h-3 text-red-400" />}</div>)}
          </NeonCard>
        </div>
      </div>

      <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/[0.02] p-3 flex items-start gap-2 text-[9px] text-muted-foreground"><Bell className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> D19 Runtime Integration: o botão Start/Stop controla o runtime Forex. BUY só pode ocorrer após D13 → D15 → D16 e a verificação DEMO-ONLY.</div>

      <AnimatePresence>{showRisk && <RiskModal onClose={() => setShowRisk(false)} />}</AnimatePresence>
    </div>
  );
};
