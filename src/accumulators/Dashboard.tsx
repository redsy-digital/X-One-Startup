import React, { useEffect, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Clock3, Layers3, Power, Settings2, ShieldCheck, TrendingUp, XCircle } from "lucide-react";
import { cn } from "../lib/utils";
import { NeonCard } from "../components/NeonCard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { AccumulatorChart } from "./Chart";
import { ACCUMULATOR_SYMBOLS } from "../constants";
import { useAccumulatorStore } from "./store";
import { getActiveAccumulatorEngine } from "./useAccumulatorEngine";
import { useBotStore } from "../store/useBotStore";
import { useConnectionStore } from "../store/useConnectionStore";
import { useMarketStore } from "../store/useMarketStore";
import { useSyntheticTabsStore, type SyntheticOperationTab } from "../synthetic/tabs";
import { useSessionStore } from "../store/useSessionStore";
import { SyntheticOperationTabs } from "../components/SyntheticOperationTabs";
import type { AccumulatorCloseMode, AccumulatorConfig } from "./types";
import { getTradeHistory } from "../lib/storage";
import { DEFAULT_ACCUMULATOR_FILTERS, calculateAccumulatorTickStats, type AccumulatorFiltersConfig } from "./filters";
import { derivService } from "../lib/deriv";
import type { TradeHistory } from "../types";

const DEFAULT_ACCU: AccumulatorConfig = {
  symbol: "1HZ100V", durationTicks: 20, stake: 1, targetProfit: 3.5, stopLoss: 6,
  useMartingale: true, martingaleMultiplier: 2.1, maxMartingaleSteps: 3,
  maxConsecutiveLosses: 5, cooldownAfterLoss: 30, growthRate: 0.01,
  closeMode: "ticks", profitPercentTarget: 25, contractTakeProfit: 0.5,
  useProfitMartingale: false, profitMartingaleTarget: 0.5,
  filters: { ...DEFAULT_ACCUMULATOR_FILTERS },
};

const Field = ({ label, value, step, min, max, disabled, onChange }: { label: string; value: number; step: string; min: number; max?: number; disabled: boolean; onChange: (v: number) => void }) => (
  <div className="space-y-1">
    <label className="text-[9px] text-muted-foreground uppercase font-black">{label}</label>
    <Input type="number" value={value} step={step} min={min} max={max} disabled={disabled} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.max(min, max === undefined ? n : Math.min(max, n))); }} className="bg-black/30 border-white/10 h-9 text-[11px]" />
  </div>
);

const TextStepper = ({ label, value, disabled, onPrevious, onNext }: { label: string; value: string; disabled?: boolean; onPrevious: () => void; onNext: () => void }) => (
  <div className="space-y-1">
    <label className="text-[9px] text-muted-foreground uppercase font-black">{label}</label>
    <div className="flex items-center h-9 rounded-lg border border-white/10 bg-black/30 overflow-hidden">
      <button type="button" disabled={disabled} onClick={onPrevious} className="h-full w-8 shrink-0 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-white/5 disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5" /></button>
      <div className="flex-1 text-center text-[11px] font-black text-cyan-300">{value}</div>
      <button type="button" disabled={disabled} onClick={onNext} className="h-full w-8 shrink-0 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-white/5 disabled:opacity-30"><ChevronRight className="w-3.5 h-3.5" /></button>
    </div>
  </div>
);

