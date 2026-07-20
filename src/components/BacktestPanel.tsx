import React, { useState, useCallback } from "react";
import { BarChart3, Play, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle, Loader2, Download } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { cn } from "../lib/utils";
import { NeonCard } from "./NeonCard";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { runBacktest, BacktestResult } from "../lib/backtest";
import { downloadCandleDataset, fetchAndDownloadHistoricalDataset } from "../lib/dataset";
import { useSettingsStore } from "../store/useSettingsStore";
import { useMarketStore } from "../store/useMarketStore";
import { useBotStore } from "../store/useBotStore";

const PAYOUT_RATE = 0.92; // 92% — valor típico Deriv para opções de 5 ticks
const INITIAL_BALANCE = 1000;

// ── Métrica card ──────────────────────────────────────────────────────────────
function Metric({ label, value, sub, color = "text-white", size = "normal" }: {
  label: string; value: string; sub?: string; color?: string; size?: "normal" | "large";
}) {
  return (
    <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-center">
      <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest mb-1">{label}</p>
      <p className={cn("font-black", size === "large" ? "text-lg" : "text-sm", color)}>{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Custom tooltip do gráfico ─────────────────────────────────────────────────
const ChartTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  const diff = val - INITIAL_BALANCE;
  return (
    <div className="bg-[#111114] border border-white/10 rounded-lg px-3 py-2 text-[10px]">
      <p className="text-muted-foreground">Trade #{payload[0]?.payload?.index}</p>
      <p className={cn("font-black", diff >= 0 ? "text-green-400" : "text-red-400")}>
        ${val?.toFixed(2)} ({diff >= 0 ? "+" : ""}{diff.toFixed(2)})
      </p>
    </div>
  );
};

// ── Componente principal ──────────────────────────────────────────────────────
export const BacktestPanel = () => {
  const { settings } = useSettingsStore();
  const { candles, symbol, timeframe } = useMarketStore();
  const { isBotRunning } = useBotStore();
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyCount, setHistoryCount] = useState(5000);
  const [fetchingHistory, setFetchingHistory] = useState(false);
  const [historyMsg, setHistoryMsg] = useState<string | null>(null);

  const handleFetchLargeHistory = useCallback(() => {
    setFetchingHistory(true);
    setHistoryMsg(null);
    fetchAndDownloadHistoricalDataset(
      symbol,
      timeframe,
      historyCount,
      (msg) => { setFetchingHistory(false); setHistoryMsg(`Erro: ${msg}`); },
      (count) => { setFetchingHistory(false); setHistoryMsg(`${count} candles reais exportados.`); }
    );
  }, [symbol, timeframe, historyCount]);

  const handleRun = useCallback(async () => {
    if (candles.length < 51) {
      setError(`Candles insuficientes: ${candles.length}/51 mínimos. Aguarda mais dados ao vivo.`);
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);

    // Pequeno delay para o UI actualizar antes da computação
    await new Promise(r => setTimeout(r, 50));

    try {
      const res = runBacktest(candles, symbol, {
        stake: settings.stake,
        stopLoss: settings.stopLoss,
        targetProfit: settings.targetProfit,
        minConfidence: settings.minConfidence,
        cooldownSeconds: settings.cooldownSeconds,
        cooldownAfterLoss: settings.cooldownAfterLoss,
        useMartingale: settings.useMartingale,
        martingaleMultiplier: settings.martingaleMultiplier,
        maxMartingaleSteps: settings.maxMartingaleSteps,
        useSoros: settings.useSoros,
        maxSorosLevels: settings.maxSorosLevels,
        maxConsecutiveLosses: settings.maxConsecutiveLosses,
        strategyProfile: settings.strategyProfile,
        payoutRate: PAYOUT_RATE,
      }, INITIAL_BALANCE);
      setResult(res);
    } catch (e: any) {
      setError(e.message || "Erro durante o backtest.");
    } finally {
      setRunning(false);
    }
  }, [candles, symbol, settings]);

  const handleExportDataset = useCallback(() => {
    downloadCandleDataset(candles, symbol);
  }, [candles, symbol]);

  const stoppedLabel: Record<string, { text: string; color: string; icon: React.ReactNode }> = {
    target:     { text: "Take Profit atingido", color: "text-green-400", icon: <CheckCircle className="w-3.5 h-3.5" /> },
    stoploss:   { text: "Stop Loss atingido",   color: "text-red-400",   icon: <XCircle className="w-3.5 h-3.5" /> },
    end:        { text: "Todos os candles usados", color: "text-blue-400", icon: <BarChart3 className="w-3.5 h-3.5" /> },
    no_signals: { text: "Sem sinais suficientes", color: "text-amber-400", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  };

  return (
    <div className="space-y-4">
      {/* Header + botão */}
      <NeonCard variant="purple" className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-purple-400" /> Backtest Robusto
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Simula {candles.length} candles com os teus settings actuais
              {settings.useMartingale && ` · Martingale ${settings.martingaleMultiplier}x`}
              {settings.useSoros && ` · Soros ${settings.maxSorosLevels}L`}
            </p>
            <p className="text-[9px] text-muted-foreground/60 mt-0.5">
              Payout simulado: {(PAYOUT_RATE * 100).toFixed(0)}% · Saldo inicial: ${INITIAL_BALANCE}
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <Button
              onClick={handleRun}
              disabled={running || candles.length < 51}
              className="bg-purple-600 hover:bg-purple-700 font-black uppercase text-[11px] gap-2 h-9"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? "A simular..." : "Executar"}
            </Button>
            <Button
              onClick={handleExportDataset}
              disabled={candles.length === 0}
              variant="outline"
              title="Guarda os candles actuais como dataset de referência (Fase 2)"
              className="font-black uppercase text-[10px] gap-2 h-8"
            >
              <Download className="w-3.5 h-3.5" /> Exportar dataset
            </Button>
          </div>
        </div>

        {/* Fase 3.0: puxar lote histórico grande directamente da Deriv */}
        <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2 flex-wrap">
          <input
            type="number" min={1} max={20000} step={100} value={historyCount}
            onChange={(e) => setHistoryCount(Math.max(1, Number(e.target.value) || 1))}
            className="w-24 h-8 rounded-lg bg-black/30 border border-white/10 text-[11px] px-2 text-white"
          />
          <Button
            onClick={handleFetchLargeHistory}
            disabled={isBotRunning || fetchingHistory}
            variant="outline"
            title={isBotRunning ? "Desliga o bot primeiro — isto troca temporariamente o buffer de candles" : "Pede candles reais directamente à Deriv e descarrega como dataset"}
            className="font-black uppercase text-[10px] gap-2 h-8"
          >
            {fetchingHistory ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Baixar histórico real ({symbol})
          </Button>
          {isBotRunning && (
            <span className="text-[9px] text-amber-400 font-bold">Desliga o bot para usar isto (troca o buffer de candles)</span>
          )}
        </div>

        {historyMsg && (
          <div className={cn("mt-2 p-2 rounded-lg text-[10px] font-bold", historyMsg.startsWith("Erro") ? "bg-red-500/10 text-red-400 border border-red-500/30" : "bg-green-500/10 text-green-400 border border-green-500/30")}>
            {historyMsg}
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[11px] text-amber-400 font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
      </NeonCard>

      {/* Resultados */}
      {result && result.totalTrades > 0 && (
        <>
          {/* Paragem + resumo */}
          <div className="flex items-center gap-2 px-1">
            <span className={cn("flex items-center gap-1.5 text-[11px] font-black", stoppedLabel[result.stoppedBy]?.color)}>
              {stoppedLabel[result.stoppedBy]?.icon}
              {stoppedLabel[result.stoppedBy]?.text}
            </span>
            <span className="text-[10px] text-muted-foreground">após {result.stoppedAtTrade} trades</span>
          </div>

          {/* Métricas principais */}
          <div className="grid grid-cols-2 gap-2">
            <Metric label="P&L Líquido" value={`${result.netPnL >= 0 ? "+" : ""}$${result.netPnL}`}
              color={result.netPnL >= 0 ? "text-green-400" : "text-red-400"} size="large"
              sub={`ROI ${result.roi >= 0 ? "+" : ""}${result.roi}%`} />
            <Metric label="Win Rate" value={`${result.winRate}%`}
              color={result.winRate >= 55 ? "text-green-400" : result.winRate >= 45 ? "text-yellow-400" : "text-red-400"}
              size="large" sub={`${result.wins}W / ${result.losses}L`} />
            <Metric label="Max Drawdown" value={`-$${result.maxDrawdown}`}
              color="text-orange-400" sub={`${result.maxDrawdownPct}% do pico`} />
            <Metric label="Total Trades" value={`${result.totalTrades}`}
              color="text-blue-400" sub={`${candles.length} candles analisados`} />
            <Metric label="Maior Sequência ✓" value={`${result.bestStreak}W`} color="text-green-400" />
            <Metric label="Pior Sequência ✗" value={`${result.worstStreak}L`} color="text-red-400" />
            <Metric label="Stake Médio" value={`$${result.avgStake}`} color="text-purple-400"
              sub={`Máx: $${result.maxStake}`} />
            <Metric label="Saldo Final" value={`$${result.finalBalance}`}
              color={result.finalBalance >= INITIAL_BALANCE ? "text-green-400" : "text-red-400"}
              sub={`de $${INITIAL_BALANCE}`} />
          </div>

          {/* Curva de saldo */}
          <NeonCard variant="blue" className="p-4">
            <p className="text-[10px] font-black uppercase text-muted-foreground mb-3">
              Curva de Saldo
            </p>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={result.balanceCurve} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="index" tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false}
                  tickFormatter={v => `$${v}`} domain={["auto", "auto"]} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={INITIAL_BALANCE} stroke="#ffffff20" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="balance" stroke={result.netPnL >= 0 ? "#22c55e" : "#ef4444"}
                  strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </NeonCard>

          {/* Comparação com stake fixo */}
          <NeonCard variant="purple" className="p-4 space-y-3">
            <p className="text-[10px] font-black uppercase text-muted-foreground">
              Comparação: Com Gestão de Risco vs Stake Fixo
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-purple-500/30 bg-purple-500/5 space-y-1">
                <p className="text-[9px] text-purple-400 font-black uppercase">Com Gestão Activa</p>
                <p className={cn("text-base font-black", result.netPnL >= 0 ? "text-green-400" : "text-red-400")}>
                  {result.netPnL >= 0 ? "+" : ""}${result.netPnL}
                </p>
                <p className="text-[9px] text-muted-foreground">{result.winRate}% WR · Stake máx ${ result.maxStake}</p>
              </div>
              <div className="p-3 rounded-xl border border-white/10 bg-white/5 space-y-1">
                <p className="text-[9px] text-muted-foreground font-black uppercase">Stake Fixo ${settings.stake}</p>
                <p className={cn("text-base font-black", result.flatResult.netPnL >= 0 ? "text-green-400" : "text-red-400")}>
                  {result.flatResult.netPnL >= 0 ? "+" : ""}${result.flatResult.netPnL}
                </p>
                <p className="text-[9px] text-muted-foreground">{result.flatResult.winRate}% WR · Stake fixo</p>
              </div>
            </div>

            {/* Aviso se Martingale amplifica risco */}
            {settings.useMartingale && result.maxStake > settings.stake * 4 && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-300">
                  O Martingale atingiu stake de ${result.maxStake} (${(result.maxStake / settings.stake).toFixed(0)}x o base).
                  Certifica-te de que o saldo suporta sequências de perdas.
                </p>
              </div>
            )}
          </NeonCard>
        </>
      )}

      {result && result.totalTrades === 0 && (
        <NeonCard variant="blue" className="p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
          <p className="text-sm font-black text-white">Sem sinais suficientes</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Nenhum sinal passou os filtros de confiança ({settings.minConfidence}%), freshness e timing
            nos {candles.length} candles disponíveis. Tenta com mais dados ou ajusta a confiança mínima.
          </p>
        </NeonCard>
      )}
    </div>
  );
};
