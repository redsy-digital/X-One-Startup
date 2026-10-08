import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Power, Settings2, ArrowUpRight, ArrowDownRight, X, Trophy, AlertTriangle, CircleDot, ChevronLeft, ChevronRight,
  Activity, Target, WalletCards, Gauge, Repeat2, BarChart3, Clock3, Pause, Play
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
import { DigitsMarketChart, type DigitsChartType } from "../components/DigitsMarketChart";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { MarketSelectScreen } from "../components/MarketSelectScreen";
import { ForexDashboardPage } from "./ForexDashboardPage";
import { logger, LogEntry } from "../lib/logger";
import { getTradeHistory } from "../lib/storage";
import { TradeHistory } from "../types";
import {
  useConnectionStore, useBotStore, useMarketStore,
  useSettingsStore
} from "../store";
import { useSessionStore } from "../store/useSessionStore";
import { useDigitsStore } from "../digits/store";
import { SyntheticOperationTabs, NoSyntheticTabs } from "../components/SyntheticOperationTabs";
import { AccumulatorDashboard } from "../accumulators/Dashboard";
import { RiseFallDashboard } from "../rise-fall/Dashboard";
import { useSyntheticTabsStore } from "../synthetic/tabs";
import { DIGITS_CONTRACTS, digitsContractNeedsDigit, digitsContractLabel, type DigitsContractType, type DigitsTargetMode } from "../digits/types";
import { extractLastDigitFromTick } from "../digits/digit";

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
  const pendingRef = useRef<LogEntry[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const flush = () => {
      flushTimerRef.current = null;
      if (pendingRef.current.length === 0) return;
      const pending = pendingRef.current;
      pendingRef.current = [];
      setEntries(prev => [...prev, ...pending].slice(-max));
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(flush, 120);
    };

    const unsub = logger.subscribe((e) => {
      if (!e) {
        pendingRef.current = [];
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        setEntries([]);
        return;
      }
      pendingRef.current.push(e);
      scheduleFlush();
    });

    return () => {
      unsub();
      pendingRef.current = [];
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    };
  }, [max]);

  return entries;
}

// ── Selectores principais Digits ─────────────────────────────────────────────
// Ficam fora do modal de gestão de banca para evitar o problema de interacção
// dos Select portalled sobre a camada do modal.
const DIGITS_GROUPS = [
  { value: "under_over", label: "Under / Over", options: [
    { value: "DIGITUNDER", label: "Under" },
    { value: "DIGITOVER", label: "Over" },
  ] },
  { value: "match_diff", label: "Match / Diff", options: [
    { value: "DIGITMATCH", label: "Match" },
    { value: "DIGITDIFF", label: "Diff" },
  ] },
  { value: "even_odd", label: "Even / Odd", options: [
    { value: "DIGITEVEN", label: "Par" },
    { value: "DIGITODD", label: "Ímpar" },
  ] },
] as const;

const getDigitsGroup = (contract: DigitsContractType) =>
  DIGITS_GROUPS.find(group => group.options.some(option => option.value === contract)) ?? DIGITS_GROUPS[0];

