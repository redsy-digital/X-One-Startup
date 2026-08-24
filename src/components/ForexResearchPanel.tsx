import React from "react";
import { BarChart3, Database, FlaskConical, RefreshCw, ShieldCheck, Sigma, LockKeyhole } from "lucide-react";
import { derivService } from "../lib/deriv";
import { buildFeatureScreening, buildFeatureStabilityMatrix, runForexResearch, runUntouchedHoldout, ForexResearchResult, ResearchHorizon, FeatureMetric, FeatureStabilityMatrix, UntouchedHoldoutResult, FeatureScreeningResult, FeatureFamily } from "../lib/forexResearch";

const DATASET_OPTIONS = [5000, 10000, 20000] as const;
const TIMEFRAMES = [
  { seconds: 300, label: "M5", minutes: 5 },
  { seconds: 900, label: "M15", minutes: 15 },
  { seconds: 1800, label: "M30", minutes: 30 },
  { seconds: 3600, label: "H1", minutes: 60 },
] as const;
const TARGET_MINUTES = [15, 30, 60, 120] as const;

type Timeframe = typeof TIMEFRAMES[number];

function pct(v: number) { return `${(v * 100).toFixed(2)}%`; }
function corr(v: number) { return v >= 0 ? `+${v.toFixed(3)}` : v.toFixed(3); }
function pValue(v: number) { return v < 0.001 ? "<0.001" : v.toFixed(3); }
function ci(a: number, b: number) { return `[${a.toFixed(3)}, ${b.toFixed(3)}]`; }
function directionLabel(v: FeatureMetric["validationAucDirection"]) {
  if (v === "DIRECT") return "DIRECTO";
  if (v === "INVERSE") return "INVERSO";
  return "NEUTRO";
}
function label(key: string) {
  const labels: Record<string, string> = {
    emaSpread: "EMA 9/21 — spread", rsiCentered: "RSI 14 — centrado", macdHistogram: "MACD — histograma",
    adxDirection: "ADX/DI — direcção", atrPct: "ATR 14 — % preço", bollingerPosition: "Bollinger — posição",
    bollingerWidthPct: "Bollinger — largura", roc: "ROC — 5 candles", bodyPct: "Candle — corpo",
    rangePct: "Candle — range", closeLocation: "Candle — localização do fecho", volatility20: "Volatilidade realizada",
  };
  return labels[key] ?? key;
}
function featureVerdict(f: FeatureMetric) {
  if (f.stability === "STABLE") return "PROMISSOR — NÃO PROMOVIDO";
  if (f.stability === "WEAK") return "SINAL FRACO";
  if (f.stability === "UNSTABLE") return "INSTÁVEL";
  return "SEM EVIDÊNCIA";
}
function horizonFor(targetMinutes: number, timeframeMinutes: number): ResearchHorizon | null {
  const value = targetMinutes / timeframeMinutes;
  return Number.isInteger(value) && value >= 1 && value <= 24 ? value as ResearchHorizon : null;
}

