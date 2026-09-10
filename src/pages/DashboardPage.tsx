import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Power, Settings2, ArrowUpRight, ArrowDownRight, X, Trophy, AlertTriangle, CircleDot, ChevronLeft, ChevronRight,
  Activity, Target, WalletCards, Gauge, Repeat2, BarChart3, Clock3
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
import { MarketSelectScreen } from "../components/MarketSelectScreen";
import { ForexDashboardPage } from "./ForexDashboardPage";
import { AccumulatorsDashboardBody } from "./AccumulatorsDashboardPage";
import { CreateSyntheticTabScreen } from "../components/CreateSyntheticTabScreen";
import { SyntheticTabsBar } from "../components/SyntheticTabsBar";
import { SYMBOLS } from "../constants";
import { logger, LogEntry } from "../lib/logger";
import { getTradeHistory } from "../lib/storage";
import { TradeHistory } from "../types";
import {
  useConnectionStore, useBotStore, useMarketStore,
  useSettingsStore
} from "../store";
import { useSessionStore } from "../store/useSessionStore";
import { useDigitsStore } from "../digits/store";
import { useSyntheticTabsStore } from "../store/useSyntheticTabsStore";
import { DIGITS_CONTRACTS, digitsContractNeedsDigit, digitsContractLabel, type DigitsContractType, type DigitsTargetMode } from "../digits/types";

// ── Timer de sessão ───────────────────────────────────────────────────────────
// Lê sessionStartedAt/sessionFrozenElapsed do useBotStore (global) em vez de
// possuir o próprio estado — assim sobrevive a navegar para outra página e
// voltar, porque o motor de trading (e a sessão) não têm nada a ver com este
// componente estar montado ou não.
function useSessionTimer(running: boolean, sessionStartedAt: number | null, frozenElapsed: number) {
  const [elapsed, setElapsed] = useState(() =>
    running && sessionStartedAt ? Math.floor((Date.now() - sessionStartedAt) / 1000) : frozenElapsed
  );

  useEffect(() => {
    if (!running || !sessionStartedAt) {
      setElapsed(frozenElapsed);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - sessionStartedAt) / 1000));
    tick(); // valor correcto imediatamente, sem esperar 1s pelo primeiro tick
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running, sessionStartedAt, frozenElapsed]);

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

