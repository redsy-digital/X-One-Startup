import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Power, Settings2, X, TrendingUp, ChevronLeft, ChevronRight,
  Activity, Target, WalletCards, Repeat2, BarChart3, Clock3, ArrowUpRight, ArrowDownRight, AlertTriangle, Square, Zap
} from "lucide-react";
import { cn } from "../lib/utils";
import { NeonCard } from "../components/NeonCard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "../components/ui/select";
import { TradingChart } from "../components/TradingChart";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SYMBOLS } from "../constants";
import { logger, LogEntry } from "../lib/logger";
import { getTradeHistory } from "../lib/storage";
import { TradeHistory } from "../types";
import { useConnectionStore, useBotStore, useMarketStore } from "../store";
import { useSessionStore } from "../store/useSessionStore";
import { useSyntheticTabsStore } from "../store/useSyntheticTabsStore";
import { useAccumulatorsStore } from "../accumulators/store";
import { getActiveAccumulatorsEngine } from "../accumulators/useAccumulatorsEngine";
import { ACCUMULATORS_GROWTH_RATES, growthRateLabel, type AccumulatorsGrowthRate } from "../accumulators/types";
import { useAccumulatorsSettingsStore } from "../store/useAccumulatorsSettingsStore";

// ── Helpers locais (duplicados de propósito a partir de DashboardPage.tsx
// para evitar import circular — Digits fica completamente intocado). ──────