export const AccumulatorDashboard = ({ tab }: { tab: SyntheticOperationTab }) => {
  const { isAuthorized, balance } = useConnectionStore();
  const { isBotRunning, setIsBotRunning } = useBotStore();
  const { runtime } = useAccumulatorStore();
  const { setTabSymbol, updateAccumulator } = useSyntheticTabsStore();
  const { candles } = useMarketStore();
  const { wins: sessionWins, losses: sessionLosses, pnl: sessionPnl } = useSessionStore();
  const [showRisk, setShowRisk] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showTicksCount, setShowTicksCount] = useState(false);
  const [closing, setClosing] = useState(false);

  const tabConfig: AccumulatorConfig = { ...DEFAULT_ACCU, ...(tab.accumulator ?? {}), symbol: tab.symbol, filters: { ...DEFAULT_ACCUMULATOR_FILTERS, ...(tab.accumulator?.filters ?? {}) } };
  const [manualStake, setManualStake] = useState<number>(tabConfig.stake);
  const [manualGrowthRate, setManualGrowthRate] = useState<number>(tabConfig.growthRate);
  const [history, setHistory] = useState<TradeHistory[]>(() => getTradeHistory().filter(t => t.market === "synthetic" && t.type === "ACCU"));

  useEffect(() => {
    setManualStake(tabConfig.stake);
    setManualGrowthRate(tabConfig.growthRate);
  }, [tabConfig.stake, tabConfig.growthRate]);

  useEffect(() => {
    const refresh = () => setHistory(getTradeHistory().filter(t => t.market === "synthetic" && t.type === "ACCU"));
    window.addEventListener("trade_history_updated", refresh);
    return () => window.removeEventListener("trade_history_updated", refresh);
  }, []);
  const { symbol, durationTicks: ticks, stake, targetProfit, stopLoss, useMartingale, martingaleMultiplier: multiplier, maxMartingaleSteps: maxSteps, maxConsecutiveLosses: maxLosses, cooldownAfterLoss: cooldown, growthRate, closeMode, profitPercentTarget, contractTakeProfit, useProfitMartingale, profitMartingaleTarget, filters } = tabConfig;
  const update = (partial: Partial<AccumulatorConfig>) => updateAccumulator(tab.id, partial);
  const runningHere = isBotRunning && useSyntheticTabsStore.getState().runningTabId === tab.id;
  const anotherTabRunning = isBotRunning && !runningHere;
  const canStart = isAuthorized && !anotherTabRunning;

  const toggleBot = () => {
    const tabs = useSyntheticTabsStore.getState();
    if (isBotRunning) {
      if (tabs.runningTabId === tab.id) { setIsBotRunning(false); tabs.setRunningTabId(null); }
      return;
    }
    tabs.setRunningTabId(tab.id);
    setIsBotRunning(true);
  };

  const openOrClose = async () => {
    const engine = getActiveAccumulatorEngine();
    if (!engine) return;
    setClosing(true);
    if (runtime.activeContractId) await engine.closeActiveContract(); else await engine.openManualContract({ stake: manualStake, growthRate: manualGrowthRate });
    setClosing(false);
  };

  const pnl = Number(runtime.lastProfit ?? 0);
  const currentProfit = runtime.currentProfit ?? 0;
  const currentProfitPercent = runtime.currentProfitPercent ?? 0;
  const targetLabel = runtime.profitMartingaleActive
    ? `$${profitMartingaleTarget.toFixed(2)}`
    : closeMode === "profit_percent" ? `${profitPercentTarget.toFixed(2)}%` : closeMode === "contract_take_profit" ? `$${contractTakeProfit.toFixed(2)}` : `${ticks} ticks`;

  return (
    <div className="space-y-3">
      <SyntheticOperationTabs />
      <div className="flex items-center justify-between mb-2">
        <div><p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Accumulators V1</p><p className="text-[11px] text-white font-black mt-1">Fluxo fixo · abre → monitora → fecha → repete</p></div>
        <Badge className="bg-cyan-500/10 text-cyan-300 border-cyan-500/20">ACCU</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        <div className="flex flex-col gap-3">
          <NeonCard variant="purple" className="p-4 space-y-3">
            <div className="flex items-center justify-between"><p className="text-[9px] uppercase tracking-widest font-black text-muted-foreground">Configuração Accumulator</p><Layers3 className="w-4 h-4 text-cyan-400" /></div>
            <div className="space-y-1"><label className="text-[9px] uppercase font-black text-muted-foreground">Ativo</label><Select value={tab.symbol} disabled={isBotRunning} onValueChange={v => { setTabSymbol(tab.id, v); update({ symbol: v }); }}><SelectTrigger className="w-full bg-black/30 border-white/10 h-9 text-[11px]"><SelectValue /></SelectTrigger><SelectContent className="bg-[#111114] border-white/10 text-white">{ACCUMULATOR_SYMBOLS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Ticks" value={ticks} step="1" min={1} disabled={isBotRunning || closeMode !== "ticks"} onChange={v => update({ durationTicks: v })} />
              <TextStepper label="Growth Rate" value={`${Math.round(growthRate * 100)}%`} disabled={isBotRunning} onPrevious={() => update({ growthRate: Math.max(0.01, Number((growthRate - 0.01).toFixed(2))) })} onNext={() => update({ growthRate: Math.min(0.05, Number((growthRate + 0.01).toFixed(2))) })} />
            </div>
            <div className="space-y-1"><label className="text-[9px] uppercase font-black text-muted-foreground">Fecho do contrato</label><Select value={closeMode} disabled={isBotRunning} onValueChange={v => update({ closeMode: v as AccumulatorCloseMode })}><SelectTrigger className="w-full bg-black/30 border-white/10 h-9 text-[11px]"><SelectValue /></SelectTrigger><SelectContent className="bg-[#111114] border-white/10 text-white"><SelectItem value="ticks">Acúmulo de ticks</SelectItem><SelectItem value="profit_percent">Percentagem do Contract Profit</SelectItem><SelectItem value="contract_take_profit">Take Profit do contrato</SelectItem></SelectContent></Select></div>
            {closeMode === "profit_percent" && <Field label="Profit alvo (%)" value={profitPercentTarget} step="1" min={0.01} disabled={isBotRunning} onChange={v => update({ profitPercentTarget: v })} />}
            {closeMode === "contract_take_profit" && <Field label="Take Profit do contrato ($)" value={contractTakeProfit} step="0.01" min={0.01} disabled={isBotRunning} onChange={v => update({ contractTakeProfit: v })} />}
            <p className="text-[9px] text-muted-foreground/60">O modo escolhido é exclusivo. O ACCU permanece sem expiração; estes parâmetros são regras de saída do X-ONE.</p>
          </NeonCard>

          <NeonCard variant="blue" className="p-4 space-y-3">
            <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Clock3 className="w-4 h-4 text-blue-400" /><p className="text-[9px] uppercase tracking-widest font-black text-muted-foreground">Contrato activo</p></div><Badge className={runtime.activeContractId ? "bg-green-500/10 text-green-300" : "bg-white/5 text-muted-foreground"}>{runtime.activeContractId ? "ABERTO" : "PARADO"}</Badge></div>
            <div className="grid grid-cols-2 gap-2"><Metric label="Ticks" value={`${runtime.ticksElapsed}${runtime.ticksTarget ? ` / ${runtime.ticksTarget}` : ""}`} /><Metric label="Contract Profit" value={`$${currentProfit.toFixed(2)}`} /><Metric label="Profit %" value={`${currentProfitPercent.toFixed(2)}%`} /><Metric label="Alvo de fecho" value={targetLabel} /></div>
          </NeonCard>

          <NeonCard variant="blue" className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] uppercase tracking-widest font-black text-muted-foreground">Operação manual</p>
                <p className="text-[10px] text-white font-black mt-1">Configuração independente da gestão automática</p>
              </div>
              <Activity className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stake ($)" value={manualStake} step="0.01" min={1} disabled={Boolean(runtime.activeContractId) || anotherTabRunning || closing} onChange={setManualStake} />
              <TextStepper label="Growth Rate" value={`${Math.round(manualGrowthRate * 100)}%`} disabled={Boolean(runtime.activeContractId) || anotherTabRunning || closing} onPrevious={() => setManualGrowthRate(v => Math.max(0.01, Number((v - 0.01).toFixed(2))))} onNext={() => setManualGrowthRate(v => Math.min(0.05, Number((v + 0.01).toFixed(2))))} />
            </div>
          </NeonCard>

          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" onClick={() => setShowFilters(true)} className="h-12 border-cyan-500/40 text-cyan-300 font-black uppercase text-[9px]"><Activity className="w-4 h-4 mr-1" /> Filtros</Button>
            <Button variant="outline" onClick={() => setShowTicksCount(true)} className="h-12 border-blue-500/40 text-blue-300 font-black uppercase text-[9px]"><Clock3 className="w-4 h-4 mr-1" /> Ticks Count</Button>
            <Button variant="outline" onClick={() => setShowRisk(true)} className="h-12 border-purple-500/40 text-purple-400 font-black uppercase text-[10px]"><Settings2 className="w-4 h-4 mr-2" /> Gestão</Button>
            <Button onClick={toggleBot} disabled={!canStart || !isAuthorized} className={cn("h-12 font-black uppercase text-[10px]", isBotRunning && runningHere ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700")}>{isBotRunning && runningHere ? <><Power className="w-4 h-4 mr-2" /> Stop</> : <><Power className="w-4 h-4 mr-2" /> Start</>}</Button>
          </div>
          <Button onClick={openOrClose} disabled={!isAuthorized || closing || anotherTabRunning} variant="outline" className={cn("h-12 font-black uppercase text-[10px]", runtime.activeContractId ? "border-red-500/40 text-red-400 hover:bg-red-500/10" : "border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10")}><XCircle className="w-4 h-4 mr-2" /> {closing ? (runtime.activeContractId ? "A fechar..." : "A abrir...") : (runtime.activeContractId ? "Fechar contrato" : "Abrir contrato")}</Button>
          {anotherTabRunning && <p className="text-[9px] text-amber-400 text-center font-bold">Outro separador está a operar. O Start desta aba está bloqueado.</p>}
          {Object.values(filters).some(Boolean) && <div className={cn("text-[9px] rounded-lg px-3 py-2 border font-bold", runtime.filterBlocked ? "text-amber-300 bg-amber-500/10 border-amber-500/20" : "text-cyan-300 bg-cyan-500/10 border-cyan-500/20")}>{runtime.filterBlocked ? `Entrada pausada · ${runtime.filterWaitTicksRemaining} ticks restantes` : `Filtros ativos · ${Object.values(filters).filter(Boolean).length}/5 · ${runtime.filterSamples} ticks em buffer`}{runtime.filterBlocked && runtime.filterReasons.length > 0 ? ` · ${runtime.filterReasons.join(" · ")}` : ""}</div>}
          {runtime.error && <p className="text-[9px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 font-bold">{runtime.error}</p>}
        </div>

        <div className="flex flex-col gap-3 min-w-0">
          <NeonCard variant="purple" className="p-4"><div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-cyan-400" /><span className="text-xl font-black text-cyan-400">{runtime.currentSpot != null ? runtime.currentSpot.toFixed(2) : "---"}</span><Badge className="bg-cyan-500/10 text-cyan-300 border-cyan-500/20">LIVE</Badge></div><span className="text-[9px] font-black text-muted-foreground">{tab.symbol}</span></div><AccumulatorChart candles={candles} points={runtime.chartPoints} symbol={tab.symbol} /></NeonCard>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <NeonCard variant="blue" className="p-4">
              <div className="flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-cyan-400" /><p className="text-[9px] uppercase font-black tracking-widest text-muted-foreground">Contrato</p></div>
              <div className="grid grid-cols-2 gap-2"><Metric label="ID ativo" value={runtime.activeContractId ?? "—"} /><Metric label="Valor actual" value={runtime.currentValue != null ? `$${runtime.currentValue.toFixed(2)}` : "—"} /><Metric label="Resultado" value={runtime.lastResult ?? "—"} /><Metric label="P/L" value={runtime.lastProfit != null ? `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}` : "—"} /></div>
            </NeonCard>
            <NeonCard variant="purple" className="p-4">
              <div className="flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-cyan-400" /><p className="text-[9px] uppercase font-black tracking-widest text-muted-foreground">P&L da sessão</p></div>
              <div className="grid grid-cols-4 gap-2"><Metric label="P&L" value={`${sessionPnl >= 0 ? "+" : ""}$${sessionPnl.toFixed(2)}`} /><Metric label="WIN" value={String(sessionWins)} /><Metric label="LOSS" value={String(sessionLosses)} /><Metric label="TOTAL" value={String(sessionWins + sessionLosses)} /></div>
              <p className="text-[8px] text-muted-foreground text-center mt-2">Realizado pela sessão · não inclui o lucro/prejuízo do contrato ainda aberto.</p>
            </NeonCard>
            <NeonCard variant="purple" className="p-4">
              <div className="flex items-center gap-2 mb-3"><ShieldCheck className="w-4 h-4 text-green-400" /><p className="text-[9px] uppercase font-black tracking-widest text-muted-foreground">Gestão de banca</p></div>
              <div className="grid grid-cols-2 gap-2"><Metric label="TP sessão" value={`$${targetProfit.toFixed(2)}`} /><Metric label="SL sessão" value={`$${stopLoss.toFixed(2)}`} /><Metric label="Stake base" value={`$${stake.toFixed(2)}`} /><Metric label="Martingale" value={useMartingale ? `${runtime.martingaleStep} / ${maxSteps}` : "OFF"} /></div>
            </NeonCard>
          </div>
          <NeonCard variant="purple" className="p-4 flex flex-col h-[280px]">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Histórico Accumulators</p>
              <span className="text-[8px] text-muted-foreground font-bold">{history.length} operações</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5" style={{ scrollbarWidth: "thin", overscrollBehavior: "contain" }}>
              {history.slice(0, 30).length === 0 ? (
                <div className="flex items-center justify-center h-full opacity-20"><p className="text-[10px] uppercase font-bold text-muted-foreground">Sem operações</p></div>
              ) : history.slice(0, 30).map(trade => (
                <div key={trade.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/5 border border-white/5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[8px] font-black shrink-0", trade.status === "WON" ? "bg-green-500/15 text-green-400" : trade.status === "LOST" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400")}>
                      {trade.status === "WON" ? "W" : trade.status === "LOST" ? "L" : "…"}
                    </div>
                    <div className="min-w-0"><p className="text-[9px] font-black text-white truncate">ACCU · {trade.symbol}</p><p className="text-[8px] text-muted-foreground">{new Date(trade.time).toLocaleTimeString()}</p></div>
                  </div>
                  <div className="text-right shrink-0"><p className="text-[8px] text-muted-foreground">Stake ${Number(trade.stake || 0).toFixed(2)}</p><span className={cn("text-[10px] font-black", trade.status === "PENDING" ? "text-amber-400" : Number(trade.profit || 0) >= 0 ? "text-green-400" : "text-red-400")}>{trade.status === "PENDING" ? "Pendente" : `${Number(trade.profit || 0) >= 0 ? "+" : ""}$${Number(trade.profit || 0).toFixed(2)}`}</span></div>
                </div>
              ))}
            </div>
          </NeonCard>
        </div>
      </div>

      {runtime.sessionLimitReached && (
        <SessionLimitModal
          type={runtime.sessionLimitReached.type}
          amount={runtime.sessionLimitReached.amount}
          reason={runtime.sessionLimitReached.reason}
          onClose={() => useAccumulatorStore.getState().setRuntime({ sessionLimitReached: null })}
        />
      )}

      {showRisk && <RiskModal values={tabConfig} onChange={update} onClose={() => setShowRisk(false)} />}
      {showFilters && <FiltersModal values={filters} onChange={(next) => update({ filters: next })} onClose={() => setShowFilters(false)} disabled={isBotRunning} />}
      {showTicksCount && <TicksCountModal symbol={symbol} growthRate={growthRate} onClose={() => setShowTicksCount(false)} />}
    </div>
  );
};


