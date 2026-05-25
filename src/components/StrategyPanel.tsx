import React from "react";
import { motion } from "motion/react";
import { Shield, Zap, Scale, CheckCircle2, XCircle, AlertCircle, TrendingUp, Activity } from "lucide-react";
import { cn } from "../lib/utils";
import { NeonCard } from "./NeonCard";
import { Badge } from "./ui/badge";
import { STRATEGY_PROFILES } from "../lib/strategy";
import { StrategyProfile } from "../types";
import { useSettingsStore } from "../store/useSettingsStore";
import { useSignalStore } from "../store/useSignalStore";

const PROFILE_META: Record<StrategyProfile, {
  label: string; icon: React.ReactNode; description: string;
  color: string; bg: string; border: string; textAccent: string; restrictionScore: number;
}> = {
  conservative: { label: "Conservador", icon: <Shield className="w-5 h-5" />, description: "Só opera em TRENDING. Filtros máximos.", color: "from-purple-600 to-purple-800", bg: "bg-purple-500/10", border: "border-purple-500/40", textAccent: "text-purple-400", restrictionScore: 85 },
  balanced: { label: "Equilibrado", icon: <Scale className="w-5 h-5" />, description: "Opera em qualquer mercado com sinal forte.", color: "from-blue-600 to-blue-800", bg: "bg-blue-500/10", border: "border-blue-500/40", textAccent: "text-blue-400", restrictionScore: 50 },
  aggressive: { label: "Agressivo", icon: <Zap className="w-5 h-5" />, description: "Máximo de entradas. Filtros mínimos.", color: "from-orange-600 to-orange-800", bg: "bg-orange-500/10", border: "border-orange-500/40", textAccent: "text-orange-400", restrictionScore: 20 },
};

function Bar({ value, max, color = "bg-blue-500" }: { value: number; max: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: "easeOut" }}
        className={cn("h-full rounded-full", color)} />
    </div>
  );
}

