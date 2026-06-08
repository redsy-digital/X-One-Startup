import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Power, Settings2, ArrowUpRight, ArrowDownRight,
  TrendingUp, TrendingDown, X, ChevronDown
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
import { BotControls } from "../components/BotControls";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SYMBOLS } from "../constants";
import { logger, LogEntry } from "../lib/logger";
import {
  useConnectionStore, useBotStore, useMarketStore,
  useHistoryStore, useSettingsStore, useSignalStore
} from "../store";

// ── Hook: timer de sessão ─────────────────────────────────────────────────────
function useSessionTimer(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      startRef.current = Date.now() - elapsed * 1000;
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current!) / 1000));
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (!running) setElapsed(0);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const s = String(elapsed % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ── Hook: entradas do logger ──────────────────────────────────────────────────
function useLogEntries(max = 80) {
  const [entries, setEntries] = useState<LogEntry[]>(() => logger.getAll().slice(-max));
  useEffect(() => {
    const unsub = logger.subscribe((entry) => {
      if (!entry) { setEntries([]); return; }
      setEntries(prev => [...prev.slice(-(max - 1)), entry]);
    });
    return unsub;
  }, [max]);
  return entries;
}

// ── Modal de Acertos (configurações) ─────────────────────────────────────────
const AcertosModal = ({ onClose }: { onClose: () => void }) => {
  const { settings, updateSettings, changeProfile } = useSettingsStore();
  const s = settings;

  const field = (label: string, key: keyof typeof s, type = "number", step?: string) => (
    <div className="space-y-1">
      <label className="text-[9px] text-muted-foreground uppercase font-black">{label}</label>
      <Input type={type} step={step} value={s[key] as number}
        onChange={e => updateSettings({ [key]: Number(e.target.value) })}
        className="bg-black/30 border-white/10 h-8 text-[11px]" />
    </div>
  );

  const toggle = (label: string, key: keyof typeof s) => (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-muted-foreground font-bold">{label}</span>
      <Switch checked={s[key] as boolean}
        onCheckedChange={v => updateSettings({ [key]: v })} className="scale-90" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-[#111114] border border-purple-500/20 rounded-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <p className="font-black text-sm uppercase tracking-widest text-white flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-purple-400" /> Acertos
          </p>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Perfil */}
          <div className="space-y-1">
            <label className="text-[9px] text-muted-foreground uppercase font-black">Perfil da IA</label>
            <Select value={s.strategyProfile} onValueChange={(v: any) => changeProfile(v)}>
              <SelectTrigger className="bg-black/30 border-white/10 h-8 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#111114] border-white/10 text-white">
                <SelectItem value="conservative">Conservador (80%)</SelectItem>
                <SelectItem value="balanced">Equilibrado (70%)</SelectItem>
                <SelectItem value="aggressive">Agressivo (55%)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Financeiro */}
          <div className="grid grid-cols-2 gap-3">
            {field("Stake Base ($)", "stake", "number", "0.01")}
            {field("Take Profit ($)", "targetProfit", "number", "0.5")}
            {field("Stop Loss ($)", "stopLoss", "number", "0.5")}
            {field("Conf. Mínima (%)", "minConfidence")}
          </div>

          {/* Martingale */}
          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-2">
            {toggle("Martingale", "useMartingale")}
            {s.useMartingale && (
              <div className="grid grid-cols-2 gap-2">
                {field("Steps", "maxMartingaleSteps")}
                {field("Multiplicador", "martingaleMultiplier", "number", "0.1")}
              </div>
            )}
          </div>

          {/* Soros */}
          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-2">
            {toggle("Soros", "useSoros")}
            {s.useSoros && field("Níveis Soros", "maxSorosLevels")}
          </div>

          {/* Segurança */}
          <div className="grid grid-cols-2 gap-3">
            {field("Max Perdas Seg.", "maxConsecutiveLosses")}
            {field("Cooldown Loss (s)", "cooldownAfterLoss")}
          </div>
        </div>

        <div className="px-5 pb-5">
          <Button onClick={onClose}
            className="w-full bg-purple-600 hover:bg-purple-700 font-black uppercase h-10">
            Guardar e Fechar
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

// ── DashboardPage ─────────────────────────────────────────────────────────────
export const DashboardPage = () => {
  const navigate = useNavigate();
  const { isAuthorized, activeAccount, balance } = useConnectionStore();
  const { isBotRunning, setIsBotRunning } = useBotStore();
  const { symbol, setSymbol, candles, ticks, timeframe, setTimeframe } = useMarketStore();
  const { history } = useHistoryStore();
  const { settings } = useSettingsStore();
  const { lastSignal } = useSignalStore();
  const logEntries = useLogEntries(80);
  const timer = useSessionTimer(isBotRunning);
  const [showAcertos, setShowAcertos] = useState(false);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const logsScrollRef = useRef<HTMLDivElement>(null);

  // Redirecionar se sem Deriv
  useEffect(() => {
    if (!isAuthorized && !activeAccount) navigate("/");
  }, [isAuthorized, activeAccount]);

  // Auto-scroll logs para o fundo
  useEffect(() => {
    if (logsScrollRef.current) {
      logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
    }
  }, [logEntries.length]);

  // Métricas da sessão
  const sessionWins = history.filter(h => h.status === "WON").length;
  const sessionLosses = history.filter(h => h.status === "LOST").length;
  const sessionPnL = history.reduce((acc, h) => acc + (h.profit || 0), 0);
  const winRate = sessionWins + sessionLosses > 0
    ? Math.round((sessionWins / (sessionWins + sessionLosses)) * 100) : 0;

  const ind = lastSignal?.indicators;
  const currentPrice = ticks.length > 0 ? ticks[ticks.length - 1].price : null;
  const prevPrice = ticks.length > 1 ? ticks[ticks.length - 2].price : null;
  const isUp = currentPrice && prevPrice ? currentPrice >= prevPrice : true;

  // Cores do log
  const logColors: Record<string, string> = {
    system: "text-blue-400", signal: "text-purple-400", block: "text-amber-400",
    trade: "text-emerald-400", risk: "text-orange-400", error: "text-red-400"
  };

  return (
    <>
      {/* ── Layout principal ── */}
      <div className="flex flex-col lg:flex-row gap-4 h-full">

        {/* ══ COLUNA ESQUERDA ══════════════════════════════════════════════ */}
        <div className="flex flex-col gap-3 lg:w-[300px] shrink-0">

          {/* Timer + Lucro + Win/Loss */}
          <NeonCard variant="purple" className="p-4 space-y-3">
            {/* Cronómetro */}
            <div className="flex items-center justify-center">
              <div className="px-4 py-2 bg-black/40 border border-purple-500/30 rounded-xl">
                <span className="font-mono font-black text-2xl text-white tracking-widest">
                  {timer}
                </span>
              </div>
            </div>

            {/* Lucro + Win/Loss */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-center">
                <p className="text-[9px] text-muted-foreground uppercase font-black">Lucro</p>
                <p className={cn("text-lg font-black mt-0.5",
                  sessionPnL >= 0 ? "text-green-400" : "text-red-400")}>
                  {sessionPnL >= 0 ? "+" : ""}${sessionPnL.toFixed(2)}
                </p>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-center">
                <p className="text-[9px] text-muted-foreground uppercase font-black">Win / Loss</p>
                <p className="text-lg font-black mt-0.5 text-white">
                  <span className="text-green-400">{sessionWins}</span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-red-400">{sessionLosses}</span>
                </p>
              </div>
            </div>
          </NeonCard>

          {/* Métricas — Painel A */}
          <NeonCard variant="blue" className="p-4 flex-1">
            <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-3">
              Análise em Tempo Real
            </p>

            <div className="space-y-2">
              {/* Confiança */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground font-bold">Confiança IA</span>
                  <span className={cn("font-black",
                    (lastSignal?.confidence || 0) >= settings.minConfidence
                      ? "text-green-400" : "text-red-400")}>
                    {lastSignal?.confidence || 0}%
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <motion.div animate={{ width: `${lastSignal?.confidence || 0}%` }}
                    className={cn("h-full rounded-full transition-all",
                      (lastSignal?.confidence || 0) >= settings.minConfidence
                        ? "bg-gradient-to-r from-blue-500 to-green-400"
                        : "bg-gradient-to-r from-red-500 to-yellow-500")} />
                </div>
              </div>

              {/* Métricas grid */}
              {[
                { label: "Assertividade", value: `${winRate}%`, color: winRate >= 55 ? "text-green-400" : "text-yellow-400" },
                { label: "Conseq. Loss", value: String(sessionLosses), color: sessionLosses >= 3 ? "text-red-400" : "text-white" },
                { label: "Stake Actual", value: `$${settings.stake.toFixed(2)}`, color: "text-blue-400" },
                { label: "Trend Freshness", value: `${ind?.trendFreshnessScore?.toFixed(1) || "—"}/10`,
                  color: (ind?.trendFreshnessScore || 0) > 6 ? "text-green-400" : "text-amber-400" },
                { label: "Timing Quality", value: `${ind?.timingQuality?.toFixed(1) || "—"}/10`,
                  color: (ind?.timingQuality || 0) > 6 ? "text-green-400" : "text-amber-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between py-1 border-b border-white/5">
                  <span className="text-[10px] text-muted-foreground font-bold">{label}</span>
                  <span className={cn("text-[10px] font-black", color)}>{value}</span>
                </div>
              ))}

              {/* Análise Estrutural */}
              <div className="pt-1">
                <p className="text-[9px] text-muted-foreground uppercase font-black mb-1">Análise Estrutural</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge className={cn("text-[8px] font-black",
                    ind?.marketCondition === "TRENDING"
                      ? "bg-green-500/10 text-green-400 border-green-500/20"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20")}>
                    {ind?.marketCondition || "—"}
                  </Badge>
                  {lastSignal?.type !== "NEUTRAL" && lastSignal?.type && (
                    <Badge className={cn("text-[8px] font-black",
                      lastSignal.type === "CALL"
                        ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                        : "bg-pink-500/10 text-pink-400 border-pink-500/20")}>
                      {lastSignal.type === "CALL"
                        ? <><TrendingUp className="w-2.5 h-2.5 mr-0.5" /> CALL</>
                        : <><TrendingDown className="w-2.5 h-2.5 mr-0.5" /> PUT</>}
                    </Badge>
                  )}
                </div>
                {ind?.reason && (
                  <p className="text-[9px] text-blue-400/80 mt-1 leading-tight italic">
                    "{ind.reason}"
                  </p>
                )}
              </div>
            </div>
          </NeonCard>

          {/* Botões: Acertos + Power */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={() => setShowAcertos(true)}
              className="h-14 border-purple-500/40 text-purple-400 hover:bg-purple-500/10 gap-2 font-black uppercase text-[11px]"
            >
              <Settings2 className="w-4 h-4" /> Acertos
            </Button>

            {/* Botão Power — circular */}
            <button
              onClick={() => setIsBotRunning(!isBotRunning)}
              disabled={!isAuthorized}
              className={cn(
                "h-14 rounded-xl border-2 font-black uppercase text-[11px] transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-40",
                isBotRunning
                  ? "border-red-500/60 bg-red-500/10 text-red-400 shadow-lg shadow-red-500/20"
                  : "border-green-500/40 bg-green-500/5 text-green-400 hover:bg-green-500/15"
              )}
            >
              <Power className={cn("w-5 h-5", isBotRunning && "animate-pulse")} />
              {isBotRunning ? "Stop" : "Start"}
            </button>
          </div>
        </div>

        {/* ══ COLUNA DIREITA ══════════════════════════════════════════════ */}
        <div className="flex flex-col gap-3 flex-1 min-w-0">

          {/* Preço + Selector de Ativo acima do gráfico */}
          <NeonCard variant="purple" className="p-4">
            <div className="flex items-center justify-between mb-3 gap-3">
              {/* Preço actual */}
              <div className="flex items-center gap-2">
                {isUp
                  ? <ArrowUpRight className="text-cyan-400 w-5 h-5 shrink-0" />
                  : <ArrowDownRight className="text-pink-400 w-5 h-5 shrink-0" />}
                <span className={cn("text-xl font-black tracking-tighter",
                  isUp ? "text-cyan-400" : "text-pink-400")}>
                  {currentPrice ? currentPrice.toFixed(2) : "---"}
                </span>
                <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/40 text-[8px]">
                  LIVE
                </Badge>
              </div>

              {/* Selectores */}
              <div className="flex gap-2">
                <Select value={symbol} onValueChange={setSymbol}>
                  <SelectTrigger className="bg-black/20 border-white/10 h-8 text-[11px] w-[140px] md:w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111114] border-white/10 text-white">
                    {SYMBOLS.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(timeframe)} onValueChange={v => setTimeframe(Number(v))}>
                  <SelectTrigger className="bg-black/20 border-white/10 h-8 text-[11px] w-16">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111114] border-white/10 text-white">
                    <SelectItem value="1">1s</SelectItem>
                    <SelectItem value="3">3s</SelectItem>
                    <SelectItem value="5">5s</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Gráfico */}
            <ErrorBoundary fallbackLabel="Erro no Gráfico">
              <TradingChart candles={candles} symbol={symbol} />
            </ErrorBoundary>
          </NeonCard>

          {/* Histórico (2) + Logs (3) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">

            {/* Histórico em tempo real */}
            <NeonCard variant="blue" className="p-4 flex flex-col" style={{ minHeight: "260px" }}>
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-3 shrink-0">
                Histórico em Tempo Real
              </p>
              <div ref={historyScrollRef}
                className="flex-1 overflow-y-auto space-y-1.5 pr-1"
                style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(124,58,237,0.3) transparent" }}>
                <AnimatePresence initial={false}>
                  {history.length === 0 ? (
                    <div className="flex items-center justify-center h-full opacity-20 py-8">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Sem operações</p>
                    </div>
                  ) : (
                    history.slice(0, 30).map(trade => (
                      <motion.div key={trade.id}
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/8">
                        <div className="flex items-center gap-2">
                          <div className={cn("w-5 h-5 rounded-md flex items-center justify-center",
                            trade.profit && trade.profit > 0 ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400")}>
                            {trade.profit && trade.profit > 0
                              ? <ArrowUpRight className="w-3 h-3" />
                              : <ArrowDownRight className="w-3 h-3" />}
                          </div>
                          <div>
                            <p className="text-[9px] font-black text-white truncate max-w-[60px]">{trade.symbol}</p>
                            <p className="text-[8px] text-muted-foreground">{new Date(trade.time).toLocaleTimeString()}</p>
                          </div>
                        </div>
                        <span className={cn("text-[10px] font-black",
                          trade.profit && trade.profit > 0 ? "text-green-400" : "text-red-400")}>
                          {trade.profit && trade.profit > 0 ? "+" : ""}${trade.profit?.toFixed(2) || "—"}
                        </span>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </NeonCard>

            {/* Logs em tempo real */}
            <NeonCard variant="purple" className="p-4 flex flex-col" style={{ minHeight: "260px" }}>
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-3 shrink-0">
                Logs em Tempo Real
              </p>
              <div ref={logsScrollRef}
                className="flex-1 overflow-y-auto space-y-0.5 font-mono"
                style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(124,58,237,0.3) transparent" }}>
                {logEntries.length === 0 ? (
                  <div className="flex items-center justify-center h-full opacity-20 py-8">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Sem logs</p>
                  </div>
                ) : (
                  logEntries.map(entry => (
                    <div key={entry.id} className="flex gap-1.5 py-0.5">
                      <span className="text-[8px] text-muted-foreground/50 shrink-0 tabular-nums">
                        {new Date(entry.time).toLocaleTimeString("pt", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className={cn("text-[9px] leading-tight break-all", logColors[entry.level] || "text-white")}>
                        {entry.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </NeonCard>
          </div>
        </div>
      </div>

      {/* Modal Acertos */}
      <AnimatePresence>
        {showAcertos && <AcertosModal onClose={() => setShowAcertos(false)} />}
      </AnimatePresence>

      {/* BotControls invisível — mantém o useTradingEngine activo para execução de trades */}
      <div className="hidden" aria-hidden="true">
        <ErrorBoundary fallbackLabel="">
          <BotControls />
        </ErrorBoundary>
      </div>
    </>
  );
};