const FiltersModal = ({ values, onChange, onClose, disabled }: { values: AccumulatorFiltersConfig; onChange: (next: AccumulatorFiltersConfig) => void; onClose: () => void; disabled: boolean }) => {
  const items: Array<[keyof AccumulatorFiltersConfig, string, string]> = [
    ["tickRange", "Filtro por desvio padrão dos ticks", "Compara o range dos últimos 12 ticks com o range médio recente."],
    ["microTrend", "Filtro de micro tendência", "Bloqueia quando SMA 5/20 e a inclinação mostram movimento forte."],
    ["consecutiveTicks", "Contador de ticks consecutivos", "Bloqueia após 4 ticks consecutivos na mesma direção."],
    ["bollinger", "Filtro de Bollinger", "Permite entrada apenas perto da linha central das bandas."],
    ["simpleVolatility", "Filtro de volatilidade simples", "Bloqueia picos de amplitude dinâmica antes da nova entrada."],
  ];
  return <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"><div className="w-full max-w-md bg-[#111114] border border-cyan-500/20 rounded-2xl p-5 space-y-4"><div className="flex items-center justify-between"><div><p className="text-sm font-black uppercase tracking-widest text-white">Filtros de entrada</p><p className="text-[9px] text-muted-foreground mt-1">Todos os filtros ativos precisam permitir a entrada.</p></div><button onClick={onClose}><XCircle className="w-4 h-4 text-muted-foreground" /></button></div><div className="space-y-2">{items.map(([key, label, description]) => <button key={key} type="button" disabled={disabled} onClick={() => onChange({ ...values, [key]: !values[key] })} className="w-full text-left rounded-xl border border-white/10 bg-white/5 p-3 flex items-center gap-3 disabled:opacity-50"><span className={cn("w-5 h-5 rounded-md border flex items-center justify-center shrink-0", values[key] ? "bg-cyan-500/20 border-cyan-400 text-cyan-300" : "border-white/20")}>{values[key] ? "✓" : ""}</span><span className="min-w-0"><p className="text-[10px] font-black text-white">{label}</p><p className="text-[8px] text-muted-foreground mt-0.5">{description}</p></span></button>)}</div><div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3"><p className="text-[8px] text-amber-300 leading-relaxed">Os filtros são conservadores e trabalham apenas como gatilho de entrada. Se nenhum estiver ativo, o ciclo mecânico original continua sem alteração. A entrada manual não é bloqueada pelos filtros.</p></div><Button onClick={onClose} className="w-full bg-cyan-600 hover:bg-cyan-700 font-black uppercase">Guardar e Fechar</Button></div></div>;
};

const TicksCountModal = ({ symbol, growthRate, onClose }: { symbol: string; growthRate: number; onClose: () => void }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<import("./filters").AccumulatorTickHistoryStats | null>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    derivService.getRawTicksHistory(symbol, 5000).then(({ prices }) => {
      if (!alive) return;
      setStats(calculateAccumulatorTickStats(symbol, growthRate, prices));
      setLoading(false);
    }).catch((e: any) => { if (!alive) return; setError(e?.message || "Não foi possível obter o histórico de ticks."); setLoading(false); });
    return () => { alive = false; };
  }, [symbol, growthRate]);
  return <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"><div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-[#111114] border border-blue-500/20 rounded-2xl p-5 space-y-4"><div className="flex items-center justify-between"><div><p className="text-sm font-black uppercase tracking-widest text-white">Ticks Count</p><p className="text-[9px] text-muted-foreground mt-1">{symbol} · Growth Rate {Math.round(growthRate * 100)}%</p></div><button onClick={onClose}><XCircle className="w-4 h-4 text-muted-foreground" /></button></div>{loading ? <div className="py-12 text-center text-[10px] text-muted-foreground font-bold uppercase">A carregar ticks diretamente da Deriv...</div> : error ? <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-[10px] text-red-300 font-bold">{error}</div> : stats ? <><div className="grid grid-cols-2 gap-2">{[["Máx. sequência segura", `${stats.maxSafeRun} ticks`],["Média", `${stats.averageSafeRun.toFixed(1)} ticks`],["Mediana", `${stats.medianSafeRun} ticks`],["Menor sequência", `${stats.shortestSafeRun} ticks`],["Knockouts simulados", String(stats.knockoutCount)],["Taxa de knockout", `${(stats.knockoutRate * 100).toFixed(2)}%`],["Maior sequência ↑", `${stats.longestUpRun} ticks`],["Maior sequência ↓", `${stats.longestDownRun} ticks`]] .map(([label,value]) => <div key={label}><Metric label={label} value={value} /></div>)}</div><div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-[8px] uppercase tracking-widest text-muted-foreground font-black">Maior variação de um tick</p><p className="text-lg font-black text-white mt-1">{stats.largestAbsoluteTickMovePercent.toFixed(4)}%</p><p className="text-[8px] text-muted-foreground mt-1">Amostra: {stats.analyzedTicks.toLocaleString()} transições históricas.</p></div><p className="text-[8px] text-amber-300/80 leading-relaxed">Esta análise usa ticks históricos reais da Deriv e reproduz, para o Growth Rate selecionado, uma aproximação do intervalo por tick. É uma estatística histórica para ajudar na configuração; não é previsão nem garantia de comportamento futuro.</p></> : null}<Button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 font-black uppercase">Fechar</Button></div></div>;
};