const DigitsSelectors = () => {
  const { settings, updateSettings } = useSettingsStore();
  const { isBotRunning, isBotPaused } = useBotStore();
  const controlsLocked = isBotRunning && !isBotPaused;
  const group = getDigitsGroup(settings.digitsContract);
  const isParityContract = group.value === "even_odd";
  const isOverUnderContract = group.value === "under_over";

  return (
    <NeonCard variant="purple" className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Configuração Digits</p>
          <p className="text-[11px] font-black text-white mt-1">Escolhe o tipo de entrada</p>
        </div>
        <CircleDot className="w-4 h-4 text-purple-400" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[9px] text-muted-foreground uppercase font-black">Contrato</label>
          <Select
            value={group.value}
            disabled={controlsLocked}
            onValueChange={(value) => {
              const next = DIGITS_GROUPS.find(g => g.value === value)!;
              const nextContract = next.options[0].value as DigitsContractType;
              updateSettings({
                digitsContract: nextContract,
                ...(next.value !== "even_odd" ? { digitsSequenceStrategyEnabled: false } : {}),
              });
            }}
          >
            <SelectTrigger className="w-full bg-black/30 border-white/10 h-9 text-[11px]"><span className="flex-1 text-left truncate">{group.label}</span></SelectTrigger>
            <SelectContent className="bg-[#111114] border-white/10 text-white">
              {DIGITS_GROUPS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-[9px] text-muted-foreground uppercase font-black">Tipo de entrada</label>
          <Select
            value={settings.digitsContract}
            disabled={controlsLocked}
            onValueChange={(value) => updateSettings({ digitsContract: value as DigitsContractType })}
          >
            <SelectTrigger className="w-full bg-black/30 border-white/10 h-9 text-[11px]"><span className="flex-1 text-left truncate">{group.options.find(option => option.value === settings.digitsContract)?.label ?? settings.digitsContract}</span></SelectTrigger>
            <SelectContent className="bg-[#111114] border-white/10 text-white">
              {group.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className={cn("space-y-1", isParityContract && "opacity-45")}>
        <label className="text-[9px] text-muted-foreground uppercase font-black">Dígito alvo</label>
        <Select
          value={isParityContract ? "disabled" : String(settings.digitsTargetDigit)}
          disabled={isBotRunning || isParityContract}
          onValueChange={(value) => updateSettings({ digitsTargetDigit: value === "random" || value === "follow_up" ? value : Number(value) })}
        >
          <SelectTrigger className="w-full bg-black/30 border-white/10 h-9 text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#111114] border-white/10 text-white">
            {!isParityContract && <>
              {Array.from({ length: 10 }, (_, digit) => <SelectItem key={digit} value={String(digit)}>{digit}</SelectItem>)}
              <SelectItem value="random">Random</SelectItem>
              <SelectItem value="follow_up">Follow Up</SelectItem>
            </>}
          </SelectContent>
        </Select>
        <p className="text-[9px] text-muted-foreground/60">
          {isParityContract ? "Inativo para Even/Odd: a entrada é definida no selector acima." : "Escolhe o dígito alvo, Random ou Follow Up."}
        </p>
      </div>
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

const getLastTickDigit = (tick: { price: number; pipSize?: number } | null) => {
  return tick ? extractLastDigitFromTick(tick) : null;
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
  label, value, disabled, disabledPrevious, disabledNext, onPrevious, onNext,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  disabledPrevious?: boolean;
  disabledNext?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) => (
  <div className="space-y-1">
    <label className="text-[9px] text-muted-foreground uppercase font-black">{label}</label>
    <div className="flex items-center h-8 rounded-lg border border-white/10 bg-black/30 overflow-hidden">
      <button
        type="button"
        disabled={disabled || disabledPrevious}
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
        disabled={disabled || disabledNext}
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

// ── Modal de Estratégias Digits ─────────────────────────────────────────────
const DigitsStrategiesModal = ({ onClose }: { onClose: () => void }) => {
  const { settings: s, updateSettings } = useSettingsStore();
  const isParityContract = s.digitsContract === "DIGITEVEN" || s.digitsContract === "DIGITODD";
  const isOverUnderContract = s.digitsContract === "DIGITOVER" || s.digitsContract === "DIGITUNDER";
  const isDiffersContract = s.digitsContract === "DIGITDIFF";
  const isMatchContract = s.digitsContract === "DIGITMATCH";
  if (!isParityContract && !isOverUnderContract && !isDiffersContract && !isMatchContract) return null;

  const disabled = isBotRunningGlobally();
  const updateLength = (value: number, key: "digitsSequenceLength" | "digitsOverUnderSequenceLength") => {
    if (!Number.isFinite(value)) return;
    updateSettings({ [key]: Math.max(1, Math.min(100, Math.round(value))) });
  };
  const setBarrier = (key: "digitsOverUnderOverBarrier" | "digitsOverUnderUnderBarrier", value: number) => {
    const n = Math.max(0, Math.min(9, Math.round(value)));
    if (key === "digitsOverUnderOverBarrier") {
      updateSettings({ digitsOverUnderOverBarrier: Math.min(n, s.digitsOverUnderUnderBarrier - 1) });
    } else {
      updateSettings({ digitsOverUnderUnderBarrier: Math.max(n, s.digitsOverUnderOverBarrier + 1) });
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm bg-[#111114] border border-purple-500/20 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <p className="font-black text-sm uppercase tracking-widest flex items-center gap-2 text-white"><Target className="w-4 h-4 text-purple-400" /> Estratégias</p>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground"><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {isParityContract ? (
            <>
              <button type="button" onClick={() => updateSettings({ digitsSequenceStrategyEnabled: !s.digitsSequenceStrategyEnabled })} disabled={disabled} className={cn("w-full rounded-xl border p-3 text-left transition-all", s.digitsSequenceStrategyEnabled ? "border-purple-500/40 bg-purple-500/10" : "border-white/10 bg-white/[0.03]", disabled && "opacity-50 cursor-not-allowed")}>
                <div className="flex items-center gap-3"><div className={cn("w-5 h-5 rounded-md border flex items-center justify-center", s.digitsSequenceStrategyEnabled ? "border-purple-400 bg-purple-500/20" : "border-white/20 bg-black/20")}>{s.digitsSequenceStrategyEnabled && <span className="text-purple-300 text-[11px] font-black">✓</span>}</div><div><p className="text-[11px] font-black text-white">Sequência Par/Ímpar</p><p className="text-[9px] text-muted-foreground mt-0.5">A entrada é disparada no tick que completa a sequência.</p></div></div>
              </button>
              {s.digitsSequenceStrategyEnabled && <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <TextStepper label="Contrato" value={s.digitsContract === "DIGITEVEN" ? "Par" : "Ímpar"} disabled={disabled} onPrevious={() => updateSettings({ digitsContract: s.digitsContract === "DIGITEVEN" ? "DIGITODD" : "DIGITEVEN" })} onNext={() => updateSettings({ digitsContract: s.digitsContract === "DIGITEVEN" ? "DIGITODD" : "DIGITEVEN" })} />
                  <TextStepper label="Sequência" value={String(s.digitsSequenceLength)} disabled={disabled} onPrevious={() => updateLength(s.digitsSequenceLength - 1, "digitsSequenceLength")} onNext={() => updateLength(s.digitsSequenceLength + 1, "digitsSequenceLength")} />
                </div>
                <TextStepper label="Modo" value={s.digitsSequenceStrategyMode === "multiple" ? "Múltipla" : "Contrato selecionado"} disabled={disabled} onPrevious={() => updateSettings({ digitsSequenceStrategyMode: s.digitsSequenceStrategyMode === "multiple" ? "fixed" : "multiple" })} onNext={() => updateSettings({ digitsSequenceStrategyMode: s.digitsSequenceStrategyMode === "multiple" ? "fixed" : "multiple" })} />
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[10px] text-white leading-relaxed">{s.digitsSequenceStrategyMode === "multiple" ? <>{s.digitsSequenceLength} pares → <b>Ímpar</b><br />{s.digitsSequenceLength} ímpares → <b>Par</b></> : <>{s.digitsSequenceLength} {s.digitsContract === "DIGITEVEN" ? "ímpares" : "pares"} → <b>{s.digitsContract === "DIGITEVEN" ? "Par" : "Ímpar"}</b></>}</div>
              </div>}

              <button type="button" onClick={() => updateSettings({ digitsParityBlockDensityEnabled: !s.digitsParityBlockDensityEnabled })} disabled={disabled} className={cn("w-full rounded-xl border p-3 text-left transition-all", s.digitsParityBlockDensityEnabled ? "border-purple-500/40 bg-purple-500/10" : "border-white/10 bg-white/[0.03]", disabled && "opacity-50 cursor-not-allowed")}>
                <div className="flex items-center gap-3"><div className={cn("w-5 h-5 rounded-md border flex items-center justify-center", s.digitsParityBlockDensityEnabled ? "border-purple-400 bg-purple-500/20" : "border-white/20 bg-black/20")}>{s.digitsParityBlockDensityEnabled && <span className="text-purple-300 text-[11px] font-black">✓</span>}</div><div><p className="text-[11px] font-black text-white">Densidade de Bloco</p><p className="text-[9px] text-muted-foreground mt-0.5">Analisa a proporção Par/Ímpar numa janela curta e sinaliza a paridade minoritária.</p></div></div>
              </button>
              {s.digitsParityBlockDensityEnabled && <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <TextStepper label="Janela" value={`${s.digitsParityBlockWindow} ticks`} disabled={disabled} disabledPrevious={s.digitsParityBlockWindow <= 2} disabledNext={s.digitsParityBlockWindow >= 100} onPrevious={() => updateSettings({ digitsParityBlockWindow: Math.max(2, s.digitsParityBlockWindow - 1) })} onNext={() => updateSettings({ digitsParityBlockWindow: Math.min(100, s.digitsParityBlockWindow + 1) })} />
                  <TextStepper label="Limiar" value={`${s.digitsParityBlockThreshold.toFixed(0)}%`} disabled={disabled} disabledPrevious={s.digitsParityBlockThreshold <= 50} disabledNext={s.digitsParityBlockThreshold >= 100} onPrevious={() => updateSettings({ digitsParityBlockThreshold: Math.max(50, s.digitsParityBlockThreshold - 1) })} onNext={() => updateSettings({ digitsParityBlockThreshold: Math.min(100, s.digitsParityBlockThreshold + 1) })} />
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[9px] text-muted-foreground leading-relaxed">Padrão: <b className="text-white">10 ticks / 80%</b>. Ex.: 8 ímpares + 2 pares → entrada Par. É um filtro de desequilíbrio observado, não uma garantia de compensação no tick seguinte.</div>
              </div>}

              <button type="button" onClick={() => updateSettings({ digitsParityAlternatingEnabled: !s.digitsParityAlternatingEnabled })} disabled={disabled} className={cn("w-full rounded-xl border p-3 text-left transition-all", s.digitsParityAlternatingEnabled ? "border-purple-500/40 bg-purple-500/10" : "border-white/10 bg-white/[0.03]", disabled && "opacity-50 cursor-not-allowed")}>
                <div className="flex items-center gap-3"><div className={cn("w-5 h-5 rounded-md border flex items-center justify-center", s.digitsParityAlternatingEnabled ? "border-purple-400 bg-purple-500/20" : "border-white/20 bg-black/20")}>{s.digitsParityAlternatingEnabled && <span className="text-purple-300 text-[11px] font-black">✓</span>}</div><div><p className="text-[11px] font-black text-white">Padrão Intermitente</p><p className="text-[9px] text-muted-foreground mt-0.5">Detecta alternância estrita Par/Ímpar e entra repetindo a paridade do último tick.</p></div></div>
              </button>
              {s.digitsParityAlternatingEnabled && <div className="space-y-3">
                <TextStepper label="Alternância" value={`${s.digitsParityAlternatingLength} ticks`} disabled={disabled} disabledPrevious={s.digitsParityAlternatingLength <= 2} disabledNext={s.digitsParityAlternatingLength >= 20} onPrevious={() => updateSettings({ digitsParityAlternatingLength: Math.max(2, s.digitsParityAlternatingLength - 1) })} onNext={() => updateSettings({ digitsParityAlternatingLength: Math.min(20, s.digitsParityAlternatingLength + 1) })} />
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[9px] text-muted-foreground leading-relaxed">Padrão: <b className="text-white">4 ticks</b>. O trigger ocorre no próprio tick que completa a alternância.</div>
              </div>}

              <button type="button" onClick={() => updateSettings({ digitsParityAnchorEnabled: !s.digitsParityAnchorEnabled })} disabled={disabled} className={cn("w-full rounded-xl border p-3 text-left transition-all", s.digitsParityAnchorEnabled ? "border-purple-500/40 bg-purple-500/10" : "border-white/10 bg-white/[0.03]", disabled && "opacity-50 cursor-not-allowed")}>
                <div className="flex items-center gap-3"><div className={cn("w-5 h-5 rounded-md border flex items-center justify-center", s.digitsParityAnchorEnabled ? "border-purple-400 bg-purple-500/20" : "border-white/20 bg-black/20")}>{s.digitsParityAnchorEnabled && <span className="text-purple-300 text-[11px] font-black">✓</span>}</div><div><p className="text-[11px] font-black text-white">Dígito Âncora</p><p className="text-[9px] text-muted-foreground mt-0.5">Usa 0/9 como âncoras e valida os dois ticks anteriores.</p></div></div>
              </button>
              {s.digitsParityAnchorEnabled && <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[9px] text-muted-foreground leading-relaxed">Se sair 0 ou 9 e os dois ticks anteriores tiverem a mesma paridade da âncora, entra na paridade oposta. Histórico misto é ignorado.</div>}
            </>
          ) : isOverUnderContract ? (
            <>
              <button type="button" onClick={() => updateSettings({ digitsOverUnderSequenceStrategyEnabled: !s.digitsOverUnderSequenceStrategyEnabled })} disabled={disabled} className={cn("w-full rounded-xl border p-3 text-left transition-all", s.digitsOverUnderSequenceStrategyEnabled ? "border-purple-500/40 bg-purple-500/10" : "border-white/10 bg-white/[0.03]", disabled && "opacity-50 cursor-not-allowed")}>
                <div className="flex items-center gap-3"><div className={cn("w-5 h-5 rounded-md border flex items-center justify-center", s.digitsOverUnderSequenceStrategyEnabled ? "border-purple-400 bg-purple-500/20" : "border-white/20 bg-black/20")}>{s.digitsOverUnderSequenceStrategyEnabled && <span className="text-purple-300 text-[11px] font-black">✓</span>}</div><div><p className="text-[11px] font-black text-white">Sequência Over/Under</p><p className="text-[9px] text-muted-foreground mt-0.5">Alterna o contrato após uma sequência de dígitos do mesmo grupo.</p></div></div>
              </button>
              {s.digitsOverUnderSequenceStrategyEnabled && <div className="space-y-3">
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 text-[9px] text-muted-foreground leading-relaxed">Dígitos ≤ <b className="text-white">Over/barreira baixa</b> formam o grupo baixo. Dígitos ≥ <b className="text-white">Under/barreira alta</b> formam o grupo alto. Valores entre as duas barreiras são neutros e reiniciam a contagem.</div>
                <TextStepper label="Sequência" value={String(s.digitsOverUnderSequenceLength)} disabled={disabled} onPrevious={() => updateLength(s.digitsOverUnderSequenceLength - 1, "digitsOverUnderSequenceLength")} onNext={() => updateLength(s.digitsOverUnderSequenceLength + 1, "digitsOverUnderSequenceLength")} />
                <div className="grid grid-cols-2 gap-3">
                  <TextStepper label="Baixos até" value={String(s.digitsOverUnderOverBarrier)} disabled={disabled} disabledPrevious={s.digitsOverUnderOverBarrier <= 0} disabledNext={s.digitsOverUnderOverBarrier >= s.digitsOverUnderUnderBarrier - 1} onPrevious={() => setBarrier("digitsOverUnderOverBarrier", s.digitsOverUnderOverBarrier - 1)} onNext={() => setBarrier("digitsOverUnderOverBarrier", s.digitsOverUnderOverBarrier + 1)} />
                  <TextStepper label="Altos desde" value={String(s.digitsOverUnderUnderBarrier)} disabled={disabled} disabledPrevious={s.digitsOverUnderUnderBarrier <= s.digitsOverUnderOverBarrier + 1} disabledNext={s.digitsOverUnderUnderBarrier >= 9} onPrevious={() => setBarrier("digitsOverUnderUnderBarrier", s.digitsOverUnderUnderBarrier - 1)} onNext={() => setBarrier("digitsOverUnderUnderBarrier", s.digitsOverUnderUnderBarrier + 1)} />
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2 text-[10px] text-white leading-relaxed">
                  <p><b>Alto × {s.digitsOverUnderSequenceLength}</b> → <span className="text-yellow-300">Under {s.digitsOverUnderUnderBarrier}</span></p>
                  <p><b>Baixo × {s.digitsOverUnderSequenceLength}</b> → <span className="text-green-300">Over {s.digitsOverUnderOverBarrier}</span></p>
                  <p className="text-[9px] text-muted-foreground">Ex.: 5/6 = baixos 0–5 e altos 6–9. O tick que completa a sequência é o próprio trigger.</p>
                </div>
              </div>}
            </>
                    ) : isDiffersContract ? (
            <>
              <button type="button" onClick={() => updateSettings({ digitsPercentageSaturationStrategyEnabled: !s.digitsPercentageSaturationStrategyEnabled })} disabled={disabled} className={cn("w-full rounded-xl border p-3 text-left transition-all", s.digitsPercentageSaturationStrategyEnabled ? "border-purple-500/40 bg-purple-500/10" : "border-white/10 bg-white/[0.03]", disabled && "opacity-50 cursor-not-allowed")}>
                <div className="flex items-center gap-3"><div className={cn("w-5 h-5 rounded-md border flex items-center justify-center", s.digitsPercentageSaturationStrategyEnabled ? "border-purple-400 bg-purple-500/20" : "border-white/20 bg-black/20")}>{s.digitsPercentageSaturationStrategyEnabled && <span className="text-purple-300 text-[11px] font-black">✓</span>}</div><div><p className="text-[11px] font-black text-white">Differs por Saturação</p><p className="text-[9px] text-muted-foreground mt-0.5">Usa a janela percentual para detectar um dígito acima do limiar configurado.</p></div></div>
              </button>
              {s.digitsPercentageSaturationStrategyEnabled && <div className="space-y-3">
                <TextStepper label="Limiar de saturação" value={`${s.digitsPercentageSaturationThreshold.toFixed(0)}%`} disabled={disabled} disabledPrevious={s.digitsPercentageSaturationThreshold <= 11} disabledNext={s.digitsPercentageSaturationThreshold >= 100} onPrevious={() => updateSettings({ digitsPercentageSaturationThreshold: Math.max(10.01, s.digitsPercentageSaturationThreshold - 1) })} onNext={() => updateSettings({ digitsPercentageSaturationThreshold: Math.min(100, s.digitsPercentageSaturationThreshold + 1) })} />
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[9px] text-muted-foreground leading-relaxed">Janela estatística: <b className="text-white">{s.digitsPercentageWindow} ticks</b>. Ex.: com limiar de 18%, um dígito que atingir ≥18% gera sinal para <b className="text-white">Differs</b> contra esse dígito.</div>
              </div>}
            </>
          ) : isMatchContract ? (
            <>
              <button type="button" onClick={() => updateSettings({ digitsPercentageAbsenceStrategyEnabled: !s.digitsPercentageAbsenceStrategyEnabled })} disabled={disabled} className={cn("w-full rounded-xl border p-3 text-left transition-all", s.digitsPercentageAbsenceStrategyEnabled ? "border-purple-500/40 bg-purple-500/10" : "border-white/10 bg-white/[0.03]", disabled && "opacity-50 cursor-not-allowed")}>
                <div className="flex items-center gap-3"><div className={cn("w-5 h-5 rounded-md border flex items-center justify-center", s.digitsPercentageAbsenceStrategyEnabled ? "border-purple-400 bg-purple-500/20" : "border-white/20 bg-black/20")}>{s.digitsPercentageAbsenceStrategyEnabled && <span className="text-purple-300 text-[11px] font-black">✓</span>}</div><div><p className="text-[11px] font-black text-white">Vácuo Estatístico</p><p className="text-[9px] text-muted-foreground mt-0.5">Estratégia auditada: procura um dígito em ausência extrema e dispara um único Match.</p></div></div>
              </button>
              {s.digitsPercentageAbsenceStrategyEnabled && <div className="space-y-3">
                <TextStepper label="Streak de ausência" value={`${s.digitsPercentageAbsenceStreak} ticks`} disabled={disabled} disabledPrevious={s.digitsPercentageAbsenceStreak <= 1} disabledNext={s.digitsPercentageAbsenceStreak >= 10000} onPrevious={() => updateSettings({ digitsPercentageAbsenceStreak: Math.max(1, s.digitsPercentageAbsenceStreak - 1) })} onNext={() => updateSettings({ digitsPercentageAbsenceStreak: Math.min(10000, s.digitsPercentageAbsenceStreak + 1) })} />
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[9px] text-muted-foreground leading-relaxed">Auditoria: usa o mesmo streakWithoutAppearing da distribuição percentual. É um filtro de ausência extrema, não uma garantia de que o dígito terá de aparecer no próximo tick.</div>
              </div>}

              <button type="button" onClick={() => updateSettings({ digitsMatchTwinEnabled: !s.digitsMatchTwinEnabled })} disabled={disabled} className={cn("w-full rounded-xl border p-3 text-left transition-all", s.digitsMatchTwinEnabled ? "border-purple-500/40 bg-purple-500/10" : "border-white/10 bg-white/[0.03]", disabled && "opacity-50 cursor-not-allowed")}>
                <div className="flex items-center gap-3"><div className={cn("w-5 h-5 rounded-md border flex items-center justify-center", s.digitsMatchTwinEnabled ? "border-purple-400 bg-purple-500/20" : "border-white/20 bg-black/20")}>{s.digitsMatchTwinEnabled && <span className="text-purple-300 text-[11px] font-black">✓</span>}</div><div><p className="text-[11px] font-black text-white">Twin-Splitting</p><p className="text-[9px] text-muted-foreground mt-0.5">Após um dígito gémeo X,X, descansa N ticks e faz Match em X no tick seguinte.</p></div></div>
              </button>
              {s.digitsMatchTwinEnabled && <div className="space-y-3">
                <TextStepper label="Descanso" value={`${s.digitsMatchTwinRestTicks} ticks`} disabled={disabled} disabledPrevious={s.digitsMatchTwinRestTicks <= 0} disabledNext={s.digitsMatchTwinRestTicks >= 20} onPrevious={() => updateSettings({ digitsMatchTwinRestTicks: Math.max(0, s.digitsMatchTwinRestTicks - 1) })} onNext={() => updateSettings({ digitsMatchTwinRestTicks: Math.min(20, s.digitsMatchTwinRestTicks + 1) })} />
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[9px] text-muted-foreground leading-relaxed">Padrão: <b className="text-white">3 ticks de descanso</b>. Ex.: 4,4 → aguarda 3 ticks → Match 4 no 4.º tick posterior.</div>
              </div>}

              <button type="button" onClick={() => updateSettings({ digitsMatchMirrorEnabled: !s.digitsMatchMirrorEnabled })} disabled={disabled} className={cn("w-full rounded-xl border p-3 text-left transition-all", s.digitsMatchMirrorEnabled ? "border-purple-500/40 bg-purple-500/10" : "border-white/10 bg-white/[0.03]", disabled && "opacity-50 cursor-not-allowed")}>
                <div className="flex items-center gap-3"><div className={cn("w-5 h-5 rounded-md border flex items-center justify-center", s.digitsMatchMirrorEnabled ? "border-purple-400 bg-purple-500/20" : "border-white/20 bg-black/20")}>{s.digitsMatchMirrorEnabled && <span className="text-purple-300 text-[11px] font-black">✓</span>}</div><div><p className="text-[11px] font-black text-white">Simetria Espelho</p><p className="text-[9px] text-muted-foreground mt-0.5">Procura um quadrante totalmente seco e concentra os outros quadrantes antes de escolher o representante central.</p></div></div>
              </button>
              {s.digitsMatchMirrorEnabled && <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <TextStepper label="Janela" value={`${s.digitsMatchMirrorWindow} ticks`} disabled={disabled} disabledPrevious={s.digitsMatchMirrorWindow <= 4} disabledNext={s.digitsMatchMirrorWindow >= 100} onPrevious={() => updateSettings({ digitsMatchMirrorWindow: Math.max(4, s.digitsMatchMirrorWindow - 1) })} onNext={() => updateSettings({ digitsMatchMirrorWindow: Math.min(100, s.digitsMatchMirrorWindow + 1) })} />
                  <TextStepper label="Domínio" value={`${s.digitsMatchMirrorDominance.toFixed(0)}%`} disabled={disabled} disabledPrevious={s.digitsMatchMirrorDominance <= 50} disabledNext={s.digitsMatchMirrorDominance >= 100} onPrevious={() => updateSettings({ digitsMatchMirrorDominance: Math.max(50, s.digitsMatchMirrorDominance - 1) })} onNext={() => updateSettings({ digitsMatchMirrorDominance: Math.min(100, s.digitsMatchMirrorDominance + 1) })} />
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[9px] text-muted-foreground leading-relaxed">Padrão: <b className="text-white">15 ticks / 80%</b>. Ex.: se o quadrante Ímpar/Baixo (1,3) estiver seco, o alvo é <b className="text-white">3</b>. O filtro exige concentração observada nos dois maiores quadrantes.</div>
              </div>}
            </>
          ) : null}
        </div>
        <div className="px-5 pb-5"><Button onClick={onClose} className="w-full bg-purple-600 hover:bg-purple-700 font-black uppercase h-10">Guardar e Fechar</Button></div>
      </motion.div>
    </div>
  );
};

function isBotRunningGlobally() {
  const state = useBotStore.getState();
  return state.isBotRunning && !state.isBotPaused;
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

// ── DashboardPage ─────────────────────────────────────────────────────────────
export const DashboardPage = () => {
  const navigate = useNavigate();
  const { isAuthorized, activeAccount } = useConnectionStore();
  const { isBotRunning, isBotPaused, setIsBotRunning, pauseBot, resumeBot, lossCooldown, sessionStartedAt, sessionFrozenElapsed } = useBotStore();
  const { market, setMarket, symbol, setSymbol, candles, ticks, historicalTicksLoading, historicalTicksError, timeframe, setTimeframe } = useMarketStore();
  const { tabs, activeTabId, runningTabId, setRunningTabId, setTabSymbol } = useSyntheticTabsStore();
  const activeSyntheticTab = tabs.find(tab => tab.id === activeTabId) ?? null;
  const { settings, updateSettings } = useSettingsStore();

  // Em Digits, cada vela representa exactamente a duração configurada para
  // a entrada. A regra é visual/temporal e não depende do bot estar ligado.
  useEffect(() => {
    if (market !== "synthetic" || !activeSyntheticTab) return;
    const desired = activeSyntheticTab.kind === "digits"
      ? settings.contractDurationTicks
      : activeSyntheticTab.kind === "rise_fall"
        ? settings.riseFallDurationTicks
        : timeframe;
    if (activeSyntheticTab.kind !== "accumulators" && timeframe !== desired) setTimeframe(desired);
  }, [market, activeSyntheticTab?.kind, timeframe, settings.contractDurationTicks, settings.riseFallDurationTicks, setTimeframe]);

  useEffect(() => {
    if (activeSyntheticTab?.kind === "digits" && settings.digitsSymbol && activeSyntheticTab.symbol !== settings.digitsSymbol) {
      setTabSymbol(activeSyntheticTab.id, settings.digitsSymbol);
    }
  }, [activeSyntheticTab?.id, activeSyntheticTab?.kind, activeSyntheticTab?.symbol, settings.digitsSymbol, setTabSymbol]);
  const { runtime: digitsRuntime } = useDigitsStore();
  const { wins, losses, consecutiveLosses, pnl: rawPnl, modal, closeModal } = useSessionStore();
  const pnl = Number(rawPnl) || 0;
  const logEntries = useLogEntries(60);
  const timer = useSessionTimer(isBotRunning, sessionStartedAt, sessionFrozenElapsed);
  const [showDigitsConfig, setShowDigitsConfig] = useState(false);
  const [showDigitsStrategies, setShowDigitsStrategies] = useState(false);
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

  // Scroll interno do feed de logs. Só acompanha o fim enquanto o utilizador
  // estiver no fim; se ele subir para inspecionar ticks antigos, novos logs não
  // roubam a posição.
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const logsAtBottomRef = useRef(true);
  const handleLogsScroll = () => {
    const el = logsContainerRef.current;
    if (!el) return;
    logsAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
  };
  useEffect(() => {
    const el = logsContainerRef.current;
    if (el && logsAtBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [logEntries.length]);

  // A aba activa controla apenas o painel/feed visual. O motor em execução usa runningTabId,
  // permitindo trocar de aba sem transferir acidentalmente o contrato em execução para outro activo.
  useEffect(() => {
    if (market === "synthetic" && activeSyntheticTab && symbol !== activeSyntheticTab.symbol) {
      setSymbol(activeSyntheticTab.symbol);
    }
  }, [market, activeSyntheticTab?.id, activeSyntheticTab?.symbol, symbol, setSymbol]);

  // Redirecionar se sem Deriv
  useEffect(() => {
    if (!isAuthorized && !activeAccount) navigate("/");
  }, [isAuthorized, activeAccount]);

  const currentTick = ticks.length > 0 ? ticks[ticks.length - 1] : null;
  const currentPrice = currentTick?.price ?? null;
  const prevPrice = ticks.length > 1 ? ticks[ticks.length - 2].price : null;
  const isUp = currentPrice && prevPrice ? currentPrice >= prevPrice : true;
  const isParityContract = settings.digitsContract === "DIGITEVEN" || settings.digitsContract === "DIGITODD";
  const isOverUnderContract = settings.digitsContract === "DIGITOVER" || settings.digitsContract === "DIGITUNDER";
  const isDiffersContract = settings.digitsContract === "DIGITDIFF";
  const isMatchContract = settings.digitsContract === "DIGITMATCH";
  const hasDigitsStrategyContract = isParityContract || isOverUnderContract || isDiffersContract || isMatchContract;
  useEffect(() => { if (!hasDigitsStrategyContract) setShowDigitsStrategies(false); }, [hasDigitsStrategyContract]);
  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

  const logColors: Record<string, string> = {
    system: "text-blue-400", signal: "text-purple-300", block: "text-amber-400",
    trade: "text-emerald-400", risk: "text-orange-400", error: "text-red-400", telemetry: "text-cyan-300"
  };

  // Fase 1 do plano multi-mercado — ver forex_ux_architecture.md.
  // Mercado ainda não escolhido nesta sessão: mostra o selector em vez do
  // dashboard. Nenhum destes dois ramos toca no motor de trading nem no
  // resto da página abaixo — o dashboard de sintéticos continua exactamente
  // como sempre esteve quando market === "synthetic".
  if (market === null) return <MarketSelectScreen />;
  if (market === "forex") return <ForexDashboardPage />;
  if (!activeSyntheticTab) return <NoSyntheticTabs />;
  if (activeSyntheticTab.kind === "accumulators") return <AccumulatorDashboard tab={activeSyntheticTab} />;
  if (activeSyntheticTab.kind === "rise_fall") return (
    <>
      <div className="flex justify-end mb-2">
        <button onClick={() => !isBotRunning && setMarket(null)} disabled={isBotRunning} className="text-[9px] font-black uppercase tracking-wide text-muted-foreground/60 hover:text-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">⇄ Trocar mercado</button>
      </div>
      <SyntheticOperationTabs />
      <RiseFallDashboard tab={activeSyntheticTab} />
    </>
  );

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

      <SyntheticOperationTabs />

      {/* Fix 1: Layout 2 colunas desktop — usa grid com larguras fixas */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 min-h-0">

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
              <Badge className={cn(isBotRunning ? "bg-green-500/10 text-green-300 border-green-500/20" : "bg-white/5 text-muted-foreground border-white/10")}>{isBotPaused ? "PAUSADO" : isBotRunning ? "OPERANDO" : "PARADO"}</Badge>
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
              <StatusPill label="Duração" value={`${settings.contractDurationTicks} ${settings.contractDurationTicks === 1 ? "tick" : "ticks"}`} />
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
              <StatusPill label="Último dígito do tick" value={getLastTickDigit(currentTick) == null ? "—" : String(getLastTickDigit(currentTick))} />
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Button variant="outline" onClick={() => setShowDigitsConfig(true)}
              className="h-14 border-purple-500/40 text-purple-400 hover:bg-purple-500/10 gap-2 font-black uppercase text-[11px]">
              <Settings2 className="w-4 h-4" /> Gestão
            </Button>
            {hasDigitsStrategyContract && (
              <Button
                variant="outline"
                onClick={() => setShowDigitsStrategies(true)}
                className={cn("h-14 border-purple-500/40 text-purple-400 hover:bg-purple-500/10 gap-2 font-black uppercase text-[11px]", (settings.digitsSequenceStrategyEnabled || settings.digitsOverUnderSequenceStrategyEnabled || settings.digitsPercentageSaturationStrategyEnabled || settings.digitsPercentageAbsenceStrategyEnabled || settings.digitsMatchTwinEnabled || settings.digitsMatchMirrorEnabled) && "bg-purple-500/10 border-purple-400/60")}
              >
                <Target className="w-4 h-4" /> Estratégias
              </Button>
            )}
            <button onClick={() => {
              if (isBotRunning) { setIsBotRunning(false); setRunningTabId(null); }
              else { setRunningTabId(activeSyntheticTab.id); setIsBotRunning(true); }
            }} disabled={!isAuthorized || (isBotRunning && runningTabId !== activeSyntheticTab.id)}
              className={cn("h-14 rounded-xl border-2 font-black uppercase text-[11px] flex items-center justify-center gap-2 transition-all duration-300 disabled:opacity-40",
                isBotRunning && runningTabId === activeSyntheticTab.id ? "border-red-500/60 bg-red-500/10 text-red-400 shadow-lg shadow-red-500/20" : "border-green-500/40 bg-green-500/5 text-green-400 hover:bg-green-500/15")}>
              <Power className={cn("w-5 h-5", isBotRunning && "animate-pulse")} />
              {isBotRunning && runningTabId === activeSyntheticTab.id ? "Stop" : "Start"}
            </button>
            {isBotRunning && runningTabId === activeSyntheticTab.id && (
              <button type="button" onClick={() => isBotPaused ? resumeBot() : pauseBot()}
                className={cn("h-14 rounded-xl border-2 font-black uppercase text-[11px] flex items-center justify-center gap-2 transition-all", isBotPaused ? "border-green-500/40 bg-green-500/5 text-green-400 hover:bg-green-500/15" : "border-amber-500/40 bg-amber-500/5 text-amber-300 hover:bg-amber-500/15")}>
                {isBotPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                {isBotPaused ? "Continuar" : "Pausar"}
              </button>
            )}
          </div>

          {showCooldownBanner && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <p className="text-[10px] font-bold leading-tight">Cooldown de risco activo — retoma em {cooldownRemainingSec}s</p>
            </div>
          )}
        </div>

        {/* ══ COLUNA DIREITA ══════════════════════════════════════════════ */}
        <div className="flex flex-col gap-3 min-w-0 min-h-0">

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
            </div>
            <ErrorBoundary fallbackLabel="Erro no Gráfico">
              <DigitsMarketChart
                ticks={ticks}
                candles={candles}
                symbol={symbol}
                chartType={settings.digitsChartType}
                durationTicks={settings.contractDurationTicks}
                percentageWindow={settings.digitsPercentageWindow}
                historyLoading={historicalTicksLoading}
                historyError={historicalTicksError}
                disabled={isBotRunning && !isBotPaused}
                onSettingsChange={({ chartType, symbol: nextSymbol, durationTicks, percentageWindow }) => {
                  updateSettings({ digitsChartType: chartType as DigitsChartType, digitsSymbol: nextSymbol, contractDurationTicks: durationTicks, digitsPercentageWindow: percentageWindow });

                  // Fechar o menu sem trocar o ativo não pode limpar os 1.000
                  // ticks históricos. Só reinicializamos o feed quando o ativo
                  // realmente mudou. A duração apenas reagruppa os ticks já
                  // existentes em novas velas.
                  if (nextSymbol !== symbol) {
                    setTabSymbol(activeSyntheticTab.id, nextSymbol);
                    setSymbol(nextSymbol);
                  }
                  if (durationTicks !== timeframe) {
                    setTimeframe(durationTicks);
                  }
                }}
              />
            </ErrorBoundary>
          </NeonCard>

          {/* Fix 4: Histórico (2) + Logs (3) com scroll interno real */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-h-0">

            {/* Histórico — Fix 3 + Fix 4 */}
            <NeonCard variant="blue" className="p-4 flex flex-col min-h-0" style={{ height: "280px" }}>
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-2 shrink-0">
                Atividade em Tempo Real
              </p>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5"
                style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(59,130,246,0.3) transparent", overscrollBehavior: "contain", touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}>
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
            <NeonCard variant="purple" className="p-4 flex flex-col min-h-0" style={{ height: "280px" }}>
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-2 shrink-0">
                Logs em Tempo Real
              </p>
              <div
                ref={logsContainerRef}
                onScroll={handleLogsScroll}
                className="flex-1 min-h-0 overflow-y-auto font-mono"
                style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(124,58,237,0.3) transparent", overscrollBehavior: "contain", touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}>
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
        {showDigitsStrategies && <DigitsStrategiesModal onClose={() => setShowDigitsStrategies(false)} />}
      </AnimatePresence>
    </>
  );
};
