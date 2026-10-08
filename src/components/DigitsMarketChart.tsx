import React, { useMemo, useState } from "react";
import { Check, Menu, BarChart3, CircleDot, CandlestickChart } from "lucide-react";
import { cn } from "../lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { TradingChart } from "./TradingChart";
import { SYMBOLS } from "../constants";
import type { TickData } from "../types";
import { extractLastDigitFromTick } from "../digits/digit";
import { calculateDigitPercentageStats, MIN_DIGIT_PERCENTAGE_WINDOW, MAX_DIGIT_PERCENTAGE_WINDOW } from "../digits/percentageStats";

export type DigitsChartType = "digits" | "percentage" | "candles";

const CHART_TYPE_LABELS: Record<DigitsChartType, string> = {
  digits: "Gráfico de Dígitos",
  percentage: "Gráfico de Percentual de Dígitos",
  candles: "Gráfico de Velas",
};

const isEven = (digit: number) => digit % 2 === 0;
const digitClass = (digit: number) => isEven(digit) ? "text-green-400" : "text-amber-300";
const digitBg = (digit: number) => isEven(digit) ? "border-green-500/30 bg-green-500/5" : "border-amber-500/30 bg-amber-500/5";



function DigitHistoryChart({ ticks }: { ticks: TickData[] }) {
  const digits = useMemo(() => ticks.map(t => extractLastDigitFromTick(t)).filter((d): d is number => d != null), [ticks]);
  const visible = digits.slice(-100);
  const latest = visible[visible.length - 1] ?? null;

  return (
    <div className="relative min-h-[280px] rounded-xl border border-white/5 bg-black/20 p-4 flex flex-col">
      <div className="flex-1 flex items-center justify-center min-h-[170px]">
        {latest == null ? (
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground animate-pulse">A carregar histórico de dígitos...</p>
        ) : (
          <div className={cn("w-32 h-32 md:w-36 md:h-36 rounded-[2rem] border-2 flex items-center justify-center bg-black/30", digitBg(latest))}>
            <span className={cn("text-8xl md:text-9xl leading-none font-black font-mono", digitClass(latest))}>{latest}</span>
          </div>
        )}
      </div>
      <div className="border-t border-white/5 pt-3 overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
        <div className="flex items-center gap-2 min-w-max px-1">
          {visible.map((digit, index) => (
            <div key={`${index}-${digit}`} className={cn("w-9 h-9 shrink-0 rounded-full border flex items-center justify-center font-black font-mono text-sm", digitBg(digit), digitClass(digit))}>
              {digit}
            </div>
          ))}
        </div>
      </div>
      <p className="text-[8px] text-muted-foreground/60 mt-2 text-right">Últimos {visible.length} dígitos · histórico carregado: {digits.length}</p>
    </div>
  );
}