export const ForexResearchPanel = () => {
  const [loading, setLoading] = React.useState(false);
  const [matrixLoading, setMatrixLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [result, setResult] = React.useState<ForexResearchResult | null>(null);
  const [matrix, setMatrix] = React.useState<ForexResearchResult[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [timeframe, setTimeframe] = React.useState<Timeframe>(TIMEFRAMES[1]);
  const [targetMinutes, setTargetMinutes] = React.useState<number>(60);
  const [datasetSize, setDatasetSize] = React.useState<number>(5000);
  const [stabilityLoading, setStabilityLoading] = React.useState(false);
  const [stabilityProgress, setStabilityProgress] = React.useState(0);
  const [stabilityResults, setStabilityResults] = React.useState<ForexResearchResult[]>([]);
  const [selectedFeature, setSelectedFeature] = React.useState<FeatureMetric["key"]>("volatility20");
  const [stabilityMatrix, setStabilityMatrix] = React.useState<FeatureStabilityMatrix | null>(null);
  const [holdoutLoading, setHoldoutLoading] = React.useState(false);
  const [holdoutProgress, setHoldoutProgress] = React.useState(0);
  const [holdoutResult, setHoldoutResult] = React.useState<UntouchedHoldoutResult | null>(null);
  const [screeningLoading, setScreeningLoading] = React.useState(false);
  const [screeningProgress, setScreeningProgress] = React.useState(0);
  const [screeningResult, setScreeningResult] = React.useState<FeatureScreeningResult | null>(null);
  const [discoveryM5Window, setDiscoveryM5Window] = React.useState<{ startTime: number; endTime: number; candles: number } | null>(null);

  const selectedHorizon = horizonFor(targetMinutes, timeframe.minutes);

  const fetchLargeDataset = React.useCallback(async (granularity: number, desiredCount: number, onProgress?: (value: number) => void, endAt: number | "latest" = "latest") => {
    const all: any[] = [];
    let end: number | "latest" = endAt;
    const pageSize = 1000;
    const maxPages = Math.min(100, Math.ceil(desiredCount / pageSize) + 12);
    let previousOldest = Number.POSITIVE_INFINITY;

    for (let page = 0; page < maxPages && all.length < desiredCount; page++) {
      const batch = await derivService.getHistoricalCandles("frxEURUSD", pageSize, granularity, end);
      if (!batch.length) break;
      const oldest = Number(batch[0]?.time);
      if (!Number.isFinite(oldest) || oldest >= previousOldest) break;
      previousOldest = oldest;
      all.unshift(...batch);
      const uniqueCount = new Set(all.map(c => c.time)).size;
      const value = Math.min(99, Math.round((uniqueCount / desiredCount) * 100));
      onProgress?.(value);
      end = oldest - 1;
      await new Promise(r => setTimeout(r, 350));
    }

    const deduped = Array.from(new Map(all.map(c => [c.time, c])).values()).sort((a, b) => a.time - b.time);
    // With end=latest the final candle may still be forming. When a historical
    // numeric end is supplied, the requested block is already in the past.
    const closed = endAt === "latest" && deduped.length > 1 ? deduped.slice(0, -1) : deduped;
    return closed.length > desiredCount ? closed.slice(closed.length - desiredCount) : closed;
  }, []);

  const run = React.useCallback(async () => {
    if (!selectedHorizon) { setError("Este alvo não é compatível com o timeframe escolhido. Escolhe um múltiplo inteiro de candles."); return; }
    if (!derivService.isSocketOpen()) { setError("WebSocket da Deriv não está pronto."); return; }
    setLoading(true); setError(null); setResult(null); setProgress(0);
    try {
      const candles = await fetchLargeDataset(timeframe.seconds, datasetSize, setProgress);
      if (candles.length < 1000) throw new Error(`A Deriv devolveu apenas ${candles.length} candles ${timeframe.label}. Precisamos de pelo menos 1000 para este estudo.`);
      setProgress(100);
      setResult(runForexResearch(candles, selectedHorizon, timeframe.seconds, targetMinutes));
    } catch (e: any) {
      setError(e?.message || "Falha ao executar a pesquisa Forex.");
    } finally { setLoading(false); }
  }, [datasetSize, fetchLargeDataset, selectedHorizon, targetMinutes, timeframe]);

  const runMatrix = React.useCallback(async () => {
    if (!derivService.isSocketOpen()) { setError("WebSocket da Deriv não está pronto."); return; }
    setMatrixLoading(true); setError(null); setMatrix([]); setProgress(0);
    try {
      const compatible = TIMEFRAMES.filter(tf => horizonFor(targetMinutes, tf.minutes) !== null);
      if (!compatible.length) throw new Error("Não há timeframes compatíveis com este alvo.");
      const results: ForexResearchResult[] = [];
      for (let i = 0; i < compatible.length; i++) {
        const tf = compatible[i];
        const horizon = horizonFor(targetMinutes, tf.minutes)!;
        const candles = await fetchLargeDataset(tf.seconds, datasetSize, value => {
          setProgress(Math.round(((i + value / 100) / compatible.length) * 100));
        });
        if (candles.length < 1000) throw new Error(`${tf.label}: histórico insuficiente (${candles.length} candles).`);
        results.push(runForexResearch(candles, horizon, tf.seconds, targetMinutes));
        setMatrix([...results]);
      }
    } catch (e: any) {
      setError(e?.message || "Falha ao comparar timeframes.");
    } finally { setMatrixLoading(false); setProgress(100); }
  }, [datasetSize, fetchLargeDataset, targetMinutes]);

  const runScreening = React.useCallback(async () => {
    if (!selectedHorizon) { setError("Este alvo não é compatível com o timeframe escolhido."); return; }
    if (!derivService.isSocketOpen()) { setError("WebSocket da Deriv não está pronto."); return; }
    setScreeningLoading(true); setError(null); setScreeningResult(null); setScreeningProgress(0);
    try {
      // Phase 3F is intentionally a fixed-context screen: one timeframe, one
      // target, the complete pre-declared 12-feature catalog. No holdout is
      // touched here, and no feature is selected automatically for promotion.
      const candles = await fetchLargeDataset(timeframe.seconds, datasetSize, setScreeningProgress);
      if (candles.length < 1000) throw new Error(`Screening abortado: recebemos apenas ${candles.length} candles ${timeframe.label}. Precisamos de pelo menos 1000.`);
      const research = runForexResearch(candles, selectedHorizon, timeframe.seconds, targetMinutes);
      setScreeningProgress(100);
      setScreeningResult(buildFeatureScreening(research));
    } catch (e: any) {
      setError(e?.message || "Falha no screening estatístico de features.");
    } finally { setScreeningLoading(false); }
  }, [datasetSize, fetchLargeDataset, selectedHorizon, targetMinutes, timeframe]);

  const runHoldout = React.useCallback(async () => {
    if (!derivService.isSocketOpen()) { setError("WebSocket da Deriv não está pronto."); return; }
    if (!discoveryM5Window || discoveryM5Window.candles !== 5000) {
      setError("Para proteger o holdout contra sobreposição temporal, execute primeiro a matriz 3D com Histórico = 5.000. Depois o Holdout usará os 5.000 candles imediatamente anteriores à janela de descoberta.");
      return;
    }
    setHoldoutLoading(true); setError(null); setHoldoutResult(null); setHoldoutProgress(0);
    try {
      // Protocol frozen BEFORE looking at the holdout: volatility20 / M5 / +15m / INVERSE.
      // IMPORTANT: the holdout is fetched BEFORE the exact M5 discovery window captured
      // during the matrix run. This prevents the old implementation's fresh-10k window
      // from overlapping the already-observed discovery sample.
      const holdoutCount = 5000;
      const candles = await fetchLargeDataset(300, holdoutCount, setHoldoutProgress, discoveryM5Window.startTime - 1);
      if (candles.length < holdoutCount) throw new Error(`Holdout abortado: recebemos ${candles.length} candles M5 históricos antes da janela de descoberta; o protocolo exige ${holdoutCount}.`);
      const result = runUntouchedHoldout(candles.slice(-holdoutCount), 3, 300, 15, "volatility20", "INVERSE");
      setHoldoutProgress(100);
      setHoldoutResult(result);
    } catch (e: any) {
      setError(e?.message || "Falha ao executar o holdout intocado.");
    } finally { setHoldoutLoading(false); }
  }, [discoveryM5Window, fetchLargeDataset]);

  const runStability = React.useCallback(async () => {
    if (!derivService.isSocketOpen()) { setError("WebSocket da Deriv não está pronto."); return; }
    setStabilityLoading(true); setError(null); setStabilityResults([]); setStabilityMatrix(null); setStabilityProgress(0); setDiscoveryM5Window(null);
    try {
      const results: ForexResearchResult[] = [];
      let discoveryM5WindowLocal: { startTime: number; endTime: number; candles: number } | null = null;
      for (let i = 0; i < TIMEFRAMES.length; i++) {
        const tf = TIMEFRAMES[i];
        const candles = await fetchLargeDataset(tf.seconds, datasetSize, value => {
          setStabilityProgress(Math.round(((i + value / 100) / TIMEFRAMES.length) * 100));
        });
        if (candles.length < 1000) throw new Error(`${tf.label}: histórico insuficiente (${candles.length} candles).`);
        for (const target of TARGET_MINUTES) {
          const horizon = horizonFor(target, tf.minutes);
          if (!horizon) continue;
          results.push(runForexResearch(candles, horizon, tf.seconds, target));
        }
        if (tf.seconds === 300 && candles.length === 5000) {
          discoveryM5WindowLocal = { startTime: candles[0].time, endTime: candles[candles.length - 1].time, candles: candles.length };
        }
        setStabilityResults([...results]);
      }
      if (!discoveryM5WindowLocal) throw new Error("Matriz concluída sem snapshot M5 válido. Usa Histórico = 5.000 para preparar o holdout intocado.");
      setDiscoveryM5Window(discoveryM5WindowLocal);
      setStabilityProgress(100);
      setStabilityMatrix(buildFeatureStabilityMatrix(results, selectedFeature));
    } catch (e: any) {
      setError(e?.message || "Falha ao construir a matriz de estabilidade.");
    } finally { setStabilityLoading(false); }
  }, [datasetSize, fetchLargeDataset, selectedFeature]);

  React.useEffect(() => {
    if (stabilityResults.length) setStabilityMatrix(buildFeatureStabilityMatrix(stabilityResults, selectedFeature));
  }, [selectedFeature, stabilityResults]);

  return (
    <section className="w-full max-w-3xl mx-auto rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 flex items-center gap-2"><FlaskConical className="w-4 h-4" /> Fase 3D — Feature Stability Matrix</p>
          <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">Congela uma feature e mede-a sem seleção do “melhor indicador” em <b className="text-white">M5/M15/M30/H1 × +15/+30/+60/+120 min</b>. AUC abaixo de 0,50 continua marcada como <b className="text-white">INVERSE</b>. A matriz é diagnóstica e não promove nada automaticamente.</p>
        </div>
        <Sigma className="w-5 h-5 text-emerald-400" />
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded-xl border border-white/5 bg-black/30 p-3"><p className="text-[8px] uppercase tracking-widest text-muted-foreground">Histórico</p><select value={datasetSize} onChange={e => setDatasetSize(Number(e.target.value))} className="mt-1 w-full bg-transparent text-sm font-black text-white outline-none"><option value={5000} className="bg-black">5.000</option><option value={10000} className="bg-black">10.000</option><option value={20000} className="bg-black">20.000</option></select></div>
        <div className="rounded-xl border border-white/5 bg-black/30 p-3"><p className="text-[8px] uppercase tracking-widest text-muted-foreground">Timeframe</p><select value={timeframe.seconds} onChange={e => setTimeframe(TIMEFRAMES.find(tf => tf.seconds === Number(e.target.value)) ?? TIMEFRAMES[1])} className="mt-1 w-full bg-transparent text-sm font-black text-white outline-none">{TIMEFRAMES.map(tf => <option key={tf.seconds} value={tf.seconds} className="bg-black">{tf.label}</option>)}</select></div>
        <div className="rounded-xl border border-white/5 bg-black/30 p-3"><p className="text-[8px] uppercase tracking-widest text-muted-foreground">Target</p><select value={targetMinutes} onChange={e => setTargetMinutes(Number(e.target.value))} className="mt-1 w-full bg-transparent text-sm font-black text-white outline-none">{TARGET_MINUTES.map(m => <option key={m} value={m} disabled={!horizonFor(m, timeframe.minutes)} className="bg-black">+{m} min</option>)}</select></div>
        <div className="rounded-xl border border-white/5 bg-black/30 p-3"><p className="text-[8px] uppercase tracking-widest text-muted-foreground">Validação</p><p className="text-sm font-black text-white">70/30 + WF</p><p className="text-[8px] text-muted-foreground">mesma feature nas janelas</p></div>
      </div>

      <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.025] p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300 flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Fase 3F — Feature Screening</p>
            <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">Testa o catálogo fechado de <b className="text-white">12 features</b> num único contexto fixo: <b className="text-white">{timeframe.label} · +{targetMinutes}m</b>. Aplica <b className="text-white">Benjamini–Hochberg FDR 5%</b> aos p-values de toda a família de testes. O ranking serve apenas para escolher poucas hipóteses para a Fase 3D.</p>
          </div>
          <ShieldCheck className="w-5 h-5 text-cyan-300" />
        </div>
        <button type="button" onClick={runScreening} disabled={loading || matrixLoading || stabilityLoading || holdoutLoading || screeningLoading || !selectedHorizon} className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-200 disabled:opacity-50">
          {screeningLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
          {screeningLoading ? `A testar 12 features… ${screeningProgress}%` : "Executar Feature Screening"}
        </button>
      </div>

      <div className="mt-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-end">
          <div className="rounded-xl border border-white/5 bg-black/30 p-3">
            <p className="text-[8px] uppercase tracking-widest text-muted-foreground">Feature da matriz</p>
            <select value={selectedFeature} onChange={e => setSelectedFeature(e.target.value as FeatureMetric["key"])} className="mt-1 w-full bg-transparent text-sm font-black text-white outline-none">
              {FEATURE_OPTIONS.map(f => <option key={f.key} value={f.key} className="bg-black">{f.label}</option>)}
            </select>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/30 p-3">
            <p className="text-[8px] uppercase tracking-widest text-muted-foreground">Regra 3D</p>
            <p className="text-sm font-black text-white">16 células · mesma feature</p>
            <p className="text-[8px] text-muted-foreground">o Holdout 3E ignora este seletor</p>
          </div>
        </div>
        <button type="button" onClick={runStability} disabled={loading || matrixLoading || stabilityLoading || holdoutLoading || screeningLoading} className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-violet-300 disabled:opacity-50">
          {stabilityLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sigma className="w-4 h-4" />}
          {stabilityLoading ? `A construir matriz… ${stabilityProgress}%` : "Construir matriz 3D de estabilidade"}
        </button>
      </div>

      <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.035] p-3">
        <div className="flex items-start gap-2">
          <LockKeyhole className="w-4 h-4 text-amber-300 mt-0.5" />
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-300">Barreira · Holdout intocado</p>
            <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">Hipótese congelada: <b className="text-white">Volatilidade realizada · M5 · +15m · INVERSO</b>. O Holdout <b className="text-white">não usa o seletor de Feature</b>: isso é intencional. Depois da matriz 3D, ele usa os <b className="text-white">5.000 candles imediatamente anteriores</b> à janela M5 de descoberta capturada nessa execução, evitando sobreposição temporal. Não pode escolher feature, timeframe, alvo ou direcção.</p>
          </div>
        </div>
        <p className="mt-2 text-[8px] text-amber-200/70">{discoveryM5Window ? `Snapshot M5 pronto: ${discoveryM5Window.candles.toLocaleString("pt-PT")} candles congelados para a descoberta.` : "Sem snapshot M5 nesta sessão. Execute a matriz com Histórico = 5.000 antes do holdout."}</p>
        <button type="button" onClick={runHoldout} disabled={loading || matrixLoading || stabilityLoading || holdoutLoading || screeningLoading || !discoveryM5Window} className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-amber-200 disabled:opacity-50">
          {holdoutLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <LockKeyhole className="w-4 h-4" />}
          {holdoutLoading ? `A executar holdout… ${holdoutProgress}%` : "Executar Holdout Intocado"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
        <button type="button" onClick={run} disabled={loading || matrixLoading || holdoutLoading || screeningLoading || !selectedHorizon} className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-300 disabled:opacity-50">
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          {loading ? `A recolher ${timeframe.label}… ${progress}%` : "Executar estudo"}
        </button>
        <button type="button" onClick={runMatrix} disabled={loading || matrixLoading || holdoutLoading || screeningLoading} className="w-full flex items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-300 disabled:opacity-50">
          {matrixLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
          {matrixLoading ? `A comparar… ${progress}%` : `Comparar M5 / M15 / M30 / H1`}
        </button>
      </div>

      {error && <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-[10px] font-bold text-red-400">{error}</div>}

      {screeningResult && <FeatureScreeningView result={screeningResult} />}

      {holdoutResult && <UntouchedHoldoutView result={holdoutResult} />}

      {result && <ResearchResultView result={result} />}

      {matrix.length > 0 && (
        <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
          <div className="flex items-center gap-2 mb-2"><BarChart3 className="w-4 h-4 text-cyan-300" /><p className="text-[9px] font-black uppercase tracking-widest text-white">Comparação multi-timeframe · alvo +{targetMinutes} min</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-[8px]"><thead><tr className="text-muted-foreground border-b border-white/5"><th className="text-left py-2">TF</th><th>candles</th><th>melhor feature</th><th>AUC</th><th>equiv.</th><th>direcção</th><th>WF</th></tr></thead><tbody>
              {matrix.map(r => { const best = [...r.features].sort((a,b) => b.walkForwardMeanSkill - a.walkForwardMeanSkill)[0]; return <tr key={r.granularitySeconds} className="border-b border-white/5"><td className="py-2 font-black text-cyan-300">{r.timeframeMinutes >= 60 ? `H${r.timeframeMinutes/60}` : `M${r.timeframeMinutes}`}</td><td className="text-center">{r.candles}</td><td className="text-left font-bold text-white">{label(best.key)}</td><td className="text-center">{best.validationAuc.toFixed(3)}</td><td className="text-center">{best.validationAucEquivalent.toFixed(3)}</td><td className="text-center">{directionLabel(best.validationAucDirection)}</td><td className="text-center">{best.walkForwardPositiveWindows}/{best.walkForwardWindows}</td></tr>; })}
            </tbody></table>
          </div>
          <p className="mt-2 text-[8px] text-muted-foreground">A matriz é diagnóstico comparativo. O “melhor” não é uma recomendação de entrada; precisa sobreviver a custos/payout, regimes e teste final intocado.</p>
        </div>
      )}

      {stabilityMatrix && <FeatureStabilityView matrix={stabilityMatrix} />}
    </section>
  );
};

function familyLabel(family: FeatureFamily) {
  return family === "TREND" ? "TENDÊNCIA" : family === "MOMENTUM" ? "MOMENTUM" : family === "VOLATILITY" ? "VOLATILIDADE" : "PRICE ACTION";
}

function FeatureScreeningView({ result }: { result: FeatureScreeningResult }) {
  return <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.025] p-3 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[9px] font-black uppercase tracking-widest text-cyan-300">Screening · {result.timeframeMinutes >= 60 ? `H${result.timeframeMinutes / 60}` : `M${result.timeframeMinutes}`} · +{result.targetMinutes}m</p>
        <p className="mt-1 text-[8px] leading-relaxed text-muted-foreground">Foram testadas todas as <b className="text-white">{result.testedFeatures} features pré-declaradas</b>. O p-value ajustado controla a descoberta múltipla; nenhum resultado usa o holdout intocado.</p>
      </div>
      <span className="rounded-full border border-cyan-500/30 px-2 py-1 text-[8px] font-black text-cyan-200">FDR 5%</span>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Metric title="Features" value={`${result.testedFeatures}`} sub="catálogo fechado" />
      <Metric title="Candidatas" value={`${result.screeningCandidates}`} sub="para 3D, não promoção" />
      <Metric title="Contexto" value={`${result.timeframeMinutes >= 60 ? `H${result.timeframeMinutes / 60}` : `M${result.timeframeMinutes}`} · +${result.targetMinutes}m`} sub={`${result.candles.toLocaleString("pt-PT")} candles`} />
      <Metric title="Correção" value="BH FDR 5%" sub="12 testes simultâneos" />
    </div>
    <div className="rounded-xl border border-white/5 bg-black/30 p-3">
      <div className="overflow-x-auto">
        <table className="w-full text-[8px]"><thead><tr className="text-muted-foreground border-b border-white/5"><th className="text-left py-2">Feature</th><th>Família</th><th>AUC</th><th>Skill</th><th>Direcção</th><th>p</th><th>q BH</th><th>WF</th><th>Estado</th></tr></thead><tbody>
          {result.rows.map(f => <tr key={f.key} className="border-b border-white/5">
            <td className="py-2 text-left font-bold text-white">{label(f.key)}</td>
            <td className="text-center text-muted-foreground">{familyLabel(f.family)}</td>
            <td className="text-center">{f.validationAuc.toFixed(3)}</td>
            <td className="text-center">+{f.validationAucSkill.toFixed(3)}</td>
            <td className={`text-center ${f.validationAucDirection === "INVERSE" ? "text-amber-300" : f.validationAucDirection === "DIRECT" ? "text-emerald-300" : "text-muted-foreground"}`}>{directionLabel(f.validationAucDirection)}</td>
            <td className="text-center">{pValue(f.validationAucPValue)}</td>
            <td className={`text-center font-black ${f.passesFdr05 ? "text-cyan-200" : "text-muted-foreground"}`}>{pValue(f.adjustedPValue)}</td>
            <td className="text-center">{f.walkForwardPositiveWindows}/{f.walkForwardWindows}</td>
            <td className={`text-center font-black ${f.passesScreening ? "text-emerald-300" : "text-muted-foreground"}`}>{f.passesScreening ? "AVANÇA → 3D" : f.stability}</td>
          </tr>)}
        </tbody></table>
      </div>
    </div>
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-[8px] leading-relaxed text-muted-foreground">
      <p className="font-black uppercase tracking-widest text-amber-300">Regra da fase</p>
      <p className="mt-1">“AVANÇA → 3D” significa apenas que a hipótese merece investigação mais profunda. <b className="text-white">Não é aprovação, não recebe peso e não pode tocar no holdout.</b> A próxima etapa congela cada candidata individualmente e executa a matriz de estabilidade antes de qualquer validação intocada.</p>
    </div>
  </div>;
}

function UntouchedHoldoutView({ result }: { result: UntouchedHoldoutResult }) {
  const pass = result.verdict === "PASS";
  const inconclusive = result.verdict === "INCONCLUSIVE";
  const tone = pass ? "text-emerald-300" : inconclusive ? "text-amber-300" : "text-red-300";
  const verdict = pass ? "HIPÓTESE SOBREVIVEU AO HOLDOUT" : inconclusive ? "RESULTADO INCONCLUSIVO" : "HIPÓTESE REJEITADA";
  return <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/[0.035] p-3 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><LockKeyhole className="w-4 h-4 text-amber-300" /><p className="text-[9px] font-black uppercase tracking-widest text-amber-300">Holdout intocado · protocolo congelado</p></div>
        <p className={`mt-1 text-sm font-black ${tone}`}>{verdict}</p>
        <p className="mt-1 text-[8px] leading-relaxed text-muted-foreground">Nenhuma decisão, limiar ou feature foi optimizado neste bloco. Este resultado só pode confirmar ou rejeitar a hipótese previamente definida.</p>
      </div>
      <span className={`rounded-full border px-2 py-1 text-[8px] font-black ${tone}`}>{result.verdict}</span>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Metric title="AUC OOS" value={result.auc.toFixed(3)} sub={`equiv. ${result.aucEquivalent.toFixed(3)}`} />
      <Metric title="Direcção" value={directionLabel(result.observedDirection)} sub={`esperado ${directionLabel(result.expectedDirection)}`} />
      <Metric title="Skill" value={`+${result.skill.toFixed(3)}`} sub={`p ${pValue(result.pValue)}`} />
      <Metric title="IC95" value={ci(result.ciLow, result.ciHigh)} sub={`${result.samples.toLocaleString("pt-PT")} amostras`} />
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[8px] text-muted-foreground">
      <span>r OOS <b className="text-white">{corr(result.pearson)}</b></span>
      <span>p Pearson <b className="text-white">{pValue(result.pearsonPValue)}</b></span>
      <span>positivos <b className="text-white">{result.positiveN}</b></span>
      <span>negativos <b className="text-white">{result.negativeN}</b></span>
    </div>
    <div className="rounded-xl border border-white/5 bg-black/30 p-3 text-[8px] text-muted-foreground">
      <p className="font-black uppercase tracking-widest text-white">Porta de promoção pré-registada</p>
      <p className="mt-1">PASS somente se a direcção continuar <b className="text-white">INVERSA</b>, skill ≥ <b className="text-white">0,025</b>, p permutacional &lt; <b className="text-white">0,05</b> e o IC95% ficar inteiramente fora de 0,50. Mesmo PASS <b className="text-amber-200">não adiciona peso ao Decision Engine</b>; apenas permite avançar para custos/payout, regimes e validação final.</p>
    </div>
  </div>;
}

function ResearchResultView({ result }: { result: ForexResearchResult }) {
  return <div className="mt-4 space-y-3">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Metric title="Candles" value={result.candles.toLocaleString("pt-PT")} sub={`${result.samples.toLocaleString("pt-PT")} amostras`} />
      <Metric title="Baseline UP" value={pct(result.baselineAlwaysUpAccuracy)} sub={`OOS · ${result.validationPositiveN} positivos`} />
      <Metric title="Baseline DOWN" value={pct(result.baselineAlwaysDownAccuracy)} sub={`OOS · ${result.validationNegativeN} negativos`} />
      <Metric title="Alvo" value={`+${result.targetMinutes} min`} sub={`${result.timeframeMinutes} min/candle`} />
    </div>

    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-amber-300">⚠ AUC equivalente ≠ prova de vantagem</p>
      <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">AUC OOS abaixo de 0,50 é reportada como <b className="text-white">INVERSE</b> e convertida em AUC equivalente = max(AUC, 1−AUC). Isto serve para investigar relações inversas; não autoriza inverter um sinal no bot. A camada de regime é medida separadamente.</p>
    </div>

    <div className="rounded-xl border border-white/5 bg-black/30 p-3">
      <div className="flex items-center gap-2 mb-2"><ShieldCheck className="w-4 h-4 text-emerald-400" /><p className="text-[9px] font-black uppercase tracking-widest text-white">Features — OOS + walk-forward</p></div>
      <div className="space-y-2">{result.features.map(f => <FeatureCard key={f.key} f={f} />)}</div>
    </div>

    <div className="rounded-xl border border-white/5 bg-black/30 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-white mb-2">Walk-forward — mesma feature</p>
      <div className="space-y-2">{result.validationWindows.map(w => {
        const best = [...w.features].sort((a,b) => b.validationAucSkill - a.validationAucSkill)[0];
        return <div key={w.index} className="rounded-lg border border-white/5 p-2"><div className="flex items-center justify-between"><span className="text-[9px] font-bold text-white">Janela {w.index}</span><span className="text-[8px] text-muted-foreground">OOS {pct(w.validationWinRate)} · {w.validationN} amostras</span></div><p className="mt-1 text-[8px] text-muted-foreground">Maior skill: <b className="text-emerald-300">{label(best.key)}</b> · AUC {best.validationAuc.toFixed(3)} · {directionLabel(best.validationAucDirection)} · p {pValue(best.validationAucPValue)}</p></div>;
      })}</div>
    </div>

    <p className="text-[8px] text-muted-foreground leading-relaxed"><b className="text-white">Regra de promoção:</b> nenhum resultado deste laboratório entra automaticamente no Decision Engine. Uma feature só poderá ser candidata a peso depois de sobreviver a múltiplas janelas, significância, robustez, custos/payout, diferentes timeframes/regimes e teste final intocado.</p>
  </div>;
}

function FeatureCard({ f }: { f: FeatureMetric; key?: React.Key }) {
  return <div className="rounded-lg border border-white/5 p-2">
    <div className="flex items-center justify-between gap-2"><span className="text-[9px] font-bold text-white">{label(f.key)} <span className="text-[7px] text-muted-foreground">· {f.role}</span></span><span className={`text-[8px] font-black ${f.stability === "STABLE" ? "text-emerald-300" : f.stability === "UNSTABLE" ? "text-red-300" : "text-amber-300"}`}>{featureVerdict(f)}</span></div>
    <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-1 text-[8px] text-muted-foreground">
      <span>AUC OOS <b className="text-white">{f.validationAuc.toFixed(3)}</b></span><span>equiv. <b className="text-white">{f.validationAucEquivalent.toFixed(3)}</b></span><span>direcção <b className={f.validationAucDirection === "INVERSE" ? "text-amber-300" : "text-white"}>{directionLabel(f.validationAucDirection)}</b></span><span>skill <b className="text-white">+{f.validationAucSkill.toFixed(3)}</b></span>
      <span>CI95 <b className="text-white">{ci(f.validationAucCiLow, f.validationAucCiHigh)}</b></span><span>p perm. <b className="text-white">{pValue(f.validationAucPValue)}</b></span><span>Bal. acc <b className="text-white">{pct(f.validationBalancedAccuracy)}</b></span><span>r OOS <b className="text-white">{corr(f.validationPearson)}</b></span>
      <span>WF skill <b className="text-white">{f.walkForwardMeanSkill.toFixed(3)}</b></span><span>WF mínimo <b className="text-white">{f.walkForwardMinSkill.toFixed(3)}</b></span><span>WF direcção <b className="text-white">{pct(f.walkForwardDirectionConsistency)}</b></span><span>WF sinais <b className="text-white">{f.walkForwardPositiveWindows}/{f.walkForwardWindows}</b></span>
      {f.role === "REGIME" && <><span>Regime AUC <b className="text-white">{f.regimeAuc.toFixed(3)}</b></span><span>Regime equiv. <b className="text-white">{f.regimeAucEquivalent.toFixed(3)}</b></span><span>Regime dir. <b className="text-white">{directionLabel(f.regimeAucDirection)}</b></span><span>Regime p <b className="text-white">{pValue(f.regimeAucPValue)}</b></span></>}
    </div>
  </div>;
}


const FEATURE_OPTIONS = [
  "emaSpread", "rsiCentered", "macdHistogram", "adxDirection", "atrPct",
  "bollingerPosition", "bollingerWidthPct", "roc", "bodyPct", "rangePct",
  "closeLocation", "volatility20",
].map(key => ({ key: key as FeatureMetric["key"], label: label(key) }));

function stabilityTone(stability: string) {
  if (stability === "STABLE") return "text-emerald-300";
  if (stability === "UNSTABLE") return "text-red-300";
  if (stability === "WEAK") return "text-amber-300";
  return "text-muted-foreground";
}

function FeatureStabilityView({ matrix }: { matrix: FeatureStabilityMatrix }) {
  const ordered = [...matrix.cells].sort((a, b) => a.timeframeMinutes - b.timeframeMinutes || a.targetMinutes - b.targetMinutes);
  const timeframes = [5, 15, 30, 60];
  const targets = [15, 30, 60, 120];
  const find = (tf: number, target: number) => ordered.find(c => c.timeframeMinutes === tf && c.targetMinutes === target);
  return <div className="mt-4 space-y-3">
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.03] p-3">
      <div className="flex items-center gap-2 mb-2"><Sigma className="w-4 h-4 text-violet-300" /><p className="text-[9px] font-black uppercase tracking-widest text-white">Fase 3D · {label(matrix.key)}</p></div>
      <p className="text-[8px] leading-relaxed text-muted-foreground">A feature foi congelada antes da leitura desta matriz. Cada célula usa a mesma definição e a mesma feature; não existe “melhor feature” por timeframe. Isto reduz selection bias, mas não transforma a matriz em validação final se a feature foi escolhida depois de observar estes dados.</p>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric title="Células" value={`${matrix.totalCells}`} sub="timeframe × alvo" />
        <Metric title="Sinais" value={`${matrix.signalCells}/${matrix.totalCells}`} sub={`${pct(matrix.signalRate)} das células`} />
        <Metric title="Skill média" value={`+${matrix.meanSkill.toFixed(3)}`} sub="AUC equivalente − 0,50" />
        <Metric title="Consistência" value={pct(matrix.directionConsistency)} sub="direcção entre sinais" />
      </div>
    </div>

    <div className="rounded-xl border border-white/5 bg-black/30 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-white mb-2">Matriz AUC equivalente / direcção</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[8px]"><thead><tr className="text-muted-foreground border-b border-white/5"><th className="text-left py-2">TF \ Target</th>{targets.map(t => <th key={t}>+{t}m</th>)}</tr></thead><tbody>
          {timeframes.map(tf => <tr key={tf} className="border-b border-white/5">
            <td className="py-2 font-black text-violet-300">{tf >= 60 ? `H${tf/60}` : `M${tf}`}</td>
            {targets.map(target => { const c = find(tf, target); return <td key={target} className="text-center py-2">{c ? <div><b className="text-white">{c.validationAucEquivalent.toFixed(3)}</b><div className={c.validationAucDirection === "INVERSE" ? "text-amber-300" : c.validationAucDirection === "DIRECT" ? "text-emerald-300" : "text-muted-foreground"}>{directionLabel(c.validationAucDirection)}</div><div className="text-muted-foreground">WF {c.walkForwardPositiveWindows}/{c.walkForwardWindows}</div></div> : <span className="text-muted-foreground">—</span>}</td>; })}
          </tr>)}
        </tbody></table>
      </div>
    </div>

    <div className="rounded-xl border border-white/5 bg-black/30 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-white mb-2">Células detalhadas</p>
      <div className="space-y-2">{ordered.map(c => <div key={`${c.timeframeMinutes}-${c.targetMinutes}`} className="rounded-lg border border-white/5 p-2">
        <div className="flex items-center justify-between gap-2"><span className="text-[9px] font-black text-white">{c.timeframeMinutes >= 60 ? `H${c.timeframeMinutes/60}` : `M${c.timeframeMinutes}`} · +{c.targetMinutes}m</span><span className={`text-[8px] font-black ${stabilityTone(c.stability)}`}>{c.stability}</span></div>
        <div className="mt-1 grid grid-cols-2 md:grid-cols-5 gap-1 text-[8px] text-muted-foreground">
          <span>AUC <b className="text-white">{c.validationAuc.toFixed(3)}</b></span><span>equiv. <b className="text-white">{c.validationAucEquivalent.toFixed(3)}</b></span><span>skill <b className="text-white">+{c.validationAucSkill.toFixed(3)}</b></span><span>p <b className="text-white">{pValue(c.validationAucPValue)}</b></span><span>CI95 <b className="text-white">{ci(c.validationAucCiLow, c.validationAucCiHigh)}</b></span>
          <span>direcção <b className="text-white">{directionLabel(c.validationAucDirection)}</b></span><span>WF skill <b className="text-white">{c.walkForwardMeanSkill.toFixed(3)}</b></span><span>WF min <b className="text-white">{c.walkForwardMinSkill.toFixed(3)}</b></span><span>WF dir. <b className="text-white">{pct(c.walkForwardDirectionConsistency)}</b></span><span>WF <b className="text-white">{c.walkForwardPositiveWindows}/{c.walkForwardWindows}</b></span>
        </div>
      </div>)}</div>
    </div>

    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-amber-300">Próxima barreira: holdout intocado</p>
      <p className="mt-1 text-[8px] leading-relaxed text-muted-foreground">Esta matriz não promove a feature. Depois de congelarmos uma candidata, o próximo teste deve ser executado num período temporal reservado e nunca usado para escolher feature, timeframe ou alvo. Só depois entram custos/payout, MFE/MAE e execução.</p>
    </div>
  </div>;
}

function Metric({ title, value, sub }: { title: string; value: string; sub: string }) { return <div className="rounded-xl border border-white/5 bg-black/30 p-3"><p className="text-[8px] uppercase tracking-widest text-muted-foreground">{title}</p><p className="mt-1 text-sm font-black text-white">{value}</p><p className="text-[8px] text-muted-foreground">{sub}</p></div>; }
