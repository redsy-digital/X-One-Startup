import React, { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpDown, ArrowUpRight, Check, Menu, Pause, Play, Power, Target, X, WalletCards, ShieldCheck, Activity, LineChart as LineChartIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../components/ui/select";
import { NeonCard } from "../components/NeonCard";
import { Badge } from "../components/ui/badge";
import { TradingChart } from "../components/TradingChart";
import { SYMBOLS } from "../constants";
import { cn } from "../lib/utils";
import { getTradeHistory } from "../lib/storage";
import { useBotStore, useMarketStore, useSettingsStore } from "../store";
import { useSyntheticTabsStore, type SyntheticOperationTab } from "../synthetic/tabs";
import { useSessionStore } from "../store/useSessionStore";
import { logger, type LogEntry } from "../lib/logger";
import type { TradeHistory } from "../types";

const Stepper = ({ label, value, onPrevious, onNext, disabled, disabledPrevious, disabledNext }: { label: string; value: string; onPrevious: () => void; onNext: () => void; disabled?: boolean; disabledPrevious?: boolean; disabledNext?: boolean }) => (
  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
    <p className="text-[8px] uppercase tracking-widest text-muted-foreground font-black mb-2">{label}</p>
    <div className="flex items-center justify-between gap-2">
      <button type="button" disabled={disabled || disabledPrevious} onClick={onPrevious} className="w-8 h-8 rounded-lg border border-white/10 text-white hover:bg-white/10 disabled:opacity-20">−</button>
      <span className="text-[11px] font-black text-white text-center">{value}</span>
      <button type="button" disabled={disabled || disabledNext} onClick={onNext} className="w-8 h-8 rounded-lg border border-white/10 text-white hover:bg-white/10 disabled:opacity-20">+</button>
    </div>
  </div>
);

const Toggle = ({ active, disabled, title, description, onClick }: { active: boolean; disabled: boolean; title: string; description: string; onClick: () => void }) => (
  <button type="button" disabled={disabled} onClick={onClick} className={cn("w-full rounded-xl border p-3 text-left transition-all", active ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-white/[0.03]", disabled && "opacity-50 cursor-not-allowed")}>
    <div className="flex items-center gap-3">
      <div className={cn("w-5 h-5 rounded-md border flex items-center justify-center", active ? "border-emerald-400 bg-emerald-500/20" : "border-white/20 bg-black/20")}>{active && <span className="text-emerald-300 text-[11px] font-black">✓</span>}</div>
      <div><p className="text-[11px] font-black text-white">{title}</p><p className="text-[9px] text-muted-foreground mt-0.5">{description}</p></div>
    </div>
  </button>
);

const RiseFallResultModal = ({ type, amount, onClose }: { type: "profit" | "loss"; amount: number; onClose: () => void }) => (
  <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
    <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={cn("w-full max-w-xs rounded-2xl p-7 text-center border shadow-2xl", type === "profit" ? "bg-green-950/90 border-green-500/40" : "bg-red-950/90 border-red-500/40")}>
      <div className={cn("mx-auto w-14 h-14 rounded-full flex items-center justify-center border mb-4", type === "profit" ? "border-green-400/30 bg-green-500/10" : "border-red-400/30 bg-red-500/10")}><ShieldCheck className={cn("w-7 h-7", type === "profit" ? "text-green-400" : "text-red-400")} /></div>
      <p className={cn("text-xl font-black uppercase tracking-wide", type === "profit" ? "text-green-400" : "text-red-400")}>{type === "profit" ? "Take Profit atingido" : "Stop Loss atingido"}</p>
      <p className={cn("text-3xl font-black mt-2", type === "profit" ? "text-green-300" : "text-red-300")}>{amount >= 0 ? "+" : ""}${Math.abs(amount).toFixed(2)}</p>
      <Button onClick={onClose} className={cn("w-full mt-6 font-black uppercase h-11", type === "profit" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700")}>Fechar</Button>
    </motion.div>
  </div>
);

const RiseFallStrategiesModal = ({ onClose }: { onClose: () => void }) => {
  const { settings: s, updateSettings } = useSettingsStore();
  const disabled = useBotStore.getState().isBotRunning && !useBotStore.getState().isBotPaused;
  return (
    <div className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm bg-[#111114] border border-emerald-500/20 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5"><p className="font-black text-sm uppercase tracking-widest flex items-center gap-2 text-white"><Target className="w-4 h-4 text-emerald-400" /> Estratégias Rise/Fall</p><Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground"><X className="w-4 h-4" /></Button></div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <Toggle active={s.riseFallSequenceEnabled} disabled={disabled} onClick={() => updateSettings({ riseFallSequenceEnabled: !s.riseFallSequenceEnabled })} title="Sequência de Direção" description="N altas consecutivas → Fall; N baixas consecutivas → Rise. O trigger ocorre no próprio tick que completa a sequência." />
          {s.riseFallSequenceEnabled && <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Stepper label="Sequência" value={`${s.riseFallSequenceLength} ticks`} disabled={disabled} disabledPrevious={s.riseFallSequenceLength <= 1} disabledNext={s.riseFallSequenceLength >= 100} onPrevious={() => updateSettings({ riseFallSequenceLength: Math.max(1, s.riseFallSequenceLength - 1) })} onNext={() => updateSettings({ riseFallSequenceLength: Math.min(100, s.riseFallSequenceLength + 1) })} /><Stepper label="Entrada" value={s.riseFallSequenceLength === 1 ? "no 1.º" : "no N.º"} disabled={true} onPrevious={() => {}} onNext={() => {}} /></div><p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[9px] text-muted-foreground leading-relaxed">Padrão: <b className="text-white">4 direções iguais</b>. Quatro UP → entrada PUT (Fall). Quatro DOWN → entrada CALL (Rise).</p></div>}

          <Toggle active={s.riseFallBlockDensityEnabled} disabled={disabled} onClick={() => updateSettings({ riseFallBlockDensityEnabled: !s.riseFallBlockDensityEnabled })} title="Densidade de Bloco" description="Avalia a proporção de UP/DOWN numa janela curta e entra na direção minoritária observada." />
          {s.riseFallBlockDensityEnabled && <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Stepper label="Janela" value={`${s.riseFallBlockWindow} ticks`} disabled={disabled} disabledPrevious={s.riseFallBlockWindow <= 2} disabledNext={s.riseFallBlockWindow >= 100} onPrevious={() => updateSettings({ riseFallBlockWindow: Math.max(2, s.riseFallBlockWindow - 1) })} onNext={() => updateSettings({ riseFallBlockWindow: Math.min(100, s.riseFallBlockWindow + 1) })} /><Stepper label="Limiar" value={`${s.riseFallBlockThreshold.toFixed(0)}%`} disabled={disabled} disabledPrevious={s.riseFallBlockThreshold <= 50} disabledNext={s.riseFallBlockThreshold >= 100} onPrevious={() => updateSettings({ riseFallBlockThreshold: Math.max(50, s.riseFallBlockThreshold - 1) })} onNext={() => updateSettings({ riseFallBlockThreshold: Math.min(100, s.riseFallBlockThreshold + 1) })} /></div><p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[9px] text-muted-foreground leading-relaxed">Padrão: <b className="text-white">10 ticks / 80%</b>. Ex.: 8 DOWN + 2 UP → entrada CALL (Rise).</p></div>}

          <Toggle active={s.riseFallPercentChannelEnabled} disabled={disabled} onClick={() => updateSettings({ riseFallPercentChannelEnabled: !s.riseFallPercentChannelEnabled })} title="Estratégia do Canal Percentual Dinâmico" description="Canal Highest High / Lowest Low / Center Line. Configura quantos ticks consecutivos confirmam o sinal." />
          {s.riseFallPercentChannelEnabled && <div className="space-y-3 rounded-xl border border-white/10 p-3"><div className="grid grid-cols-2 gap-3"><Stepper label="Janela deslizante" value={`${s.riseFallPercentChannelWindow} ticks`} disabled={disabled} disabledPrevious={s.riseFallPercentChannelWindow <= 5} disabledNext={s.riseFallPercentChannelWindow >= 500} onPrevious={() => updateSettings({ riseFallPercentChannelWindow: Math.max(5, s.riseFallPercentChannelWindow - 1) })} onNext={() => updateSettings({ riseFallPercentChannelWindow: Math.min(500, s.riseFallPercentChannelWindow + 1) })} /><Stepper label="Sequência direcional" value={`${s.riseFallPercentChannelSequenceLength} ticks`} disabled={disabled} disabledPrevious={s.riseFallPercentChannelSequenceLength <= 1} disabledNext={s.riseFallPercentChannelSequenceLength >= 100} onPrevious={() => updateSettings({ riseFallPercentChannelSequenceLength: Math.max(1, s.riseFallPercentChannelSequenceLength - 1) })} onNext={() => updateSettings({ riseFallPercentChannelSequenceLength: Math.min(100, s.riseFallPercentChannelSequenceLength + 1) })} /><Stepper label="Threshold" value={`${s.riseFallPercentChannelThreshold}%`} disabled={disabled} disabledPrevious={s.riseFallPercentChannelThreshold <= 1} disabledNext={s.riseFallPercentChannelThreshold >= 99} onPrevious={() => updateSettings({ riseFallPercentChannelThreshold: Math.max(1, s.riseFallPercentChannelThreshold - 1) })} onNext={() => updateSettings({ riseFallPercentChannelThreshold: Math.min(99, s.riseFallPercentChannelThreshold + 1) })} /></div><Toggle active={s.riseFallMomentumFilterEnabled} disabled={disabled} onClick={() => updateSettings({ riseFallMomentumFilterEnabled: !s.riseFallMomentumFilterEnabled })} title="Momentum Filter (exaustão)" description="Exige que a variação do 3.º tick seja menor que a do 1.º e do 2.º." /><Toggle active={s.riseFallTrendProtectionEnabled} disabled={disabled} onClick={() => updateSettings({ riseFallTrendProtectionEnabled: !s.riseFallTrendProtectionEnabled })} title="Trend Protection" description="Após LOSS, bloqueia reentradas na mesma direção até a sequência direcional quebrar." /><p className="text-[9px] text-muted-foreground">Linhas do canal: máximo verde, mínimo vermelho e centro azul. A entrada exige {s.riseFallPercentChannelSequenceLength} movimentos consecutivos na zona correspondente.</p></div>}

          <Toggle active={s.riseFallSustainableInertiaEnabled} disabled={disabled} onClick={() => updateSettings({ riseFallSustainableInertiaEnabled: !s.riseFallSustainableInertiaEnabled })} title="Estratégia de Inércia Direcional Sustentável" description="Janela de 15 ticks: 10 para extremos e 5 para confirmar o gradiente. Exige rompimento e pelo menos 4/5 direções concordantes." />
          {s.riseFallSustainableInertiaEnabled && <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2"><p className="text-[10px] text-white font-bold">Configuração de confirmação: 10 + 5 ticks</p><p className="text-[9px] text-muted-foreground leading-relaxed">RISE: preço acima do máximo dos primeiros 10 ticks + pelo menos 4/5 movimentos de alta. FALL: preço abaixo do mínimo + pelo menos 4/5 movimentos de baixa. A duração do contrato é definida no menu do gráfico; recomenda-se 3 ticks ou mais para esta estratégia.</p><p className="text-[9px] text-blue-300">Visualização: resistência verde tracejada, suporte vermelho tracejado e gradiente azul.</p></div>}

          <Toggle active={s.riseFallAlternatingEnabled} disabled={disabled} onClick={() => updateSettings({ riseFallAlternatingEnabled: !s.riseFallAlternatingEnabled })} title="Filtro de Alternância" description="Detecta alternância estrita UP/DOWN e quebra o padrão repetindo a direção do último tick." />
          {s.riseFallAlternatingEnabled && <div className="space-y-3"><Stepper label="Alternância" value={`${s.riseFallAlternatingLength} ticks`} disabled={disabled} disabledPrevious={s.riseFallAlternatingLength <= 2} disabledNext={s.riseFallAlternatingLength >= 20} onPrevious={() => updateSettings({ riseFallAlternatingLength: Math.max(2, s.riseFallAlternatingLength - 1) })} onNext={() => updateSettings({ riseFallAlternatingLength: Math.min(20, s.riseFallAlternatingLength + 1) })} /><p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[9px] text-muted-foreground leading-relaxed">Padrão: <b className="text-white">4 ticks</b>. UP → DOWN → UP → DOWN gera PUT; DOWN → UP → DOWN → UP gera CALL.</p></div>}
        </div>
        <div className="px-5 pb-5"><Button onClick={onClose} className="w-full bg-emerald-600 hover:bg-emerald-700 font-black uppercase h-10">Guardar e Fechar</Button></div>
      </motion.div>
    </div>
  );
};

const RiseFallRiskModal = ({ onClose }: { onClose: () => void }) => {
  const { settings: s, updateSettings } = useSettingsStore();
  const disabled = useBotStore.getState().isBotRunning && !useBotStore.getState().isBotPaused;
  const field = (label: string, key: keyof typeof s, step: string, min: number) => (
    <div className="space-y-1">
      <label className="text-[9px] text-muted-foreground uppercase font-black">{label}</label>
      <Input type="number" step={step} min={min} value={s[key] as number} disabled={disabled} onChange={e => { const n = Number(e.target.value); if (!Number.isFinite(n)) return; updateSettings({ [key]: Math.max(min, n) } as Partial<typeof s>); }} className="bg-black/30 border-white/10 h-9 text-[11px]" />
    </div>
  );
  return <div className="fixed inset-0 z-[225] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-sm p-4">
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm bg-[#111114] border border-emerald-500/20 rounded-2xl shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5"><p className="font-black text-sm uppercase tracking-widest flex items-center gap-2 text-white"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Gestão de Risco</p><Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground"><X className="w-4 h-4" /></Button></div>
      <div className="p-5 space-y-4 max-h-[78vh] overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          {field("Stake inicial ($)", "stake", "0.01", 0.35)}
          {field("Take Profit ($)", "targetProfit", "0.01", 0)}
          {field("Stop Loss ($)", "stopLoss", "0.01", 0)}
          {field("Máx. perdas seg.", "maxConsecutiveLosses", "1", 1)}
          {field("Cooldown após perdas (s)", "cooldownAfterLoss", "1", 0)}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
          <div className="flex items-center justify-between"><div><p className="text-[11px] font-black text-white">Martingale</p><p className="text-[9px] text-muted-foreground mt-0.5">Aumenta a stake apenas após LOSS.</p></div><button type="button" disabled={disabled} onClick={() => updateSettings({ useMartingale: !s.useMartingale })} className={cn("w-11 h-6 rounded-full p-1 transition-all", s.useMartingale ? "bg-emerald-500" : "bg-white/10")}><span className={cn("block w-4 h-4 rounded-full bg-white transition-transform", s.useMartingale ? "translate-x-5" : "translate-x-0")} /></button></div>
          {s.useMartingale && <div className="grid grid-cols-2 gap-3">{field("Steps máximos", "maxMartingaleSteps", "1", 0)}{field("Multiplicador", "martingaleMultiplier", "0.1", 1)}</div>}
        </div>
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3 text-[9px] text-muted-foreground leading-relaxed">O Take Profit e o Stop Loss são limites da sessão. Ao atingir um deles, o motor encerra novas entradas e abre o modal de resultado.</div>
      </div>
      <div className="px-5 pb-5"><Button onClick={onClose} className="w-full bg-emerald-600 hover:bg-emerald-700 font-black uppercase h-10">Guardar e Fechar</Button></div>
    </motion.div>
  </div>;
};

const RiseFallChartSettings = ({ symbol, durationTicks, chartType, candles, disabled, onSave, percentChannel, sustainableInertia }: { symbol: string; durationTicks: number; chartType: "candles" | "line"; candles: any[]; disabled: boolean; percentChannel?: { upper: number; lower: number; center: number } | null; sustainableInertia?: { resistance: number; support: number; trendline: { time: number; value: number }[] } | null; onSave: (symbol: string, duration: number, chartType: "candles" | "line") => void }) => {
  const [editing, setEditing] = useState(false);
  const [draftSymbol, setDraftSymbol] = useState(symbol);
  const [draftDuration, setDraftDuration] = useState(String(durationTicks));
  const [draftChartType, setDraftChartType] = useState<"candles" | "line">(chartType);
  const open = () => { setDraftSymbol(symbol); setDraftDuration(String(durationTicks)); setDraftChartType(chartType); setEditing(true); };
  const save = () => { const duration = Math.max(1, Math.min(100, Math.round(Number(draftDuration) || 3))); onSave(draftSymbol, duration, draftChartType); setEditing(false); };
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Gráfico Rise/Fall</p><p className="text-[10px] text-white font-black mt-1 truncate">{symbol} · {durationTicks} ticks/candle</p></div><button type="button" disabled={disabled} onClick={editing ? save : open} className="h-9 w-9 shrink-0 rounded-lg border border-white/10 bg-black/20 text-muted-foreground hover:text-white hover:border-emerald-500/40 flex items-center justify-center disabled:opacity-30">{editing ? <Check className="w-4 h-4 text-green-400" /> : <Menu className="w-4 h-4" />}</button></div>
    {editing ? <div className="rounded-xl border border-emerald-500/20 bg-black/20 p-4 space-y-4"><div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><div className="space-y-1"><label className="text-[9px] text-muted-foreground uppercase font-black">Duração dos candles</label><Input type="number" min={1} max={100} value={draftDuration} onChange={e => setDraftDuration(e.target.value)} className="bg-black/30 border-white/10 h-10 text-[11px]" /></div><div className="space-y-1"><label className="text-[9px] text-muted-foreground uppercase font-black">Ativo</label><Select value={draftSymbol} onValueChange={setDraftSymbol}><SelectTrigger className="w-full bg-black/30 border-white/10 h-10 text-[11px]"><span className="flex-1 text-left truncate">{SYMBOLS.find(x => x.value === draftSymbol)?.label ?? draftSymbol}</span></SelectTrigger><SelectContent className="bg-[#111114] border-white/10 text-white">{SYMBOLS.map(x => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><label className="text-[9px] text-muted-foreground uppercase font-black">Tipo de gráfico</label><Select value={draftChartType} onValueChange={v => setDraftChartType(v as "candles" | "line")}><SelectTrigger className="w-full bg-black/30 border-white/10 h-10 text-[11px]"><span className="flex-1 text-left">{draftChartType === "candles" ? "Gráfico de velas" : "Gráfico de linha"}</span></SelectTrigger><SelectContent className="bg-[#111114] border-white/10 text-white"><SelectItem value="candles">Gráfico de velas</SelectItem><SelectItem value="line">Gráfico de linha</SelectItem></SelectContent></Select></div></div><p className="text-[8px] text-muted-foreground/70">Histórico: 1.000 ticks brutos. A duração apenas reagrupa esses ticks localmente.</p></div> : null}
    {!editing && <TradingChart candles={candles} symbol={symbol} chartType={chartType} showIndicators={false} showSymbolLabel={false} percentChannel={percentChannel} sustainableInertia={sustainableInertia} />}
  </div>;
};

export const RiseFallDashboard = ({ tab }: { tab: SyntheticOperationTab }) => {
  const { settings, updateSettings } = useSettingsStore();
  const { isBotRunning, isBotPaused, setIsBotRunning, pauseBot, resumeBot } = useBotStore();
  const { symbol, setSymbol, timeframe, setTimeframe, ticks, candles, historicalTicksLoading, historicalTicksError } = useMarketStore();
  const { setTabSymbol, setRunningTabId, runningTabId } = useSyntheticTabsStore();
  const { wins, losses, pnl, modal, closeModal } = useSessionStore();
  const [showStrategies, setShowStrategies] = useState(false);
  const [showRisk, setShowRisk] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>(() => logger.getAll().filter(e => /Rise\/Fall/i.test(e.message)));
  const [logsAtBottom, setLogsAtBottom] = useState(true);
  const [history, setHistory] = useState<TradeHistory[]>(() => getTradeHistory());
  const current = ticks[ticks.length - 1]?.price ?? null;
  const previous = ticks[ticks.length - 2]?.price ?? null;
  const direction = current != null && previous != null ? (current > previous ? "UP" : current < previous ? "DOWN" : "FLAT") : "FLAT";
  const runningThisTab = isBotRunning && runningTabId === tab.id;
  const chartType = settings.riseFallChartType;
  const controlsLocked = isBotRunning && !isBotPaused;
  const strategiesActive = settings.riseFallSequenceEnabled || settings.riseFallBlockDensityEnabled || settings.riseFallAlternatingEnabled || settings.riseFallPercentChannelEnabled || settings.riseFallSustainableInertiaEnabled;
  const percentChannel = useMemo(() => { if (!settings.riseFallPercentChannelEnabled || ticks.length < 2) return null; const tail = ticks.slice(-settings.riseFallPercentChannelWindow); const prices = tail.map((t: any) => Number(t.price)).filter(Number.isFinite); if (prices.length < 2) return null; const high = Math.max(...prices); const low = Math.min(...prices); if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return null; return { upper: high, lower: low, center: (high + low) / 2 }; }, [ticks, settings.riseFallPercentChannelEnabled, settings.riseFallPercentChannelWindow]);
  const sustainableInertiaOverlay = useMemo(() => {
    if (!settings.riseFallSustainableInertiaEnabled || ticks.length < 15) return null;
    const window = ticks.slice(-15);
    const observation = window.slice(0, 10);
    const prices = observation.map(t => Number(t.price)).filter(Number.isFinite);
    if (prices.length < 10) return null;
    const trend = window.slice(-5).map(t => ({ time: Math.floor(Number(t.time)) as any, value: Number(t.price) })).filter(p => Number.isFinite(p.time) && Number.isFinite(p.value));
    return { resistance: Math.max(...prices), support: Math.min(...prices), trendline: trend.length >= 2 ? trend : [] };
  }, [ticks, settings.riseFallSustainableInertiaEnabled]);
  const rfHistory = useMemo(() => history.filter(t => t.market === "synthetic" && (t.type === "CALL" || t.type === "PUT")).slice(0, 30), [history]);
  useEffect(() => { const h = () => setHistory(getTradeHistory()); window.addEventListener("trade_history_updated", h); return () => window.removeEventListener("trade_history_updated", h); }, []);
  useEffect(() => { const unsub = logger.subscribe(entry => { if (!entry) { setLogEntries([]); return; } if (/Rise\/Fall/i.test(entry.message)) setLogEntries(prev => [...prev, entry]); }); return unsub; }, []);
  useEffect(() => { if (tab.symbol !== settings.riseFallSymbol) setTabSymbol(tab.id, settings.riseFallSymbol); }, [tab.id, tab.symbol, settings.riseFallSymbol, setTabSymbol]);
  useEffect(() => { if (symbol !== tab.symbol) setSymbol(tab.symbol); }, [symbol, tab.symbol, setSymbol]);
  useEffect(() => { if (timeframe !== settings.riseFallDurationTicks) setTimeframe(settings.riseFallDurationTicks); }, [timeframe, settings.riseFallDurationTicks, setTimeframe]);

  const saveChartSettings = (nextSymbol: string, duration: number, nextChartType: "candles" | "line") => {
    updateSettings({ riseFallSymbol: nextSymbol, riseFallDurationTicks: duration, riseFallChartType: nextChartType });
    if (nextSymbol !== symbol) { setTabSymbol(tab.id, nextSymbol); setSymbol(nextSymbol); }
    if (duration !== timeframe) setTimeframe(duration);
  };

  return <>
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 min-h-0">
      <div className="flex flex-col gap-3">
        <NeonCard variant="blue" className="p-4 space-y-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><ArrowUpDown className="w-4 h-4 text-emerald-400" /><p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Rise/Fall</p></div><Badge className={cn(isBotPaused ? "bg-amber-500/10 text-amber-300" : isBotRunning ? "bg-green-500/10 text-green-300" : "bg-white/5 text-muted-foreground")}>{isBotPaused ? "PAUSADO" : isBotRunning ? "OPERANDO" : "PARADO"}</Badge></div><div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[8px] text-muted-foreground uppercase">Direção atual</p><p className={cn("text-lg font-black mt-1", direction === "UP" ? "text-emerald-400" : direction === "DOWN" ? "text-red-400" : "text-white")}>{direction === "UP" ? "RISE" : direction === "DOWN" ? "FALL" : "—"}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[8px] text-muted-foreground uppercase">Duração</p><p className="text-lg font-black text-white mt-1">{settings.riseFallDurationTicks}t</p></div></div><div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-3"><p className="text-[8px] uppercase text-muted-foreground">Contrato base</p><p className="text-sm font-black text-white mt-1">{settings.riseFallContract === "CALL" ? "Rise" : "Fall"}</p></div></NeonCard>

        <NeonCard variant="purple" className="p-4 space-y-3"><div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[8px] text-muted-foreground uppercase">Wins</p><p className="text-lg font-black text-green-400">{wins}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[8px] text-muted-foreground uppercase">Losses</p><p className="text-lg font-black text-red-400">{losses}</p></div></div><div className="flex items-center justify-between"><span className="text-[8px] uppercase text-muted-foreground font-black">P/L da sessão</span><span className={cn("text-sm font-black", pnl >= 0 ? "text-green-400" : "text-red-400")}>{pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}</span></div></NeonCard>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><Button variant="outline" onClick={() => setShowStrategies(true)} disabled={isBotRunning && !isBotPaused && !runningThisTab} className={cn("h-14 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 gap-2 font-black uppercase text-[10px]", strategiesActive && "bg-emerald-500/10 border-emerald-400/60")}><Target className="w-4 h-4" /> Estratégias</Button><Button variant="outline" onClick={() => setShowRisk(true)} disabled={controlsLocked} className="h-14 border-amber-500/40 text-amber-300 hover:bg-amber-500/10 gap-2 font-black uppercase text-[10px]"><ShieldCheck className="w-4 h-4" /> Risco</Button><button type="button" disabled={isBotRunning && !runningThisTab} onClick={() => { if (runningThisTab) { setIsBotRunning(false); setRunningTabId(null); } else { setRunningTabId(tab.id); setIsBotRunning(true); } }} className={cn("h-14 rounded-xl border-2 font-black uppercase text-[10px] flex items-center justify-center gap-2 disabled:opacity-40", runningThisTab ? "border-red-500/60 bg-red-500/10 text-red-400" : "border-green-500/40 bg-green-500/5 text-green-400")}><Power className="w-4 h-4" />{runningThisTab ? "Stop" : "Start"}</button></div>
        {runningThisTab && <Button onClick={() => isBotPaused ? resumeBot() : pauseBot()} variant="outline" className={cn("h-12 w-full font-black uppercase text-[10px]", isBotPaused ? "border-green-500/40 text-green-400" : "border-amber-500/40 text-amber-300")}>{isBotPaused ? <><Play className="w-4 h-4 mr-2" /> Continuar</> : <><Pause className="w-4 h-4 mr-2" /> Pausar</>}</Button>}
      </div>

      <div className="flex flex-col gap-3 min-w-0">
        <NeonCard variant="purple" className="p-4"><div className="flex items-center justify-between gap-3 mb-3"><div><p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Índice Sintético</p><p className="text-[10px] text-white font-black mt-1">{symbol} · {settings.riseFallDurationTicks}t · {chartType === "candles" ? "Velas" : "Linha"}</p></div></div>{historicalTicksLoading ? <div className="h-[280px] flex items-center justify-center"><p className="text-[10px] uppercase tracking-widest text-muted-foreground animate-pulse">A carregar 1.000 ticks...</p></div> : historicalTicksError ? <div className="h-[280px] flex items-center justify-center text-center"><p className="text-[10px] text-red-300">{historicalTicksError}</p></div> : <RiseFallChartSettings symbol={symbol} durationTicks={settings.riseFallDurationTicks} chartType={chartType} candles={candles} percentChannel={percentChannel} sustainableInertia={sustainableInertiaOverlay} disabled={controlsLocked} onSave={saveChartSettings} />}</NeonCard>

        <NeonCard variant="blue" className="p-4 space-y-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Activity className="w-4 h-4 text-blue-400" /><p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Operação em tempo real</p></div><Badge className={isBotRunning ? "bg-amber-500/10 text-amber-300" : "bg-white/5 text-muted-foreground"}>{isBotRunning && !isBotPaused ? "OPERANDO" : isBotPaused ? "PAUSADO" : "AGUARDANDO"}</Badge></div><div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[8px] text-muted-foreground uppercase">Última entrada</p><p className="text-sm font-black text-white mt-1">{rfHistory[0] ? (rfHistory[0].type === "CALL" ? "Rise" : "Fall") : "—"}</p></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[8px] text-muted-foreground uppercase">Stake base</p><p className="text-sm font-black text-white mt-1">${settings.stake.toFixed(2)}</p></div></div><p className="text-[9px] text-muted-foreground">Uma entrada aparece como <b className="text-amber-300">Pendente</b> imediatamente após o BUY e só muda para WIN/LOSS quando o contrato é confirmado.</p></NeonCard>

        <NeonCard variant="blue" className="p-4"><div className="flex items-center justify-between mb-2"><p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Atividade Rise/Fall</p><span className="text-[8px] text-muted-foreground">{rfHistory.length} registos</span></div><div className="max-h-[280px] overflow-y-auto space-y-1.5">{rfHistory.length === 0 ? <p className="text-[9px] text-muted-foreground text-center py-8">Sem operações Rise/Fall.</p> : rfHistory.map(t => <div key={t.id} className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5"><div className="flex items-center gap-2"><div className={cn("w-7 h-7 rounded-md flex items-center justify-center", t.type === "CALL" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>{t.type === "CALL" ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}</div><div><p className="text-[9px] font-black text-white">{t.type === "CALL" ? "Rise" : "Fall"}</p><p className="text-[8px] text-muted-foreground">{t.symbol} · {new Date(t.time).toLocaleTimeString()}</p></div></div><span className={cn("text-[10px] font-black", t.status === "WON" ? "text-green-400" : t.status === "LOST" ? "text-red-400" : "text-amber-400")}>{t.status === "PENDING" ? "Pendente" : `${Number(t.profit || 0) >= 0 ? "+" : ""}$${Number(t.profit || 0).toFixed(2)}`}</span></div>)}</div></NeonCard>

        <NeonCard variant="purple" className="p-4 flex flex-col h-[280px]">
          <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><LineChartIcon className="w-4 h-4 text-purple-400" /><p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Logs Rise/Fall</p></div><span className="text-[8px] text-muted-foreground">{logEntries.length}</span></div>
          <div className="flex-1 min-h-0 overflow-y-auto font-mono pr-1" onScroll={e => { const el=e.currentTarget; setLogsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24); }}>
            {logEntries.length === 0 ? <div className="h-full flex items-center justify-center opacity-20"><p className="text-[10px] uppercase font-bold text-muted-foreground">Sem logs</p></div> : logEntries.map(e => <div key={e.id} className="flex gap-1.5 py-0.5 border-b border-white/3"><span className="text-[8px] text-muted-foreground/40 shrink-0 tabular-nums">{new Date(e.time).toLocaleTimeString("pt", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><span className={cn("text-[9px] leading-tight break-all", e.level === "error" ? "text-red-400" : e.level === "risk" ? "text-amber-300" : e.level === "trade" ? "text-green-400" : e.level === "signal" ? "text-cyan-300" : "text-white/70")}>{e.message}</span></div>)}
          </div>
        </NeonCard>
      </div>
    </div>
    <AnimatePresence>
      {showRisk && <RiseFallRiskModal onClose={() => setShowRisk(false)} />}
      {showStrategies && <RiseFallStrategiesModal onClose={() => setShowStrategies(false)} />}
      {modal.show && <RiseFallResultModal type={modal.type} amount={modal.amount} onClose={closeModal} />}
    </AnimatePresence>
  </>;
};