// ── Selectores principais Digits ─────────────────────────────────────────────
// Ficam fora do modal de gestão de banca para evitar o problema de interacção
// dos Select portalled sobre a camada do modal.
const DigitsSelectors = () => {
  const { settings, updateSettings } = useSettingsStore();
  const { isBotRunning } = useBotStore();
  const isParityContract = settings.digitsContract === "DIGITEVEN" || settings.digitsContract === "DIGITODD";

  return (
    <NeonCard variant="purple" className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Configuração Digits</p>
          <p className="text-[11px] font-black text-white mt-1">Entrada determinística · sem previsão</p>
        </div>
        <CircleDot className="w-4 h-4 text-purple-400" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[9px] text-muted-foreground uppercase font-black">Contrato</label>
          <Select
            value={settings.digitsContract}
            disabled={isBotRunning}
            onValueChange={(value) => updateSettings({ digitsContract: value as DigitsContractType })}
          >
            <SelectTrigger className="w-full bg-black/30 border-white/10 h-9 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#111114] border-white/10 text-white">
              {DIGITS_CONTRACTS.map((contract) => (
                <SelectItem key={contract.value} value={contract.value}>
                  {contract.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className={cn("space-y-1", isParityContract && "opacity-90")}>
          <label className="text-[9px] text-muted-foreground uppercase font-black">
            {isParityContract ? "Paridade" : "Dígito alvo"}
          </label>
          <Select
            value={isParityContract ? (settings.digitsTargetDigit === 1 ? "odd" : "even") : String(settings.digitsTargetDigit)}
            disabled={isBotRunning}
            onValueChange={(value) => {
              if (isParityContract) {
                updateSettings({ digitsTargetDigit: value === "odd" ? 1 : 0 });
              } else {
                updateSettings({ digitsTargetDigit: value === "random" || value === "follow_up" ? value : Number(value) });
              }
            }}
          >
            <SelectTrigger className="w-full bg-black/30 border-white/10 h-9 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#111114] border-white/10 text-white">
              {isParityContract ? (
                <>
                  <SelectItem value="even">Par</SelectItem>
                  <SelectItem value="odd">Ímpar</SelectItem>
                </>
              ) : (
                <>
                  {Array.from({ length: 10 }, (_, digit) => (
                    <SelectItem key={digit} value={String(digit)}>{digit}</SelectItem>
                  ))}
                  <SelectItem value="random">Random</SelectItem>
                  <SelectItem value="follow_up">Follow Up</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-[9px] text-muted-foreground/60">
        {isParityContract ? "Escolhe se o último dígito deve ser par ou ímpar." : "Escolhe um dígito, Random para variar o alvo ou Follow Up para usar o último dígito do contrato anterior."}
      </p>
    </NeonCard>
  );
};

const digitModeLabel = (target: DigitsTargetMode) => {
  if (target === "random") return "Random";
  if (target === "follow_up") return "Follow Up";
  return "Fixo";
};

const digitsTargetText = (contract: DigitsContractType | null, target: number | null) => {
  if (!contract) return "—";
  if (!digitsContractNeedsDigit(contract)) return digitsContractLabel(contract, 0);
  return target == null ? digitsContractLabel(contract, "random") : digitsContractLabel(contract, target);
};

const getLastTickDigit = (price: number | null) => {
  if (price == null || !Number.isFinite(price)) return null;
  const fixed = price.toFixed(2);
  const digits = fixed.replace(/\D/g, "");
  return digits.length ? Number(digits[digits.length - 1]) : null;
};

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

// ── Text Stepper ─────────────────────────────────────────────────────────────
// Controles compactos sem portal: ideais para o modal de gestão de banca.
const TextStepper = ({
  label, value, disabled, onPrevious, onNext,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) => (
  <div className="space-y-1">
    <label className="text-[9px] text-muted-foreground uppercase font-black">{label}</label>
    <div className="flex items-center h-8 rounded-lg border border-white/10 bg-black/30 overflow-hidden">
      <button
        type="button"
        disabled={disabled}
        onClick={onPrevious}
        aria-label={`${label} anterior`}
        className="h-full w-8 shrink-0 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <div className="flex-1 min-w-0 text-center text-[10px] font-black text-white truncate px-1">
        {value}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onNext}
        aria-label={`${label} próximo`}
        className="h-full w-8 shrink-0 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
);

// ── Modal de gestão de banca Digits ──────────────────────────────────────────
const DigitsConfigModal = ({ onClose }: { onClose: () => void }) => {
  const { settings, updateSettings } = useSettingsStore();
  const s = settings;

  const row = (label: string, key: keyof typeof s, step = "1", min = 0, max?: number) => (
    <div className="space-y-1" key={label}>
      <label className="text-[9px] text-muted-foreground uppercase font-black">{label}</label>
      <Input type="number" step={step} min={min} max={max} value={s[key] as number}
        disabled={isBotRunningGlobally()}
        onChange={e => {
          const raw = Number(e.target.value);
          if (!Number.isFinite(raw)) return;
          let value = Math.max(min, raw);
          if (max !== undefined) value = Math.min(max, value);
          updateSettings({ [key]: value });
        }}
        className="bg-black/30 border-white/10 h-8 text-[11px]" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-[#111114] border border-purple-500/20 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <p className="font-black text-sm uppercase tracking-widest flex items-center gap-2 text-white">
            <CircleDot className="w-4 h-4 text-purple-400" /> Digits V1
          </p>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground"><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
            <p className="text-[9px] uppercase font-black text-purple-300">Entrada configurada</p>
            <p className="text-[11px] text-white font-black mt-1">{digitsContractLabel(s.digitsContract, s.digitsTargetDigit)}</p>
            <p className="text-[9px] text-muted-foreground mt-1">Contrato e dígito são seleccionados directamente no painel, fora deste modal.</p>
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
              <Switch checked={s.useMartingale} disabled={isBotRunningGlobally()} onCheckedChange={v => updateSettings({ useMartingale: v })} className="scale-90" />
            </div>
            {s.useMartingale && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {row("Steps", "maxMartingaleSteps", "1", 0)}
                  {row("Multiplicador", "martingaleMultiplier", "0.1", 1)}
                </div>

                <div className="pt-2 border-t border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-white font-bold">Martingale Avançado</span>
                      <p className="text-[9px] text-muted-foreground mt-0.5">Após LOSS, pode mudar contrato e dígito.</p>
                    </div>
                    <Switch
                      checked={s.useAdvancedMartingale}
                      disabled={isBotRunningGlobally()}
                      onCheckedChange={v => updateSettings({ useAdvancedMartingale: v })}
                      className="scale-90"
                    />
                  </div>

                  {s.useAdvancedMartingale && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <TextStepper
                          label="Contrato"
                          value={DIGITS_CONTRACTS.find(contract => contract.value === s.advancedMartingaleContract)?.label ?? "Under"}
                          disabled={isBotRunningGlobally()}
                          onPrevious={() => {
                            const index = DIGITS_CONTRACTS.findIndex(contract => contract.value === s.advancedMartingaleContract);
                            const nextIndex = (index - 1 + DIGITS_CONTRACTS.length) % DIGITS_CONTRACTS.length;
                            updateSettings({ advancedMartingaleContract: DIGITS_CONTRACTS[nextIndex].value });
                          }}
                          onNext={() => {
                            const index = DIGITS_CONTRACTS.findIndex(contract => contract.value === s.advancedMartingaleContract);
                            const nextIndex = (index + 1) % DIGITS_CONTRACTS.length;
                            updateSettings({ advancedMartingaleContract: DIGITS_CONTRACTS[nextIndex].value });
                          }}
                        />

                        <TextStepper
                          label="Dígito"
                          value={String(s.advancedMartingaleTargetDigit)}
                          disabled={isBotRunningGlobally()}
                          onPrevious={() => updateSettings({ advancedMartingaleTargetDigit: (s.advancedMartingaleTargetDigit + 9) % 10 })}
                          onNext={() => updateSettings({ advancedMartingaleTargetDigit: (s.advancedMartingaleTargetDigit + 1) % 10 })}
                        />
                      </div>

                      {row("Máx. aplicações avançadas seg.", "maxAdvancedMartingaleSteps", "1", 1)}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {row("Cooldown após limite (s)", "cooldownAfterLoss", "1", 0)}
          <div className="p-3 rounded-xl border border-purple-500/20 bg-purple-500/5">
            <p className="text-[9px] uppercase font-black text-purple-300">Gestão separada da estratégia</p>
            <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
              WIN repete a mesma entrada. LOSS aplica a progressão configurada. O risco não altera o contrato nem o dígito seleccionado.
            </p>
          </div>
        </div>
        <div className="px-5 pb-5">
          <Button onClick={onClose} className="w-full bg-purple-600 hover:bg-purple-700 font-black uppercase h-10">Guardar e Fechar</Button>
        </div>
      </motion.div>
    </div>
  );
};

function isBotRunningGlobally() {
  return useBotStore.getState().isBotRunning;
}

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

// ── DigitsDashboardBody ───────────────────────────────────────────────────
// Dashboard de Digits, exatamente como sempre esteve — agora vive dentro de
// uma aba de operação (ver SyntheticTabsBar / DashboardPage) em vez de ser
// o único conteúdo possível para o mercado "synthetic". Nenhuma lógica de
// Digits foi alterada por causa das abas.
const DigitsDashboardBody = ({ tabId }: { tabId: string }) => {
  const { isAuthorized } = useConnectionStore();
  const { isBotRunning, setIsBotRunning, lossCooldown, sessionStartedAt, sessionFrozenElapsed } = useBotStore();
  const { runningTabId, setRunningTab } = useSyntheticTabsStore();
  const isOwner = runningTabId === tabId;
  const { symbol, setSymbol, candles, ticks, timeframe, setTimeframe } = useMarketStore();
  const { settings } = useSettingsStore();
  const { runtime: digitsRuntime } = useDigitsStore();
  const { wins, losses, consecutiveLosses, pnl: rawPnl, modal, closeModal } = useSessionStore();
  const pnl = Number(rawPnl) || 0;
  const logEntries = useLogEntries(60);
  const timer = useSessionTimer(isBotRunning && isOwner, sessionStartedAt, sessionFrozenElapsed);
  const [showDigitsConfig, setShowDigitsConfig] = useState(false);
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

          {/* Selectores principais Digits — fora do modal de gestão de banca */}
          <DigitsSelectors />

          {/* Sessão + P/L + Win/Loss */}
          <NeonCard variant="purple" className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock3 className="w-4 h-4 text-purple-400" />
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Sessão Digits</p>
              </div>
              <Badge className={cn(isBotRunning && isOwner ? "bg-green-500/10 text-green-300 border-green-500/20" : "bg-white/5 text-muted-foreground border-white/10")}>{isBotRunning && isOwner ? "OPERANDO" : isBotRunning ? "NOUTRA ABA" : "PARADO"}</Badge>
            </div>
            <div className="flex items-center justify-center">
              <div className="px-4 py-2 bg-black/50 border border-purple-500/30 rounded-xl">
                <span className="font-mono font-black text-2xl text-white tracking-widest">{timer}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusPill label="Lucro da sessão" value={`${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`} className={pnl >= 0 ? "border-green-500/10" : "border-red-500/10"} />
              <StatusPill label="Win / Loss" value={`${wins} / ${losses}`} />
            </div>
          </NeonCard>

          {/* 1 + 2 + 7 — configuração, modo e próxima entrada */}
          <NeonCard variant="blue" className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-400" />
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Configuração da operação</p>
              </div>
              <Badge className="bg-purple-500/10 text-purple-300 border-purple-500/20 text-[8px]">{digitModeLabel(settings.digitsTargetDigit)}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusPill label="Contrato" value={digitsContractLabel(settings.digitsContract, settings.digitsTargetDigit)} />
              <StatusPill label="Duração" value="1 tick" />
              <StatusPill label="Modo de entrada" value={digitModeLabel(settings.digitsTargetDigit)} />
              <StatusPill label="Próxima stake" value={`$${(digitsRuntime.nextStake ?? digitsRuntime.currentStake ?? settings.stake).toFixed(2)}`} />
            </div>
            <div className="rounded-xl border border-blue-500/15 bg-blue-500/5 p-3">
              <p className="text-[8px] uppercase text-blue-300 font-black">Próxima operação</p>
              <p className="text-lg font-black text-white mt-1">
                {digitsTargetText(digitsRuntime.nextContract, digitsRuntime.nextTargetDigit)}
              </p>
              <p className="text-[9px] text-muted-foreground mt-1">
                {digitsRuntime.nextContract
                  ? (digitsRuntime.nextTargetDigit == null && digitsContractNeedsDigit(digitsRuntime.nextContract) ? "Alvo será sorteado na entrada" : "Entrada preparada pelo motor")
                  : "Aguardando início da sessão"}
              </p>
            </div>
          </NeonCard>

          {/* 2 + 5 — estado atual do tick e operação */}
          <NeonCard variant="purple" className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-400" />
                <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Operação em tempo real</p>
              </div>
              <Badge className={digitsRuntime.isProcessing ? "bg-amber-500/10 text-amber-300 border-amber-500/20" : "bg-white/5 text-muted-foreground border-white/10"}>{digitsRuntime.isProcessing ? "PROCESSANDO" : "AGUARDANDO"}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusPill label="Entrada atual" value={digitsTargetText(digitsRuntime.currentContract, digitsRuntime.currentTargetDigit)} />
              <StatusPill label="Stake na entrada" value={digitsRuntime.currentStakeInTrade != null ? `$${digitsRuntime.currentStakeInTrade.toFixed(2)}` : "—"} />
              <StatusPill label="Último dígito do tick" value={getLastTickDigit(currentPrice) == null ? "—" : String(getLastTickDigit(currentPrice))} />
              <StatusPill label="Contrato ativo" value={digitsRuntime.activeContractId ?? "—"} />
            </div>
            {digitsRuntime.error && <p className="text-[9px] text-red-400 font-bold leading-relaxed">{digitsRuntime.error}</p>}
          </NeonCard>

          {/* 3 — gestão de banca */}
          <NeonCard variant="blue" className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <WalletCards className="w-4 h-4 text-blue-400" />
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Gestão de banca</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <RuntimeMetric label="Stake atual" value={`$${(digitsRuntime.currentStake || settings.stake).toFixed(2)}`} accent="text-blue-400" />
              <RuntimeMetric label="Martingale" value={settings.useMartingale ? `${digitsRuntime.martingaleStep} / ${settings.maxMartingaleSteps}` : "OFF"} accent="text-purple-300" />
              <RuntimeMetric label="Avançado" value={settings.useAdvancedMartingale && settings.useMartingale ? `${digitsRuntime.advancedMartingaleStep} / ${settings.maxAdvancedMartingaleSteps}` : "OFF"} accent="text-purple-300" />
              <RuntimeMetric label="Loss seguidos" value={`${digitsRuntime.consecutiveLosses} / ${settings.maxConsecutiveLosses}`} accent={digitsRuntime.consecutiveLosses >= 3 ? "text-red-400" : "text-white"} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusPill label="Take Profit" value={`$${settings.targetProfit.toFixed(2)}`} />
              <StatusPill label="Stop Loss" value={`$${settings.stopLoss.toFixed(2)}`} />
            </div>
            {settings.useAdvancedMartingale && settings.useMartingale && (
              <div className="rounded-xl border border-purple-500/15 bg-purple-500/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[8px] uppercase text-purple-300 font-black">Martingale Avançado</p>
                  <span className="text-[9px] font-black text-white">{digitsTargetText(settings.advancedMartingaleContract, settings.advancedMartingaleTargetDigit)}</span>
                </div>
                <p className="text-[9px] text-muted-foreground mt-1">Aplicações: {digitsRuntime.advancedMartingaleStep} / {settings.maxAdvancedMartingaleSteps}</p>
              </div>
            )}
          </NeonCard>

          {/* 4 — última operação */}
          <NeonCard variant="blue" className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Repeat2 className="w-4 h-4 text-blue-400" />
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Última operação</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusPill label="Contrato" value={digitsTargetText(digitsRuntime.lastContract, digitsRuntime.lastTargetDigit)} />
              <StatusPill label="Stake" value={digitsRuntime.lastStake != null ? `$${digitsRuntime.lastStake.toFixed(2)}` : "—"} />
              <StatusPill label="Último dígito" value={digitsRuntime.lastExitDigit == null ? "—" : String(digitsRuntime.lastExitDigit)} />
              <StatusPill label="Resultado" value={digitsRuntime.lastResult === "WON" ? "WIN" : digitsRuntime.lastResult === "LOST" ? "LOSS" : "—"} className={digitsRuntime.lastResult === "WON" ? "border-green-500/20" : digitsRuntime.lastResult === "LOST" ? "border-red-500/20" : ""} />
            </div>
            {digitsRuntime.lastProfit != null && <p className={cn("text-right text-sm font-black", digitsRuntime.lastProfit >= 0 ? "text-green-400" : "text-red-400")}>{digitsRuntime.lastProfit >= 0 ? "+" : ""}${digitsRuntime.lastProfit.toFixed(2)}</p>}
          </NeonCard>

          {/* 6 — estatísticas da sessão */}
          <NeonCard variant="purple" className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-purple-400" />
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Estatísticas Digits</p>
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

          {/* Configuração e controlo */}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setShowDigitsConfig(true)}
              className="h-14 border-purple-500/40 text-purple-400 hover:bg-purple-500/10 gap-2 font-black uppercase text-[11px]">
              <Settings2 className="w-4 h-4" /> Gestão
            </Button>
            <button
              onClick={() => {
                if (isBotRunning && isOwner) { setIsBotRunning(false); setRunningTab(null); }
                else if (!isBotRunning) { setRunningTab(tabId); setIsBotRunning(true); }
              }}
              disabled={!isAuthorized || (isBotRunning && !isOwner)}
              title={isBotRunning && !isOwner ? "O bot já está a operar noutra aba" : undefined}
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
                Atividade em Tempo Real
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
                            <p className="text-[9px] font-black text-white truncate">{trade.type.replace("DIGIT", "")}{trade.targetDigit != null ? ` ${trade.targetDigit}` : ""}</p>
                            <span className="text-[8px] text-muted-foreground truncate">{trade.symbol}</span>
                          </div>
                          <p className="text-[8px] text-muted-foreground">{new Date(trade.time).toLocaleTimeString()}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[8px] text-muted-foreground">Stake ${Number(trade.stake || 0).toFixed(2)}</p>
                        <span className={cn("text-[10px] font-black",
                          trade.status === "PENDING" ? "text-amber-400"
                          : Number(trade.profit || 0) > 0 ? "text-green-400" : "text-red-400")}>
                          {trade.status === "PENDING" ? "Pendente" : `${Number(trade.profit || 0) >= 0 ? "+" : ""}$${Number(trade.profit || 0).toFixed(2)}`}
                        </span>
                      </div>
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
        {showDigitsConfig && <DigitsConfigModal onClose={() => setShowDigitsConfig(false)} />}
      </AnimatePresence>
    </>
  );
};

// ── DashboardPage ─────────────────────────────────────────────────────────
// Ponto de entrada de /dashboard. Decide entre o selector de mercado, o
// Forex (inalterado) e, para Índices Sintéticos, a orquestração de abas de
// operação (Digits / Accumulators) — nunca as duas no mesmo dashboard.
export const DashboardPage = () => {
  const navigate = useNavigate();
  const { isAuthorized, activeAccount } = useConnectionStore();
  const { isBotRunning } = useBotStore();
  const { market, setMarket } = useMarketStore();
  const { tabs, activeTabId } = useSyntheticTabsStore();

  // Redirecionar se sem Deriv — igual ao comportamento anterior.
  useEffect(() => {
    if (!isAuthorized && !activeAccount) navigate("/");
  }, [isAuthorized, activeAccount]);

  // Fase 1 do plano multi-mercado — ver forex_ux_architecture.md.
  // Mercado ainda não escolhido nesta sessão: mostra o selector em vez do
  // dashboard. O Forex continua exatamente como sempre esteve.
  if (market === null) return <MarketSelectScreen />;
  if (market === "forex") return <ForexDashboardPage />;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <>
      {/* Fase 1 multi-mercado: trocar só permitido com o bot parado — mesma
          regra já usada para alterar dados do mercado com o bot parado. */}
      <div className="flex justify-end mb-2">
        <button
          onClick={() => !isBotRunning && setMarket(null)}
          disabled={isBotRunning}
          title={isBotRunning ? "Pára o bot para trocar de mercado" : "Trocar de mercado"}
          className="text-[9px] font-black uppercase tracking-wide text-muted-foreground/60 hover:text-purple-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          ⇄ Trocar mercado
        </button>
      </div>

      {tabs.length === 0 ? (
        <CreateSyntheticTabScreen />
      ) : (
        <>
          <SyntheticTabsBar />
          {activeTab?.type === "digits" && <DigitsDashboardBody tabId={activeTab.id} />}
          {activeTab?.type === "accumulators" && <AccumulatorsDashboardBody tabId={activeTab.id} />}
        </>
      )}
    </>
  );
};