function StatusItem({ label, value, pass, detail }: { label: string; value: string; pass: boolean | null; detail?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-2">
        {pass === null ? <AlertCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          : pass ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
          : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
        <span className="text-[11px] text-muted-foreground font-bold uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-right">
        <span className={cn("text-[11px] font-black", pass === null ? "text-muted-foreground" : pass ? "text-green-400" : "text-red-400")}>{value}</span>
        {detail && <span className="text-[9px] text-muted-foreground ml-1">({detail})</span>}
      </div>
    </div>
  );
}

export const StrategyPanel = () => {
  const { settings, updateSettings, changeProfile, isDirty } = useSettingsStore();
  const { lastSignal } = useSignalStore();
  const activeProfile = settings.strategyProfile;
  const cfg = STRATEGY_PROFILES[activeProfile];
  const meta = PROFILE_META[activeProfile];

  const liveChecks = React.useMemo(() => {
    if (!lastSignal) return null;
    const ind = lastSignal.indicators;
    const freshnessOk = (ind.trendFreshnessScore ?? 0) >= 4;
    const timingOk = (ind.timingQuality ?? 0) >= 5;
    const confidenceOk = lastSignal.confidence >= settings.minConfidence;
    const marketOk = cfg.requireTrending ? ind.marketCondition === "TRENDING" : true;
    const signalOk = lastSignal.type !== "NEUTRAL";
    return {
      marketOk, confidenceOk, freshnessOk, timingOk, signalOk,
      overallOk: signalOk && confidenceOk && freshnessOk && timingOk && marketOk,
    };
  }, [lastSignal, cfg, settings.minConfidence]);

  const barColor = activeProfile === "conservative" ? "bg-purple-500" : activeProfile === "balanced" ? "bg-blue-500" : "bg-orange-500";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Activity className="w-5 h-5 text-purple-400" />
        <h2 className="text-lg font-black uppercase tracking-widest">Estratégia & Perfil</h2>
        {isDirty && <Badge variant="outline" className="border-amber-500/30 text-amber-400 text-[9px]">A guardar...</Badge>}
      </div>

      {/* Selector de perfis */}
      <div className="grid grid-cols-3 gap-3">
        {(["conservative", "balanced", "aggressive"] as StrategyProfile[]).map((profile) => {
          const m = PROFILE_META[profile];
          const p = STRATEGY_PROFILES[profile];
          const isActive = profile === activeProfile;
          return (
            <motion.button key={profile} onClick={() => changeProfile(profile)} whileTap={{ scale: 0.97 }}
              className={cn("relative p-3 rounded-xl border-2 text-left transition-all duration-200 w-full",
                isActive ? `${m.bg} ${m.border} shadow-lg` : "bg-white/5 border-white/10 hover:border-white/20")}>
              {isActive && <div className={cn("absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full animate-pulse",
                profile === "conservative" ? "bg-purple-400" : profile === "balanced" ? "bg-blue-400" : "bg-orange-400")} />}
              <div className={cn("mb-2", isActive ? m.textAccent : "text-muted-foreground")}>{m.icon}</div>
              <p className={cn("text-[10px] font-black uppercase tracking-wide", isActive ? m.textAccent : "text-muted-foreground")}>{m.label}</p>
              <p className={cn("text-[10px] font-black mt-0.5", isActive ? "text-white" : "text-muted-foreground")}>{p.minConfidenceOverride}%</p>
            </motion.button>
          );
        })}
      </div>

      {/* Perfil activo */}
      <NeonCard variant={activeProfile === "conservative" ? "purple" : activeProfile === "balanced" ? "blue" : "pink"} className="p-5 space-y-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className={meta.textAccent}>{meta.icon}</span>
            <div>
              <p className={cn("text-sm font-black uppercase tracking-wide", meta.textAccent)}>{meta.label}</p>
              <p className="text-[10px] text-muted-foreground">{meta.description}</p>
            </div>
          </div>
          <Badge className={cn("text-[9px] font-black", meta.bg, meta.border, meta.textAccent)}>ACTIVO</Badge>
        </div>

        {/* Medidor de restrição */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] font-bold uppercase text-muted-foreground">
            <span>Nível de restrição</span>
            <span className={meta.textAccent}>{meta.restrictionScore}%</span>
          </div>
          <Bar value={meta.restrictionScore} max={100} color={barColor} />
          <div className="flex justify-between text-[8px] text-muted-foreground">
            <span>Agressivo</span><span>Conservador</span>
          </div>
        </div>

        {/* Parâmetros */}
        <div className="space-y-3">
          <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Thresholds Activos</p>
          {[
            { label: "Confiança Mínima", value: `${cfg.minConfidenceOverride}%`, barVal: cfg.minConfidenceOverride, barMax: 100 },
            { label: "Dominância requerida", value: `${cfg.dominanceMultiplier}x`, barVal: (cfg.dominanceMultiplier - 1.0) * 100, barMax: 50 },
            { label: "Score mínimo", value: `${cfg.minWinScore}/100`, barVal: cfg.minWinScore, barMax: 100 },
          ].map(({ label, value, barVal, barMax }) => (
            <div key={label}>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-muted-foreground font-bold">{label}</span>
                <span className={cn("font-black", meta.textAccent)}>{value}</span>
              </div>
              <Bar value={barVal} max={barMax} color={barColor} />
            </div>
          ))}
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-2">
          {[
            `RSI ${cfg.rsiOversold}–${cfg.rsiOverbought}`,
            `Máx ${cfg.maxConsecutiveCandles} consec.`,
            cfg.requireTrending ? "Só TRENDING" : "Qualquer mercado",
            `Freshness ×${cfg.freshnessWeight}`,
          ].map(text => (
            <span key={text} className={cn("px-2 py-1 rounded-lg border text-[9px] font-black", meta.bg, meta.border, meta.textAccent)}>{text}</span>
          ))}
        </div>
      </NeonCard>

      {/* Live Status */}
      <NeonCard variant="blue" className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" /> Estado do Último Sinal
          </p>
          {lastSignal ? (
            <Badge className={cn("text-[9px] font-black",
              liveChecks?.overallOk ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30")}>
              {liveChecks?.overallOk ? "✓ PRONTO" : "✗ BLOQUEADO"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[9px] text-muted-foreground border-white/10">Aguardando bot</Badge>
          )}
        </div>

        {lastSignal ? (
          <div className="space-y-0.5">
            <StatusItem label="Mercado" value={lastSignal.indicators.marketCondition ?? "—"}
              pass={cfg.requireTrending ? lastSignal.indicators.marketCondition === "TRENDING" : null}
              detail={cfg.requireTrending ? "requer TRENDING" : undefined} />
            <StatusItem label="Sinal" value={lastSignal.type} pass={lastSignal.type !== "NEUTRAL"} />
            <StatusItem label="Confiança" value={`${lastSignal.confidence}%`} pass={liveChecks?.confidenceOk ?? false} detail={`mín ${settings.minConfidence}%`} />
            <StatusItem label="Freshness" value={`${lastSignal.indicators.trendFreshnessScore?.toFixed(1) ?? "—"}/10`} pass={liveChecks?.freshnessOk ?? false} detail="mín 4.0" />
            <StatusItem label="Timing" value={`${lastSignal.indicators.timingQuality?.toFixed(1) ?? "—"}/10`} pass={liveChecks?.timingOk ?? false} detail="mín 5.0" />
            <StatusItem label="ADX" value={`${lastSignal.indicators.adx?.toFixed(1) ?? "—"}`}
              pass={lastSignal.indicators.adx !== undefined ? lastSignal.indicators.adx > 20 : null} detail="> 20" />
            {lastSignal.indicators.reason && (
              <div className="pt-2 text-[10px] text-muted-foreground italic">"{lastSignal.indicators.reason}"</div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-4 opacity-50">
            Inicia o bot para ver o estado dos sinais em tempo real
          </p>
        )}
      </NeonCard>

      {/* Tabela de comparação */}
      <NeonCard variant="purple" className="p-5 space-y-4">
        <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Comparação de Perfis</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr>
                <th className="text-left text-muted-foreground font-bold pb-3 pr-4">Parâmetro</th>
                {(["conservative", "balanced", "aggressive"] as StrategyProfile[]).map(p => (
                  <th key={p} className={cn("text-center pb-3 px-2 font-black uppercase",
                    p === activeProfile ? PROFILE_META[p].textAccent : "text-muted-foreground")}>
                    {PROFILE_META[p].label}{p === activeProfile && " ●"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Conf. mínima", fn: (p: StrategyProfile) => `${STRATEGY_PROFILES[p].minConfidenceOverride}%` },
                { label: "Dominância", fn: (p: StrategyProfile) => `${STRATEGY_PROFILES[p].dominanceMultiplier}x` },
                { label: "Score mínimo", fn: (p: StrategyProfile) => `${STRATEGY_PROFILES[p].minWinScore}` },
                { label: "RSI zona", fn: (p: StrategyProfile) => `${STRATEGY_PROFILES[p].rsiOversold}–${STRATEGY_PROFILES[p].rsiOverbought}` },
                { label: "Max consec.", fn: (p: StrategyProfile) => `${STRATEGY_PROFILES[p].maxConsecutiveCandles}` },
                { label: "Só TRENDING", fn: (p: StrategyProfile) => STRATEGY_PROFILES[p].requireTrending ? "Sim" : "Não" },
              ].map(({ label, fn }, i) => (
                <tr key={label} className={cn("border-t border-white/5", i % 2 === 0 ? "" : "bg-white/2")}>
                  <td className="text-muted-foreground py-2 pr-4 font-bold">{label}</td>
                  {(["conservative", "balanced", "aggressive"] as StrategyProfile[]).map(p => (
                    <td key={p} className={cn("text-center py-2 px-2 font-black",
                      p === activeProfile ? PROFILE_META[p].textAccent : "text-muted-foreground")}>
                      {fn(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </NeonCard>
    </div>
  );
};