function DigitPercentageChart({ ticks, windowSize }: { ticks: TickData[]; windowSize: number }) {
  const { stats, sampleSize, latestDigit } = useMemo(
    () => calculateDigitPercentageStats(ticks, windowSize),
    [ticks, windowSize],
  );
  const max = Math.max(1, ...stats.map((item) => item.percent));

  return (
    <div className="relative min-h-[280px] rounded-xl border border-white/5 bg-black/20 p-4 flex flex-col">
      <div className="flex items-center justify-between gap-3 h-10 shrink-0">
        <p className="text-lg md:text-xl font-black text-white">
          Último Dígito: <span className={latestDigit == null ? "text-white" : digitClass(latestDigit)}>{latestDigit ?? "—"}</span>
        </p>
        <span className="text-[8px] md:text-[9px] uppercase tracking-widest text-muted-foreground font-black">
          Janela: {windowSize} ticks
        </span>
      </div>
      <div className="flex-1 flex items-end gap-1 md:gap-2 px-1 pb-5 min-h-[200px]">
        {stats.map(({ digit, count, percent }) => {
          const height = percent === 0 ? 2 : Math.max(8, (percent / max) * 150);
          const barClass = percent > 10
            ? "bg-green-500"
            : percent < 5
              ? "bg-red-500"
              : "bg-zinc-300";
          return (
            <div key={digit} className="flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1">
              <span className="text-[9px] md:text-[10px] font-black text-slate-200">{percent.toFixed(1)}%</span>
              <div className={cn("w-full max-w-12 rounded-t-sm transition-all", barClass)} style={{ height }} title={`Dígito ${digit}: ${count} de ${sampleSize} ticks (${percent.toFixed(2)}%)`} />
              <span className="text-[10px] text-muted-foreground font-mono">{digit}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[8px] text-muted-foreground/60 text-right">
        Frequência relativa observada · últimos {sampleSize} de {windowSize} ticks
      </p>
    </div>
  );
}

interface DigitsMarketChartProps {
  ticks: TickData[];
  candles: any[];
  symbol: string;
  chartType: DigitsChartType;
  durationTicks: number;
  historyLoading?: boolean;
  historyError?: string | null;
  percentageWindow: number;
  onSettingsChange: (patch: { chartType: DigitsChartType; symbol: string; durationTicks: number; percentageWindow: number }) => void;
  disabled?: boolean;
}

export const DigitsMarketChart = ({ ticks, candles, symbol, chartType, durationTicks, percentageWindow, historyLoading = false, historyError = null, onSettingsChange, disabled }: DigitsMarketChartProps) => {
  const [editing, setEditing] = useState(false);
  const [draftType, setDraftType] = useState<DigitsChartType>(chartType);
  const [draftSymbol, setDraftSymbol] = useState(symbol);
  const [draftDuration, setDraftDuration] = useState(String(durationTicks));
  const [draftPercentageWindow, setDraftPercentageWindow] = useState(String(percentageWindow));

  const openSettings = () => {
    setDraftType(chartType);
    setDraftSymbol(symbol);
    setDraftDuration(String(durationTicks));
    setDraftPercentageWindow(String(percentageWindow));
    setEditing(true);
  };

  const saveSettings = () => {
    const duration = Math.max(1, Math.min(100, Math.round(Number(draftDuration) || 3)));
    const percentage = Math.max(MIN_DIGIT_PERCENTAGE_WINDOW, Math.min(MAX_DIGIT_PERCENTAGE_WINDOW, Math.round(Number(draftPercentageWindow) || 100)));
    onSettingsChange({ chartType: draftType, symbol: draftSymbol, durationTicks: duration, percentageWindow: percentage });
    setEditing(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Gráfico de Dígitos</p>
          <p className="text-[10px] text-white font-black mt-1 truncate">{symbol} · {durationTicks} ticks</p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={editing ? saveSettings : openSettings}
          className="h-9 w-9 shrink-0 rounded-lg border border-white/10 bg-black/20 text-muted-foreground hover:text-white hover:border-purple-500/40 flex items-center justify-center disabled:opacity-30 transition-colors"
          aria-label={editing ? "Guardar configurações do gráfico" : "Configurar gráfico"}
        >
          {editing ? <Check className="w-4 h-4 text-green-400" /> : <Menu className="w-4 h-4" />}
        </button>
      </div>

      {editing ? (
        <div className="rounded-xl border border-purple-500/20 bg-black/20 p-4 space-y-4">
          <div className="space-y-1">
            <label className="text-[9px] text-muted-foreground uppercase font-black">Tipo de gráfico</label>
            <Select value={draftType} onValueChange={(v) => setDraftType(v as DigitsChartType)}>
              <SelectTrigger className="w-full bg-black/30 border-white/10 h-10 text-[11px]"><span className="flex-1 text-left truncate">{CHART_TYPE_LABELS[draftType]}</span></SelectTrigger>
              <SelectContent className="bg-[#111114] border-white/10 text-white">
                <SelectItem value="digits"><div className="flex items-center gap-2"><CircleDot className="w-3.5 h-3.5" /> Gráfico de Dígitos</div></SelectItem>
                <SelectItem value="percentage"><div className="flex items-center gap-2"><BarChart3 className="w-3.5 h-3.5" /> Gráfico de Percentual de Dígitos</div></SelectItem>
                <SelectItem value="candles"><div className="flex items-center gap-2"><CandlestickChart className="w-3.5 h-3.5" /> Gráfico de Velas</div></SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[9px] text-muted-foreground uppercase font-black">Duração (ticks)</label>
              <Input type="number" min={1} max={100} step={1} value={draftDuration} onChange={(e) => setDraftDuration(e.target.value)} className="bg-black/30 border-white/10 h-10 text-[11px]" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] text-muted-foreground uppercase font-black">Janela percentual</label>
              <Input type="number" min={MIN_DIGIT_PERCENTAGE_WINDOW} max={MAX_DIGIT_PERCENTAGE_WINDOW} step={10} value={draftPercentageWindow} onChange={(e) => setDraftPercentageWindow(e.target.value)} className="bg-black/30 border-white/10 h-10 text-[11px]" />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] text-muted-foreground uppercase font-black">Ativo</label>
              <Select value={draftSymbol} onValueChange={setDraftSymbol}>
                <SelectTrigger className="w-full bg-black/30 border-white/10 h-10 text-[11px]"><span className="flex-1 text-left truncate">{SYMBOLS.find((item) => item.value === draftSymbol)?.label ?? draftSymbol}</span></SelectTrigger>
                <SelectContent className="bg-[#111114] border-white/10 text-white">
                  {SYMBOLS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[8px] text-muted-foreground/70">As alterações são guardadas automaticamente no Supabase ao confirmar com ✓.</p>
        </div>
      ) : historyLoading ? (
        <div className="relative min-h-[280px] rounded-xl border border-white/5 bg-black/20 p-4 flex flex-col items-center justify-center text-center">
          <div className="w-8 h-8 rounded-full border-2 border-purple-400/20 border-t-purple-400 animate-spin mb-3" />
          <p className="text-[10px] uppercase tracking-widest text-white font-black">A carregar histórico</p>
          <p className="text-[8px] text-muted-foreground mt-1">1.000 ticks de {symbol} · o gráfico aguarda os dados históricos antes de mostrar o feed ao vivo.</p>
        </div>
      ) : historyError ? (
        <div className="relative min-h-[280px] rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex flex-col items-center justify-center text-center">
          <p className="text-[10px] uppercase tracking-widest text-red-300 font-black">Falha no histórico</p>
          <p className="text-[8px] text-red-200/70 mt-2 max-w-sm">{historyError}</p>
          <p className="text-[8px] text-muted-foreground mt-2">Os ticks ao vivo continuam disponíveis, mas o histórico não foi carregado.</p>
        </div>
      ) : (
        <>
          {chartType === "digits" && <DigitHistoryChart ticks={ticks} />}
          {chartType === "percentage" && <DigitPercentageChart ticks={ticks} windowSize={percentageWindow} />}
          {chartType === "candles" && <TradingChart candles={candles} symbol={symbol} />}
        </>
      )}
    </div>
  );
};