const SessionLimitModal = ({ type, amount, reason, onClose }: { type: "take_profit" | "stop_loss"; amount: number; reason: string; onClose: () => void }) => (
  <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <div className={cn("w-full max-w-sm rounded-2xl border p-5 space-y-4 bg-[#111114]", type === "take_profit" ? "border-green-500/30" : "border-red-500/30")}>
      <div className="flex items-center gap-3">
        <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center", type === "take_profit" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
          {type === "take_profit" ? <ShieldCheck className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
        </div>
        <div><p className="text-[9px] uppercase tracking-widest font-black text-muted-foreground">Sessão encerrada</p><p className="text-base font-black text-white mt-0.5">{type === "take_profit" ? "Take Profit atingido" : "Stop Loss atingido"}</p></div>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center"><p className="text-[9px] uppercase tracking-widest text-muted-foreground font-black">Resultado da sessão</p><p className={cn("text-2xl font-black mt-1", type === "take_profit" ? "text-green-400" : "text-red-400")}>{amount >= 0 ? "+" : ""}${amount.toFixed(2)}</p></div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">{reason}. O bot foi parado para impedir novas entradas.</p>
      <Button onClick={onClose} className={cn("w-full font-black uppercase", type === "take_profit" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700")}>Entendido</Button>
    </div>
  </div>
);

const Metric = ({ label, value }: { label: string; value: string }) => <div className="rounded-xl border border-white/5 bg-white/5 p-2.5 text-center"><p className="text-[8px] uppercase text-muted-foreground font-bold truncate">{label}</p><p className="text-xs font-black text-white mt-1 truncate">{value}</p></div>;

function RiskModal({ values, onChange, onClose }: { values: AccumulatorConfig; onChange: (patch: Partial<AccumulatorConfig>) => void; onClose: () => void }) {
  const { isBotRunning } = useBotStore();
  const disabled = isBotRunning;
  return <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4"><div className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-[#111114] border border-cyan-500/20 rounded-2xl p-5 space-y-4"><div className="flex justify-between items-center"><p className="text-sm font-black uppercase tracking-widest">Gestão Accumulators</p><button onClick={onClose}><XCircle className="w-4 h-4 text-muted-foreground" /></button></div>
    <div className="grid grid-cols-2 gap-3"><Field label="Stake Base ($)" value={values.stake} step="0.01" min={1} disabled={disabled} onChange={v=>onChange({stake:v})} /><Field label="TP da sessão ($)" value={values.targetProfit} step="0.01" min={0} disabled={disabled} onChange={v=>onChange({targetProfit:v})} /><Field label="Stop Loss ($)" value={values.stopLoss} step="0.01" min={0} disabled={disabled} onChange={v=>onChange({stopLoss:v})} /><Field label="Máx. perdas seg." value={values.maxConsecutiveLosses} step="1" min={1} disabled={disabled} onChange={v=>onChange({maxConsecutiveLosses:v})} /></div>
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3"><div className="flex justify-between items-center"><div><p className="text-[11px] font-black">Martingale</p><p className="text-[9px] text-muted-foreground">Multiplica apenas a Stake Base após LOSS.</p></div><Toggle value={values.useMartingale} disabled={disabled} onClick={()=>onChange({useMartingale:!values.useMartingale})}/></div>{values.useMartingale&&<div className="grid grid-cols-2 gap-3"><Field label="Steps máximos" value={values.maxMartingaleSteps} step="1" min={0} disabled={disabled} onChange={v=>onChange({maxMartingaleSteps:v})} /><Field label="Multiplicador" value={values.martingaleMultiplier} step="0.1" min={1} disabled={disabled} onChange={v=>onChange({martingaleMultiplier:v})} /></div>}</div>
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3"><div className="flex justify-between items-center"><div><p className="text-[11px] font-black">Profit Martingale</p><p className="text-[9px] text-muted-foreground">Após KNOCK-OUT, o próximo contrato fecha ao atingir o profit definido.</p></div><Toggle value={values.useProfitMartingale} disabled={disabled} onClick={()=>onChange({useProfitMartingale:!values.useProfitMartingale})}/></div>{values.useProfitMartingale&&<Field label="Profit após KNOCK-OUT ($)" value={values.profitMartingaleTarget} step="0.01" min={0.01} disabled={disabled} onChange={v=>onChange({profitMartingaleTarget:v})}/>}</div>
    <Field label="Cooldown após limite (s)" value={values.cooldownAfterLoss} step="1" min={0} disabled={disabled} onChange={v=>onChange({cooldownAfterLoss:v})} />
    <Button onClick={onClose} className="w-full bg-cyan-600 hover:bg-cyan-700 font-black uppercase">Guardar e Fechar</Button></div></div>;
}

const Toggle = ({ value, disabled, onClick }: { value: boolean; disabled: boolean; onClick: () => void }) => <button type="button" disabled={disabled} onClick={onClick} className={cn("w-10 h-6 rounded-full disabled:opacity-40", value ? "bg-cyan-600" : "bg-white/10")}><span className={cn("block w-4 h-4 bg-white rounded-full mx-0.5 transition-transform", value ? "translate-x-4" : "translate-x-0")} /></button>;
