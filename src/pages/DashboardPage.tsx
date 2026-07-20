import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Power, Settings2, ArrowUpRight, ArrowDownRight,
  TrendingUp, TrendingDown, X, Trophy, AlertTriangle
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
import {
  useConnectionStore, useBotStore, useMarketStore,
  useSettingsStore, useSignalStore
} from "../store";
import { useSessionStore } from "../store/useSessionStore";

// ── Timer de sessão ───────────────────────────────────────────────────────────
// Zera apenas ao iniciar o bot. Ao parar, mantém o valor final visível
// (mesmo comportamento do lucro/win-loss da sessão) até ao próximo start.
function useSessionTimer(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      startRef.current = Date.now();
      setElapsed(0);
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current!) / 1000));
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      // Não reseta elapsed — mantém o tempo final da sessão visível
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const s = String(elapsed % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ── Hook: logs em tempo real ──────────────────────────────────────────────────
function useLogEntries(max = 500) {
  const [entries, setEntries] = useState<LogEntry[]>(() => logger.getAll().slice(-max));
  useEffect(() => {
    const unsub = logger.subscribe((e) => {
      if (!e) { setEntries([]); return; }
      setEntries(prev => [...prev.slice(-(max - 1)), e]);
    });
    return unsub;
  }, [max]);
  return entries;
}

// ── Modal Acertos ─────────────────────────────────────────────────────────────
const AcertosModal = ({ onClose }: { onClose: () => void }) => {
  const { settings, updateSettings, changeProfile } = useSettingsStore();
  const s = settings;
  const row = (label: string, key: keyof typeof s, step = "1") => (
    <div className="space-y-1" key={label}>
      <label className="text-[9px] text-muted-foreground uppercase font-black">{label}</label>
      <Input type="number" step={step} value={s[key] as number}
        onChange={e => updateSettings({ [key]: Number(e.target.value) })}
        className="bg-black/30 border-white/10 h-8 text-[11px]" />
    </div>
  );
  const tog = (label: string, key: keyof typeof s) => (
    <div className="flex items-center justify-between py-1" key={label}>
      <span className="text-[11px] text-muted-foreground font-bold">{label}</span>
      <Switch checked={s[key] as boolean} onCheckedChange={v => updateSettings({ [key]: v })} className="scale-90" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-[#111114] border border-purple-500/20 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <p className="font-black text-sm uppercase tracking-widest flex items-center gap-2 text-white">
            <Settings2 className="w-4 h-4 text-purple-400" /> Acertos
          </p>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground"><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-1">
            <label className="text-[9px] text-muted-foreground uppercase font-black">Perfil IA</label>
            <Select value={s.strategyProfile} onValueChange={(v: any) => changeProfile(v)}>
              <SelectTrigger className="bg-black/30 border-white/10 h-8 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#111114] border-white/10 text-white z-[500]">
                <SelectItem value="conservative">Conservador (80%)</SelectItem>
                <SelectItem value="balanced">Equilibrado (70%)</SelectItem>
                <SelectItem value="aggressive">Agressivo (55%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {row("Stake Base ($)", "stake", "0.01")}
            {row("Take Profit ($)", "targetProfit", "0.5")}
            {row("Stop Loss ($)", "stopLoss", "0.5")}
            {row("Conf. Mínima (%)", "minConfidence")}
          </div>
          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-2">
            {tog("Martingale", "useMartingale")}
            {s.useMartingale && <div className="grid grid-cols-2 gap-2">{row("Steps", "maxMartingaleSteps")}{row("Multiplicador", "martingaleMultiplier", "0.1")}</div>}
          </div>
          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-2">
            {tog("Soros", "useSoros")}
            {s.useSoros && row("Níveis Soros", "maxSorosLevels")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {row("Max Perdas Seg.", "maxConsecutiveLosses")}
            {row("Cooldown Loss (s)", "cooldownAfterLoss")}
          </div>
        </div>
        <div className="px-5 pb-5">
          <Button onClick={onClose} className="w-full bg-purple-600 hover:bg-purple-700 font-black uppercase h-10">Guardar e Fechar</Button>
        </div>
      </motion.div>
    </div>
  );
};

// ── Modal resultado (SL/TP) ───────────────────────────────────────────────────
const ResultModal = ({ type, amount, onClose }: { type: "profit" | "loss"; amount: number; onClose: () => void }) => (
  <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
    <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      className={cn("w-full max-w-xs rounded-2xl p-8 text-center shadow-2xl border",
        type === "profit"
          ? "bg-green-950/80 border-green-500/40 shadow-green-500/20"
          : "bg-red-950/80 border-red-500/40 shadow-red-500/20")}>
      <div className="text-5xl mb-4">{type === "profit" ? "🏆" : "🛑"}</div>
      <p className={cn("text-xl font-black uppercase tracking-wide",
        type === "profit" ? "text-green-400" : "text-red-400")}>
        {type === "profit" ? "Meta Atingida!" : "Stop Loss!"}
      </p>
      <p className={cn("text-3xl font-black mt-2",
        type === "profit" ? "text-green-300" : "text-red-300")}>
        {amount >= 0 ? "+" : ""}${Math.abs(amount).toFixed(2)}
      </p>
      <Button onClick={onClose} className={cn("w-full mt-6 font-black uppercase h-11",
        type === "profit" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700")}>
        OK
      </Button>
    </motion.div>
  </div>
);

// ── DashboardPage ─────────────────────────────────────────────────────────────
export const DashboardPage = () => {
  const navigate = useNavigate();
  const { isAuthorized, activeAccount } = useConnectionStore();
  const { isBotRunning, setIsBotRunning, lossCooldown } = useBotStore();
  const { symbol, setSymbol, candles, ticks, timeframe, setTimeframe } = useMarketStore();
  const { settings } = useSettingsStore();
  const { lastSignal } = useSignalStore();
  const { wins, losses, pnl: rawPnl, modal, closeModal } = useSessionStore();
  const pnl = Number(rawPnl) || 0;
  const logEntries = useLogEntries(60);
  const timer = useSessionTimer(isBotRunning);
  const [showAcertos, setShowAcertos] = useState(false);
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
  const showCooldownBanner = !!lossCooldown && cooldownRemainingSec > 0;
  

  // Fix 3: histórico local actualizado em tempo real
  const [localHistory, setLocalHistory] = useState<TradeHistory[]>(() => getTradeHistory());
  useEffect(() => {
    const handler = () => setLocalHistory(getTradeHistory());
    window.addEventListener("trade_history_updated", handler);
    return () => window.removeEventListener("trade_history_updated", handler);
  }, []);

  // Auto-scroll logs
  const logsContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logEntries.length]);

  // Redirecionar se sem Deriv
  useEffect(() => {
    if (!isAuthorized && !activeAccount) navigate("/");
  }, [isAuthorized, activeAccount]);

  const ind = lastSignal?.indicators;
  const currentPrice = ticks.length > 0 ? ticks[ticks.length - 1].price : null;
  const prevPrice = ticks.length > 1 ? ticks[ticks.length - 2].price : null;
  const isUp = currentPrice && prevPrice ? currentPrice >= prevPrice : true;
  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

  const logColors: Record<string, string> = {
    system: "text-blue-400", signal: "text-purple-300", block: "text-amber-400",
    trade: "text-emerald-400", risk: "text-orange-400", error: "text-red-400"
  };

  return (
    <>
      {/* Fix 1: Layout 2 colunas desktop — usa grid com larguras fixas */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">

        {/* ══ COLUNA ESQUERDA ══════════════════════════════════════════════ */}
        <div className="flex flex-col gap-3">

          {/* Cronómetro + Lucro + Win/Loss */}
          <NeonCard variant="purple" className="p-4 space-y-3">
            <div className="flex items-center justify-center">
              <div className="px-4 py-2 bg-black/50 border border-purple-500/30 rounded-xl">
                <span className="font-mono font-black text-2xl text-white tracking-widest">{timer}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-center">
                <p className="text-[9px] text-muted-foreground uppercase font-black">Lucro</p>
                <p className={cn("text-base font-black mt-0.5", pnl >= 0 ? "text-green-400" : "text-red-400")}>
                  {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                </p>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-center">
                <p className="text-[9px] text-muted-foreground uppercase font-black">Win / Loss</p>
                <p className="text-base font-black mt-0.5">
                  <span className="text-green-400">{wins}</span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-red-400">{losses}</span>
                </p>
              </div>
            </div>
          </NeonCard>

          {/* Painel A — Métricas */}
          <NeonCard variant="blue" className="p-4 flex-1">
            <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-3">Análise em Tempo Real</p>
            <div className="space-y-2">
              {/* Barra de confiança */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground font-bold">Confiança IA</span>
                  <span className={cn("font-black", (lastSignal?.confidence || 0) >= settings.minConfidence ? "text-green-400" : "text-red-400")}>
                    {lastSignal?.confidence || 0}%
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <motion.div animate={{ width: `${lastSignal?.confidence || 0}%` }}
                    className={cn("h-full rounded-full", (lastSignal?.confidence || 0) >= settings.minConfidence ? "bg-gradient-to-r from-blue-500 to-green-400" : "bg-gradient-to-r from-red-500 to-yellow-500")} />
                </div>
              </div>
              {/* Métricas */}
              {[
                { label: "Assertividade", value: `${winRate}%`, color: winRate >= 55 ? "text-green-400" : "text-yellow-400" },
                { label: "WR Operação", value: lastSignal?.type !== "NEUTRAL" && lastSignal?.type ? lastSignal.type : "—", color: lastSignal?.type === "CALL" ? "text-blue-400" : lastSignal?.type === "PUT" ? "text-pink-400" : "text-muted-foreground" },
                { label: "Conseq. Loss", value: String(losses), color: losses >= 3 ? "text-red-400" : "text-white" },
                { label: "Stake Actual", value: `$${settings.stake.toFixed(2)}`, color: "text-blue-400" },
                { label: "Trend Freshness", value: `${ind?.trendFreshnessScore?.toFixed(1) || "—"}/10`, color: (ind?.trendFreshnessScore || 0) >= 6 ? "text-green-400" : "text-amber-400" },
                { label: "Timing Quality", value: `${ind?.timingQuality?.toFixed(1) || "—"}/10`, color: (ind?.timingQuality || 0) >= 6 ? "text-green-400" : "text-amber-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
                  <span className="text-[10px] text-muted-foreground font-bold">{label}</span>
                  <span className={cn("text-[10px] font-black", color)}>{value}</span>
                </div>
              ))}
              {/* Análise Estrutural */}
              <div className="pt-1 space-y-1.5">
                <p className="text-[9px] text-muted-foreground uppercase font-black">Análise Estrutural</p>
                <div className="flex gap-1.5 flex-wrap">
                  <Badge className={cn("text-[8px] font-black", ind?.marketCondition === "TRENDING" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20")}>
                    {ind?.marketCondition || "—"}
                  </Badge>
                  {lastSignal?.type && lastSignal.type !== "NEUTRAL" && (
                    <Badge className={cn("text-[8px] font-black", lastSignal.type === "CALL" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-pink-500/10 text-pink-400 border-pink-500/20")}>
                      {lastSignal.type === "CALL" ? <><TrendingUp className="w-2.5 h-2.5 mr-0.5" />CALL</> : <><TrendingDown className="w-2.5 h-2.5 mr-0.5" />PUT</>}
                    </Badge>
                  )}
                </div>
                {ind?.reason && <p className="text-[9px] text-blue-400/80 leading-tight italic">"{ind.reason}"</p>}
              </div>
            </div>
          </NeonCard>

          {/* Botões: Acertos + Power */}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setShowAcertos(true)}
              className="h-14 border-purple-500/40 text-purple-400 hover:bg-purple-500/10 gap-2 font-black uppercase text-[11px]">
              <Settings2 className="w-4 h-4" /> Acertos
            </Button>
            <button onClick={() => setIsBotRunning(!isBotRunning)} disabled={!isAuthorized}
              className={cn("h-14 rounded-xl border-2 font-black uppercase text-[11px] flex items-center justify-center gap-2 transition-all duration-300 disabled:opacity-40",
                isBotRunning ? "border-red-500/60 bg-red-500/10 text-red-400 shadow-lg shadow-red-500/20" : "border-green-500/40 bg-green-500/5 text-green-400 hover:bg-green-500/15")}>
              <Power className={cn("w-5 h-5", isBotRunning && "animate-pulse")} />
              {isBotRunning ? "Stop" : "Start"}
            </button>
          </div>

          {showCooldownBanner && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <p className="text-[10px] font-bold leading-tight">
                Cooldown de risco activo — retoma em {cooldownRemainingSec}s
              </p>
            </div>
          )}
        </div>

        {/* ══ COLUNA DIREITA ══════════════════════════════════════════════ */}
        <div className="flex flex-col gap-3 min-w-0">

          {/* Preço + Selectores + Gráfico */}
          <NeonCard variant="purple" className="p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                {isUp ? <ArrowUpRight className="text-cyan-400 w-5 h-5 shrink-0" /> : <ArrowDownRight className="text-pink-400 w-5 h-5 shrink-0" />}
                <span className={cn("text-xl font-black tracking-tighter", isUp ? "text-cyan-400" : "text-pink-400")}>
                  {currentPrice ? currentPrice.toFixed(2) : "---"}
                </span>
                <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/40 text-[8px]">LIVE</Badge>
              </div>
              <div className="flex gap-2">
                <Select value={symbol} onValueChange={setSymbol}>
                  <SelectTrigger className="bg-black/20 border-white/10 h-8 text-[11px] w-[140px] md:w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#111114] border-white/10 text-white">
                    {SYMBOLS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={String(timeframe)} onValueChange={v => setTimeframe(Number(v))}>
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

          {/* Fix 4: Histórico (2) + Logs (3) com scroll interno real */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

            {/* Histórico — Fix 3 + Fix 4 */}
            <NeonCard variant="blue" className="p-4 flex flex-col" style={{ height: "280px" }}>
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-2 shrink-0">
                Histórico em Tempo Real
              </p>
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5"
                style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(59,130,246,0.3) transparent", overscrollBehavior: "contain" }}>
                <AnimatePresence initial={false}>
                  {localHistory.length === 0 ? (
                    <div className="flex items-center justify-center h-full opacity-20">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">Sem operações</p>
                    </div>
                  ) : localHistory.slice(0, 30).map(trade => (
                    <motion.div key={trade.id}
                      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                      className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/8">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-5 h-5 rounded-md flex items-center justify-center text-[8px] font-black",
                          trade.status === "WON" ? "bg-green-500/15 text-green-400"
                          : trade.status === "LOST" ? "bg-red-500/15 text-red-400"
                          : "bg-amber-500/15 text-amber-400")}>
                          {trade.status === "WON" ? "W" : trade.status === "LOST" ? "L" : "…"}
                        </div>
                        <div>
                          <p className="text-[9px] font-black text-white truncate max-w-[55px]">{trade.symbol}</p>
                          <p className="text-[8px] text-muted-foreground">{new Date(trade.time).toLocaleTimeString()}</p>
                        </div>
                      </div>
                      <span className={cn("text-[10px] font-black",
                        trade.status === "PENDING" ? "text-amber-400"
                        : trade.profit && trade.profit > 0 ? "text-green-400" : "text-red-400")}>
                        {trade.status === "PENDING" ? "Pendente"
                          : `${trade.profit && trade.profit > 0 ? "+" : ""}$${Number(trade.profit || 0).toFixed(2)}`}
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </NeonCard>

            {/* Logs — Fix 4 */}
            <NeonCard variant="purple" className="p-4 flex flex-col" style={{ height: "280px" }}>
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-2 shrink-0">
                Logs em Tempo Real
              </p>
              <div
                ref={logsContainerRef}
                className="flex-1 overflow-y-auto font-mono"
                style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(124,58,237,0.3) transparent", overscrollBehavior: "contain" }}>
                {logEntries.length === 0 ? (
                  <div className="flex items-center justify-center h-full opacity-20">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Sem logs</p>
                  </div>
                ) : logEntries.map(e => (
                  <div key={e.id} className="flex gap-1.5 py-0.5 border-b border-white/3">
                    <span className="text-[8px] text-muted-foreground/40 shrink-0 tabular-nums">
                      {new Date(e.time).toLocaleTimeString("pt", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span className={cn("text-[9px] leading-tight break-all", logColors[e.level] || "text-white")}>
                      {e.message}
                    </span>
                  </div>
                ))}
                <div />
              </div>
            </NeonCard>
          </div>
        </div>
      </div>

      {/* Motor de trading: gerido centralmente em App.tsx via TradingEngineRunner */}

      {/* Fix 5: Modal resultado SL/TP */}
      <AnimatePresence>
        {modal.show && <ResultModal type={modal.type} amount={modal.amount} onClose={closeModal} />}
      </AnimatePresence>

      {/* Modal Acertos */}
      <AnimatePresence>
        {showAcertos && <AcertosModal onClose={() => setShowAcertos(false)} />}
      </AnimatePresence>
    </>
  );
};