function useSessionTimer(running: boolean, sessionStartedAt: number | null, frozenElapsed: number) {
  const [elapsed, setElapsed] = useState(() =>
    running && sessionStartedAt ? Math.floor((Date.now() - sessionStartedAt) / 1000) : frozenElapsed
  );
  useEffect(() => {
    if (!running || !sessionStartedAt) { setElapsed(frozenElapsed); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - sessionStartedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running, sessionStartedAt, frozenElapsed]);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const s = String(elapsed % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function useLogEntries(max = 500) {
  const [entries, setEntries] = useState<LogEntry[]>(() => logger.getAll().slice(-max));
  useEffect(() => {
    const unsub = logger.subscribe((e) => {
      if (!e) { setEntries([]); return; }
      setEntries((prev) => [...prev.slice(-(max - 1)), e]);
    });
    return unsub;
  }, [max]);
  return entries;
}

const RuntimeMetric = ({ label, value, accent = "text-white" }: { label: string; value: string; accent?: string }) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-white/5 bg-white/5 p-2.5 text-center min-w-0">
    <p className="text-[8px] uppercase text-muted-foreground font-bold tracking-wide truncate">{label}</p>
    <p className={cn("text-xs font-black mt-1 truncate", accent)}>{value}</p>
  </motion.div>
);

const StatusPill = ({ label, value, className = "" }: { label: string; value: string; className?: string }) => (
  <div className={cn("rounded-xl border border-white/5 bg-black/20 px-3 py-2", className)}>
    <p className="text-[8px] uppercase text-muted-foreground font-black">{label}</p>
    <p className="text-[11px] font-black text-white mt-0.5 truncate">{value}</p>
  </div>
);

// ── Selectores principais Accumulators ────────────────────────────────────
const AccumulatorsSelectors = () => {
  const { settings, updateSettings } = useAccumulatorsSettingsStore();
  const { isBotRunning } = useBotStore();

  return (
    <NeonCard variant="blue" className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Configuração Accumulators</p>
          <p className="text-[11px] font-black text-white mt-1">Entrada determinística · sem previsão</p>
        </div>
        <TrendingUp className="w-4 h-4 text-blue-400" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[9px] text-muted-foreground uppercase font-black">Growth Rate</label>
          <Select
            value={String(settings.growthRate)}
            disabled={isBotRunning}
            onValueChange={(value) => updateSettings({ growthRate: Number(value) as AccumulatorsGrowthRate })}
          >
            <SelectTrigger className="w-full bg-black/30 border-white/10 h-9 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#111114] border-white/10 text-white">
              {ACCUMULATORS_GROWTH_RATES.map((rate) => (
                <SelectItem key={rate} value={String(rate)}>{growthRateLabel(rate)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-[9px] text-muted-foreground uppercase font-black">Fechar após (ticks)</label>
          <Input
            type="number" min={1} max={500} step="1"
            value={settings.tickCount}
            disabled={isBotRunning}
            onChange={(e) => {
              const raw = Math.round(Number(e.target.value));
              if (!Number.isFinite(raw)) return;
              updateSettings({ tickCount: Math.max(1, Math.min(500, raw)) });
            }}
            className="bg-black/30 border-white/10 h-9 text-[11px]"
          />
        </div>
      </div>

      <p className="text-[9px] text-muted-foreground/60">
        A Deriv não permite duração fixa para Accumulators — o bot fecha o contrato (sell) sozinho ao atingir o número de ticks configurado, a menos que seja fechado manualmente antes disso.
      </p>
    </NeonCard>
  );
};

// ── Modal de gestão de banca Accumulators ─────────────────────────────────
const AccumulatorsConfigModal = ({ onClose }: { onClose: () => void }) => {
  const { settings, updateSettings } = useAccumulatorsSettingsStore();
  const { isBotRunning } = useBotStore();
  const s = settings;

  const row = (label: string, key: keyof typeof s, step = "1", min = 0, max?: number) => (
    <div className="space-y-1" key={label}>
      <label className="text-[9px] text-muted-foreground uppercase font-black">{label}</label>
      <Input type="number" step={step} min={min} max={max} value={s[key] as number}
        disabled={isBotRunning}
        onChange={(e) => {
          const raw = Number(e.target.value);
          if (!Number.isFinite(raw)) return;
          let value = Math.max(min, raw);
          if (max !== undefined) value = Math.min(max, value);
          updateSettings({ [key]: value } as any);
        }}
        className="bg-black/30 border-white/10 h-8 text-[11px]" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-[#111114] border border-blue-500/20 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <p className="font-black text-sm uppercase tracking-widest flex items-center gap-2 text-white">
            <TrendingUp className="w-4 h-4 text-blue-400" /> Accumulators V1
          </p>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground"><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
            <p className="text-[9px] uppercase font-black text-blue-300">Entrada configurada</p>
            <p className="text-[11px] text-white font-black mt-1">Growth {growthRateLabel(s.growthRate)} · fecha aos {s.tickCount} ticks</p>
            <p className="text-[9px] text-muted-foreground mt-1">Growth Rate e nº de ticks são seleccionados directamente no painel, fora deste modal.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {row("Stake inicial ($)", "stake", "0.01", 0.35)}
            {row("Take Profit ($)", "targetProfit", "0.01", 0)}
            {row("Stop Loss ($)", "stopLoss", "0.01", 0)}
            {row("Máx. perdas seg.", "maxConsecutiveLosses", "1", 1)}
          </div>
          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] text-muted-foreground font-bold">Martingale</span>
                <p className="text-[9px] text-muted-foreground mt-0.5">Aumenta a stake após LOSS.</p>
              </div>
              <Switch checked={s.useMartingale} disabled={isBotRunning} onCheckedChange={(v) => updateSettings({ useMartingale: v })} className="scale-90" />
            </div>
            {s.useMartingale && (
              <div className="grid grid-cols-2 gap-2">
                {row("Steps", "maxMartingaleSteps", "1", 0)}
                {row("Multiplicador", "martingaleMultiplier", "0.1", 1)}
              </div>
            )}
          </div>
          {row("Cooldown após limite (s)", "cooldownAfterLoss", "1", 0)}
          <div className="p-3 rounded-xl border border-blue-500/20 bg-blue-500/5">
            <p className="text-[9px] uppercase font-black text-blue-300">Gestão separada da estratégia</p>
            <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
              WIN repete a mesma entrada. LOSS aplica a progressão configurada. O risco não altera o Growth Rate nem o número de ticks seleccionado.
            </p>
          </div>
        </div>
        <div className="px-5 pb-5">
          <Button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 font-black uppercase h-10">Guardar e Fechar</Button>
        </div>
      </motion.div>
    </div>
  );
};

const ResultModal = ({ type, amount, onClose }: { type: "profit" | "loss"; amount: number; onClose: () => void }) => (
  <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
    <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      className={cn("w-full max-w-xs rounded-2xl p-8 text-center shadow-2xl border",
        type === "profit" ? "bg-green-950/80 border-green-500/40 shadow-green-500/20" : "bg-red-950/80 border-red-500/40 shadow-red-500/20")}>
      <div className="text-5xl mb-4">{type === "profit" ? "🏆" : "🛑"}</div>
      <p className={cn("text-xl font-black uppercase tracking-wide", type === "profit" ? "text-green-400" : "text-red-400")}>
        {type === "profit" ? "Meta Atingida!" : "Stop Loss!"}
      </p>
      <p className={cn("text-3xl font-black mt-2", type === "profit" ? "text-green-300" : "text-red-300")}>
        {amount >= 0 ? "+" : ""}${Math.abs(amount).toFixed(2)}
      </p>
      <Button onClick={onClose} className={cn("w-full mt-6 font-black uppercase h-11", type === "profit" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700")}>
        OK
      </Button>
    </motion.div>
  </div>
);

// ── AccumulatorsDashboardBody ──────────────────────────────────────────────
export const AccumulatorsDashboardBody = ({ tabId }: { tabId: string }) => {
  const { isAuthorized } = useConnectionStore();
  const { isBotRunning, setIsBotRunning, lossCooldown, sessionStartedAt, sessionFrozenElapsed } = useBotStore();
  const { runningTabId, setRunningTab } = useSyntheticTabsStore();
  const isOwner = runningTabId === tabId;
  const { symbol, setSymbol, candles, ticks, timeframe, setTimeframe } = useMarketStore();
  const { settings } = useAccumulatorsSettingsStore();
  const { runtime } = useAccumulatorsStore();
  const { wins, losses, pnl: rawPnl, modal, closeModal } = useSessionStore();
  const pnl = Number(rawPnl) || 0;
  const logEntries = useLogEntries(60);
  const timer = useSessionTimer(isBotRunning && isOwner, sessionStartedAt, sessionFrozenElapsed);
  const [showConfig, setShowConfig] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (!lossCooldown) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNowTick(t);
      if (t >= lossCooldown.until) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [lossCooldown]);
  const cooldownRemainingSec = lossCooldown ? Math.max(0, Math.ceil((lossCooldown.until - nowTick) / 1000)) : 0;
  const showCooldownBanner = !!lossCooldown && cooldownRemainingSec > 0 && isOwner;

  const [localHistory, setLocalHistory] = useState<TradeHistory[]>(() => getTradeHistory());
  useEffect(() => {
    const handler = () => setLocalHistory(getTradeHistory());
    window.addEventListener("trade_history_updated", handler);
    return () => window.removeEventListener("trade_history_updated", handler);
  }, []);
  const accuHistory = localHistory.filter((t) => t.type === "ACCU");

  const logsContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logsContainerRef.current) logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
  }, [logEntries.length]);

  const currentPrice = ticks.length > 0 ? ticks[ticks.length - 1].price : null;
  const prevPrice = ticks.length > 1 ? ticks[ticks.length - 2].price : null;
  const isUp = currentPrice && prevPrice ? currentPrice >= prevPrice : true;
  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

  const logColors: Record<string, string> = {
    system: "text-blue-400", signal: "text-purple-300", block: "text-amber-400",
    trade: "text-emerald-400", risk: "text-orange-400", error: "text-red-400"
  };

  // Bloqueia operação manual sempre que qualquer bot (nesta ou noutra aba)
  // esteja a operar, ou já exista um contrato ACCU em aberto nesta aba.
  const hasActiveContract = !!runtime.activeContractId;
  const manualDisabled = !isAuthorized || isBotRunning || hasActiveContract || manualBusy;
  const closeDisabled = !hasActiveContract || closeBusy;

  const handleManualBuy = async () => {
    const engine = getActiveAccumulatorsEngine();
    if (!engine) return;
    setManualBusy(true);
    try { await engine.manualBuy(); } finally { setManualBusy(false); }
  };

  const handleClose = async () => {
    const engine = getActiveAccumulatorsEngine();
    if (!engine) return;
    setCloseBusy(true);
    try { await engine.closeActiveContract("Fecho manual pelo utilizador"); } finally { setCloseBusy(false); }
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">

        {/* ══ COLUNA ESQUERDA ══════════════════════════════════════════════ */}
        <div className="flex flex-col gap-3">

          <AccumulatorsSelectors />

          {/* Sessão + P/L + Win/Loss */}
          <NeonCard variant="blue" className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock3 className="w-4 h-4 text-blue-400" />
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Sessão Accumulators</p>
              </div>
              <Badge className={cn(isBotRunning && isOwner ? "bg-green-500/10 text-green-300 border-green-500/20" : "bg-white/5 text-muted-foreground border-white/10")}>
                {isBotRunning && isOwner ? "OPERANDO" : isBotRunning ? "NOUTRA ABA" : "PARADO"}
              </Badge>
            </div>
            <div className="flex items-center justify-center">
              <div className="px-4 py-2 bg-black/50 border border-blue-500/30 rounded-xl">
                <span className="font-mono font-black text-2xl text-white tracking-widest">{timer}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusPill label="Lucro da sessão" value={`${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`} className={pnl >= 0 ? "border-green-500/10" : "border-red-500/10"} />
              <StatusPill label="Win / Loss" value={`${wins} / ${losses}`} />
            </div>
          </NeonCard>

          {/* Configuração e próxima entrada */}
          <NeonCard variant="blue" className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-400" />
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Configuração da operação</p>
              </div>
              <Badge className="bg-blue-500/10 text-blue-300 border-blue-500/20 text-[8px]">{growthRateLabel(settings.growthRate)}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusPill label="Contrato" value="ACCU" />
              <StatusPill label="Fecha em" value={`${settings.tickCount} ticks`} />
              <StatusPill label="Growth Rate" value={growthRateLabel(settings.growthRate)} />
              <StatusPill label="Próxima stake" value={`$${(runtime.currentStake || settings.stake).toFixed(2)}`} />
            </div>
          </NeonCard>

          {/* Operação em tempo real + controlo manual */}
          <NeonCard variant="purple" className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-400" />
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Operação em tempo real</p>
              </div>
              <Badge className={runtime.isProcessing ? "bg-amber-500/10 text-amber-300 border-amber-500/20" : "bg-white/5 text-muted-foreground border-white/10"}>
                {runtime.isProcessing ? "PROCESSANDO" : "AGUARDANDO"}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusPill label="Ticks decorridos" value={hasActiveContract ? `${runtime.ticksElapsed} / ${settings.tickCount}` : "—"} />
              <StatusPill label="Valor do contrato" value={runtime.currentContractValue != null ? `$${runtime.currentContractValue.toFixed(2)}` : "—"} />
              <StatusPill label="Stake na entrada" value={runtime.currentStakeInTrade != null ? `$${runtime.currentStakeInTrade.toFixed(2)}` : "—"} />
              <StatusPill label="Contrato ativo" value={runtime.activeContractId ?? "—"} className={runtime.isManualTrade && hasActiveContract ? "border-amber-500/30" : ""} />
            </div>
            {runtime.isManualTrade && hasActiveContract && (
              <p className="text-[9px] text-amber-400 font-bold">Contrato aberto manualmente — fora do loop/martingale do bot.</p>
            )}
            {runtime.error && <p className="text-[9px] text-red-400 font-bold leading-relaxed">{runtime.error}</p>}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={handleManualBuy}
                disabled={manualDisabled}
                title={isBotRunning ? "Pára o bot para operar manualmente" : hasActiveContract ? "Já existe um contrato em aberto" : undefined}
                className="h-11 rounded-xl border-2 border-blue-500/40 bg-blue-500/5 text-blue-400 hover:bg-blue-500/15 font-black uppercase text-[10px] flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Zap className="w-4 h-4" /> Comprar manual
              </button>
              <button
                onClick={handleClose}
                disabled={closeDisabled}
                title={!hasActiveContract ? "Sem contrato em aberto" : "Fecha o contrato ao preço de mercado (sell)"}
                className="h-11 rounded-xl border-2 border-red-500/40 bg-red-500/5 text-red-400 hover:bg-red-500/15 font-black uppercase text-[10px] flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Square className="w-4 h-4" /> Fechar contrato
              </button>
            </div>
            <p className="text-[8px] text-muted-foreground/60 leading-relaxed">
              "Fechar contrato" vende já, tanto para uma entrada aberta pelo bot como para uma compra manual. O bot também o usa automaticamente ao atingir o número de ticks configurado.
            </p>
          </NeonCard>

          {/* Gestão de banca */}
          <NeonCard variant="blue" className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <WalletCards className="w-4 h-4 text-blue-400" />
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Gestão de banca</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <RuntimeMetric label="Stake atual" value={`$${(runtime.currentStake || settings.stake).toFixed(2)}`} accent="text-blue-400" />
              <RuntimeMetric label="Martingale" value={settings.useMartingale ? `${runtime.martingaleStep} / ${settings.maxMartingaleSteps}` : "OFF"} accent="text-purple-300" />
              <RuntimeMetric label="Loss seguidos" value={`${runtime.consecutiveLosses} / ${settings.maxConsecutiveLosses}`} accent={runtime.consecutiveLosses >= 3 ? "text-red-400" : "text-white"} />
              <RuntimeMetric label="Operações" value={String(runtime.entries)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusPill label="Take Profit" value={`$${settings.targetProfit.toFixed(2)}`} />
              <StatusPill label="Stop Loss" value={`$${settings.stopLoss.toFixed(2)}`} />
            </div>
          </NeonCard>

          {/* Última operação */}
          <NeonCard variant="blue" className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Repeat2 className="w-4 h-4 text-blue-400" />
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Última operação</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusPill label="Stake" value={runtime.lastStake != null ? `$${runtime.lastStake.toFixed(2)}` : "—"} />
              <StatusPill label="Ticks" value={runtime.lastTicks != null ? String(runtime.lastTicks) : "—"} />
              <StatusPill label="Resultado" value={runtime.lastResult === "WON" ? "WIN" : runtime.lastResult === "LOST" ? "LOSS" : "—"}
                className={runtime.lastResult === "WON" ? "border-green-500/20" : runtime.lastResult === "LOST" ? "border-red-500/20" : ""} />
              <StatusPill label="Growth Rate" value={growthRateLabel(settings.growthRate)} />
            </div>
            {runtime.lastProfit != null && (
              <p className={cn("text-right text-sm font-black", runtime.lastProfit >= 0 ? "text-green-400" : "text-red-400")}>
                {runtime.lastProfit >= 0 ? "+" : ""}${runtime.lastProfit.toFixed(2)}
              </p>
            )}
          </NeonCard>

          {/* Estatísticas da sessão */}
          <NeonCard variant="purple" className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-purple-400" />
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Estatísticas Accumulators</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-2 gap-2">
              <RuntimeMetric label="Operações" value={String(wins + losses)} />
              <RuntimeMetric label="Wins" value={String(wins)} accent="text-green-400" />
              <RuntimeMetric label="Losses" value={String(losses)} accent="text-red-400" />
              <RuntimeMetric label="Win Rate" value={`${winRate}%`} accent={winRate >= 50 ? "text-green-400" : "text-yellow-400"} />
            </div>
            <div className="rounded-xl border border-white/5 bg-black/20 p-3 flex items-center justify-between">
              <span className="text-[8px] uppercase text-muted-foreground font-black">P/L da sessão</span>
              <span className={cn("text-sm font-black", pnl >= 0 ? "text-green-400" : "text-red-400")}>{pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}</span>
            </div>
          </NeonCard>

          {/* Configuração e controlo do bot */}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setShowConfig(true)}
              className="h-14 border-blue-500/40 text-blue-400 hover:bg-blue-500/10 gap-2 font-black uppercase text-[11px]">
              <Settings2 className="w-4 h-4" /> Gestão
            </Button>
            <button
              onClick={() => {
                if (isBotRunning && isOwner) { setIsBotRunning(false); setRunningTab(null); }
                else if (!isBotRunning) { setRunningTab(tabId); setIsBotRunning(true); }
              }}
              disabled={!isAuthorized || (isBotRunning && !isOwner) || (hasActiveContract && runtime.isManualTrade)}
              title={
                isBotRunning && !isOwner ? "O bot já está a operar noutra aba"
                : (hasActiveContract && runtime.isManualTrade) ? "Fecha o contrato manual antes de iniciar o bot"
                : undefined
              }
              className={cn("h-14 rounded-xl border-2 font-black uppercase text-[11px] flex items-center justify-center gap-2 transition-all duration-300 disabled:opacity-40",
                isBotRunning && isOwner ? "border-red-500/60 bg-red-500/10 text-red-400 shadow-lg shadow-red-500/20" : "border-green-500/40 bg-green-500/5 text-green-400 hover:bg-green-500/15")}>
              <Power className={cn("w-5 h-5", isBotRunning && isOwner && "animate-pulse")} />
              {isBotRunning && isOwner ? "Stop" : "Start"}
            </button>
          </div>

          {showCooldownBanner && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <p className="text-[10px] font-bold leading-tight">Cooldown de risco activo — retoma em {cooldownRemainingSec}s</p>
            </div>
          )}
        </div>

        {/* ══ COLUNA DIREITA ══════════════════════════════════════════════ */}
        <div className="flex flex-col gap-3 min-w-0">

          <NeonCard variant="blue" className="p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                {isUp ? <ArrowUpRight className="text-cyan-400 w-5 h-5 shrink-0" /> : <ArrowDownRight className="text-pink-400 w-5 h-5 shrink-0" />}
                <span className={cn("text-xl font-black tracking-tighter", isUp ? "text-cyan-400" : "text-pink-400")}>
                  {currentPrice ? currentPrice.toFixed(2) : "---"}
                </span>
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/40 text-[8px]">LIVE</Badge>
              </div>
              <div className="flex gap-2">
                <Select value={symbol} onValueChange={setSymbol}>
                  <SelectTrigger className="bg-black/20 border-white/10 h-8 text-[11px] w-[140px] md:w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#111114] border-white/10 text-white">
                    {SYMBOLS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={String(timeframe)} onValueChange={(v) => setTimeframe(Number(v))}>
                  <SelectTrigger className="bg-black/20 border-white/10 h-8 text-[11px] w-16"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#111114] border-white/10 text-white">
                    <SelectItem value="1">1s</SelectItem>
                    <SelectItem value="3">3s</SelectItem>
                    <SelectItem value="5">5s</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <ErrorBoundary fallbackLabel="Erro no Gráfico">
              <TradingChart candles={candles} symbol={symbol} />
            </ErrorBoundary>
          </NeonCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <NeonCard variant="blue" className="p-4 flex flex-col" style={{ height: "280px" }}>
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-2 shrink-0">Atividade em Tempo Real</p>
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5"
                style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(59,130,246,0.3) transparent", overscrollBehavior: "contain" }}>
                <AnimatePresence initial={false}>
                  {accuHistory.length === 0 ? (
                    <div className="flex items-center justify-center h-full opacity-20">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Sem operações</p>
                    </div>
                  ) : accuHistory.slice(0, 30).map((trade) => (
                    <motion.div key={trade.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/5 border border-white/8">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[8px] font-black shrink-0",
                          trade.status === "WON" ? "bg-green-500/15 text-green-400"
                          : trade.status === "LOST" ? "bg-red-500/15 text-red-400"
                          : "bg-amber-500/15 text-amber-400")}>
                          {trade.status === "WON" ? "W" : trade.status === "LOST" ? "L" : "…"}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[9px] font-black text-white truncate">ACCU</p>
                            <span className="text-[8px] text-muted-foreground truncate">{trade.symbol}</span>
                          </div>
                          <p className="text-[8px] text-muted-foreground">{new Date(trade.time).toLocaleTimeString()}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[8px] text-muted-foreground">Stake ${Number(trade.stake || 0).toFixed(2)}</p>
                        <span className={cn("text-[10px] font-black",
                          trade.status === "PENDING" ? "text-amber-400" : Number(trade.profit || 0) > 0 ? "text-green-400" : "text-red-400")}>
                          {trade.status === "PENDING" ? "Pendente" : `${Number(trade.profit || 0) >= 0 ? "+" : ""}$${Number(trade.profit || 0).toFixed(2)}`}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </NeonCard>

            <NeonCard variant="purple" className="p-4 flex flex-col" style={{ height: "280px" }}>
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-2 shrink-0">Logs em Tempo Real</p>
              <div ref={logsContainerRef} className="flex-1 overflow-y-auto font-mono"
                style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(124,58,237,0.3) transparent", overscrollBehavior: "contain" }}>
                {logEntries.length === 0 ? (
                  <div className="flex items-center justify-center h-full opacity-20">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Sem logs</p>
                  </div>
                ) : logEntries.map((e) => (
                  <div key={e.id} className="flex gap-1.5 py-0.5 border-b border-white/3">
                    <span className="text-[8px] text-muted-foreground/40 shrink-0 tabular-nums">
                      {new Date(e.time).toLocaleTimeString("pt", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span className={cn("text-[9px] leading-tight break-all", logColors[e.level] || "text-white")}>{e.message}</span>
                  </div>
                ))}
                <div />
              </div>
            </NeonCard>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {modal.show && <ResultModal type={modal.type} amount={modal.amount} onClose={closeModal} />}
      </AnimatePresence>

      <AnimatePresence>
        {showConfig && <AccumulatorsConfigModal onClose={() => setShowConfig(false)} />}
      </AnimatePresence>
    </>
  );
};
