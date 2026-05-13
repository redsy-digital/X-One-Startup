import { useState, useEffect, useRef } from "react";
import { derivService } from "../lib/deriv";
import { NeonCard } from "./NeonCard";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { Play, Square, TrendingUp, TrendingDown, Settings, ShieldCheck, Cpu, BarChart3 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { motion } from "motion/react";
import { SYMBOLS } from "../constants";
import { analyzeMarket } from "../lib/strategy";
import { useRiskManager } from "../hooks/useRiskManager";
import { useTradingEngine } from "../hooks/useTradingEngine";
import { useConnectionStore, useBotStore, useMarketStore } from "../store";

// Zero props — todas as dependências vêm das stores
export const BotControls = () => {
  // Stores
  const { isAuthorized, isDemo, balance } = useConnectionStore();
  const { isBotRunning, setIsBotRunning } = useBotStore();
  const { symbol, setSymbol, candles, timeframe, setTimeframe } = useMarketStore();

  // Settings locais (futuramente virão de useSettingsStore)
  const [stake, setStake] = useState(1);
  const [targetProfit, setTargetProfit] = useState(10);
  const [stopLoss, setStopLoss] = useState(5);
  const [minConfidence, setMinConfidence] = useState(70);
  const [cooldownSeconds, setCooldownSeconds] = useState(5);
  const [useMartingale, setUseMartingale] = useState(true);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2.1);
  const [maxMartingaleSteps, setMaxMartingaleSteps] = useState(5);
  const [useSoros, setUseSoros] = useState(false);
  const [maxSorosLevels, setMaxSorosLevels] = useState(3);
  const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(5);
  const [cooldownAfterLoss, setCooldownAfterLoss] = useState(30);
  const [strategyProfile, setStrategyProfile] = useState<"conservative" | "balanced" | "aggressive">("balanced");
  const [backtestResult, setBacktestResult] = useState<string | null>(null);

  const sessionIdRef = useRef(Math.random().toString(36).substring(2, 8).toUpperCase());
  const isBotRunningRef = useRef(false);
  useEffect(() => { isBotRunningRef.current = isBotRunning; }, [isBotRunning]);

  // Risk Manager
  const [riskState, riskActions] = useRiskManager(
    { stake, targetProfit, stopLoss, useMartingale, martingaleMultiplier, maxMartingaleSteps, useSoros, maxSorosLevels },
    isBotRunning, balance, setIsBotRunning
  );

  useEffect(() => {
    if (isBotRunning && balance !== null) riskActions.onBotStart(balance);
    if (!isBotRunning) riskActions.onBotStop();
  }, [isBotRunning]);

  // Trading Engine
  const { lastSignal, sessionStats, error, placeTrade } = useTradingEngine(
    { symbol, candles, currentStake: riskState.currentStake, stake, minConfidence, cooldownSeconds, isBotRunning, isAuthorized, onWin: riskActions.onWin, onLoss: riskActions.onLoss },
    isBotRunningRef
  );

  // Subscribe ticks on symbol change
  useEffect(() => {
    if (isAuthorized) {
      derivService.unsubscribeTicks(symbol);
      derivService.subscribeTicks(symbol);
    }
  }, [symbol, isAuthorized]);

  // Backtest
  const runBacktest = () => {
    if (candles.length < 50) { setBacktestResult("Duração insuficiente de dados para backtest."); return; }
    let virtualBalance = 1000, wins = 0, losses = 0;
    for (let i = 30; i < candles.length - 1; i++) {
      const signal = analyzeMarket(candles.slice(0, i + 1), symbol);
      if (signal.type !== "NEUTRAL" && signal.confidence >= minConfidence) {
        const next = candles[i + 1];
        const isWin = signal.type === "CALL" ? next.close > next.open : next.close < next.open;
        isWin ? (wins++, virtualBalance += stake * 0.95) : (losses++, virtualBalance -= stake);
      }
    }
    const wr = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    setBacktestResult(`Backtest: ${wins}W / ${losses}L | WinRate: ${wr}% | Saldo Simulado: $${virtualBalance.toFixed(2)}`);
  };

  const feedbackMessage = error || backtestResult;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 relative">
      {/* Modal */}
      {riskState.showModal.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <NeonCard variant={riskState.showModal.type === "profit" ? "purple" : "blue"} className="max-w-md w-full p-8 text-center space-y-6 shadow-2xl">
            <div className={cn("w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4", riskState.showModal.type === "profit" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400")}>
              {riskState.showModal.type === "profit" ? <TrendingUp className="w-10 h-10" /> : <TrendingDown className="w-10 h-10" />}
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black uppercase tracking-tighter">{riskState.showModal.type === "profit" ? "Parabéns!" : "Operação Encerrada"}</h2>
              <p className="text-muted-foreground font-medium">{riskState.showModal.type === "profit" ? `Meta de $${targetProfit} atingida!` : "Meta de perdas atingida, operação encerrada."}</p>
            </div>
            <div className="py-4 px-6 bg-white/5 rounded-2xl border border-white/10">
              <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Resultado da Sessão</p>
              <p className={cn("text-3xl font-black", riskState.showModal.type === "profit" ? "text-green-400" : "text-red-400")}>
                {riskState.showModal.type === "profit" ? "+" : ""}${riskState.showModal.amount.toFixed(2)}
              </p>
            </div>
            <Button onClick={riskActions.closeModal} className="w-full bg-purple-600 hover:bg-purple-700 font-bold uppercase py-6">Entendido</Button>
          </NeonCard>
        </div>
      )}

      {/* Card Esquerdo */}
      <NeonCard variant="purple" className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-purple-500" />Configurações Técnicas</h3>
          <Badge variant="outline" className="border-purple-500/30 text-purple-400">STATUS: {isAuthorized ? "ESTÁVEL" : "DESCONECTADO"}</Badge>
        </div>
        <div className="space-y-4">
          {feedbackMessage && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-[10px] text-red-400 font-bold uppercase animate-pulse">{feedbackMessage}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <label className="text-xs text-muted-foreground uppercase font-bold px-1">Perfil da IA</label>
              <Select value={strategyProfile} onValueChange={(val: any) => setStrategyProfile(val)}>
                <SelectTrigger className="bg-black/20 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#111114] border-white/10 text-white">
                  <SelectItem value="conservative">Conservador (Min. 80% Conf.)</SelectItem>
                  <SelectItem value="balanced">Equilibrado (Min. 70% Conf.)</SelectItem>
                  <SelectItem value="aggressive">Agressivo (Min. 55% Conf.)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground uppercase font-bold">Confiança Min. (%)</label>
              <Input type="number" value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))} className="bg-black/20 border-white/10 h-9" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground uppercase font-bold">Cooldown (s)</label>
              <Input type="number" value={cooldownSeconds} onChange={(e) => setCooldownSeconds(Number(e.target.value))} className="bg-black/20 border-white/10 h-9" />
            </div>
            <div className="p-4 bg-white/5 rounded-xl border border-white/10 col-span-2">
              <p className="text-[10px] text-muted-foreground uppercase font-bold mb-2">Resumo da Conexão</p>
              <div className="flex items-center justify-between">
                <div>
                  <span className={cn("text-xs font-black uppercase", isDemo ? "text-blue-400" : "text-red-400")}>Conta {isDemo ? "Demo" : "Real"}</span>
                  <p className="text-[10px] text-muted-foreground">ID da Sessão: {sessionIdRef.current}</p>
                </div>
                <Badge variant={isAuthorized ? "default" : "destructive"} className={isAuthorized ? "bg-green-500/20 text-green-400" : ""}>{isAuthorized ? "Conectado" : "Erro"}</Badge>
              </div>
            </div>
          </div>
        </div>
      </NeonCard>

      {/* Card Direito */}
      <NeonCard variant="blue" className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold flex items-center gap-2"><Cpu className="w-5 h-5 text-blue-500" />IA X-One Intelligence</h3>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-[8px] md:text-[10px] uppercase font-black px-2 py-0.5",
              lastSignal?.indicators.marketCondition === "TRENDING" ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-yellow-500/10 text-yellow-500 border-yellow-500/30")}>
              {lastSignal?.indicators.marketCondition || "ANALISANDO..."}
            </Badge>
            <Switch checked={isBotRunning} onCheckedChange={setIsBotRunning} disabled={!isAuthorized} />
          </div>
        </div>

        {/* Confidence */}
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-muted-foreground">
            <span>Confiança da IA</span>
            <span className={cn("font-black", (lastSignal?.confidence || 0) >= minConfidence ? "text-green-400" : "text-red-400")}>{lastSignal?.confidence || 0}%</span>
          </div>
          <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/10">
            <motion.div initial={{ width: 0 }} animate={{ width: `${lastSignal?.confidence || 0}%` }}
              className={cn("h-full transition-all duration-500", (lastSignal?.confidence || 0) >= minConfidence ? "bg-gradient-to-r from-blue-500 to-green-400" : "bg-gradient-to-r from-red-500 to-yellow-500")} />
          </div>
        </div>

        {/* Signal Quality */}
        <div className="grid grid-cols-2 gap-2 mb-6">
          <div className="p-2 bg-white/5 rounded-lg border border-white/5 flex flex-col items-center justify-center">
            <span className="text-[7px] text-muted-foreground uppercase font-bold">Trend Freshness</span>
            <span className={cn("text-[9px] font-black uppercase tracking-widest",
              (lastSignal?.indicators.trendFreshnessScore || 0) > 7 ? "text-green-400" : (lastSignal?.indicators.trendFreshnessScore || 0) > 4 ? "text-yellow-400" : "text-red-400")}>
              {lastSignal?.indicators.trendFreshnessScore?.toFixed(1) || "0.0"}/10
            </span>
          </div>
          <div className="p-2 bg-white/5 rounded-lg border border-white/5 flex flex-col items-center justify-center">
            <span className="text-[7px] text-muted-foreground uppercase font-bold">Timing Quality</span>
            <span className={cn("text-[9px] font-black uppercase tracking-widest", (lastSignal?.indicators.timingQuality || 0) > 7 ? "text-green-400" : "text-yellow-400")}>
              {lastSignal?.indicators.timingQuality?.toFixed(1) || "0.0"}/10
            </span>
          </div>
          <div className="p-2 bg-white/5 rounded-lg border border-white/5 flex flex-col items-center justify-center col-span-2">
            <span className="text-[7px] text-muted-foreground uppercase font-bold">Análise Estrutural</span>
            <span className="text-[8px] font-black uppercase text-blue-400 text-center leading-tight">{lastSignal?.indicators.reason || "Aguardando confirmação..."}</span>
            {lastSignal?.indicators.isExhausted && <Badge variant="destructive" className="mt-1 h-3 text-[6px] uppercase px-1">Exaustão Detectada</Badge>}
          </div>
        </div>

        {/* Session Stats */}
        <div className="grid grid-cols-4 gap-2 mb-6">
          {[
            { label: "Wins", value: sessionStats.wins, color: "text-green-400" },
            { label: "Losses", value: sessionStats.losses, color: "text-red-400" },
            { label: "WR", value: `${sessionStats.wins + sessionStats.losses > 0 ? Math.round((sessionStats.wins / (sessionStats.wins + sessionStats.losses)) * 100) : 0}%`, color: "text-blue-400" },
            { label: "Conseq. L", value: sessionStats.consecutiveLosses, color: "text-orange-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="p-2 bg-white/5 rounded-lg border border-white/10 text-center">
              <p className="text-[8px] text-muted-foreground uppercase font-bold">{label}</p>
              <p className={cn("text-sm font-black", color)}>{value}</p>
            </div>
          ))}
        </div>

        {/* Asset & Timeframe */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="space-y-2 col-span-2">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">Ativo & Timeframe</label>
            <div className="flex gap-2">
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="bg-black/20 border-white/10 flex-1"><SelectValue placeholder="Ativo" /></SelectTrigger>
                <SelectContent className="bg-[#111114] border-white/10 text-white">
                  {SYMBOLS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(timeframe)} onValueChange={(val) => setTimeframe(Number(val))}>
                <SelectTrigger className="bg-black/20 border-white/10 w-24"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#111114] border-white/10 text-white">
                  <SelectItem value="1">1s</SelectItem>
                  <SelectItem value="3">3s</SelectItem>
                  <SelectItem value="5">5s</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">Stake Base ($)</label>
            <Input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value))} className="bg-black/20 border-white/10 h-9" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">Stake Atual ($)</label>
            <div className="h-9 flex items-center px-3 bg-white/5 rounded-lg border border-white/10 text-blue-400 font-black text-sm">${riskState.currentStake.toFixed(2)}</div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">Take Profit ($)</label>
            <Input type="number" value={targetProfit} onChange={(e) => setTargetProfit(Number(e.target.value))} className="bg-black/20 border-white/10 text-green-400 h-9" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">Stop Loss ($)</label>
            <Input type="number" value={stopLoss} onChange={(e) => setStopLoss(Number(e.target.value))} className="bg-black/20 border-white/10 text-red-400 h-9" />
          </div>

          {/* Advanced */}
          <div className="col-span-2 p-3 bg-white/5 rounded-xl border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Gestão Avançada</span>
              </div>
              <Button variant="ghost" size="sm" onClick={runBacktest} className="h-6 text-[8px] uppercase font-bold text-blue-400 hover:text-blue-300">
                <BarChart3 className="w-3 h-3 mr-1" /> Testar Estratégia
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[8px] text-muted-foreground uppercase font-bold">Martingale Steps</label>
                  <Switch checked={useMartingale} onCheckedChange={setUseMartingale} className="scale-75" />
                </div>
                <div className="flex gap-1">
                  <Input type="number" value={maxMartingaleSteps} onChange={(e) => setMaxMartingaleSteps(Number(e.target.value))} disabled={!useMartingale} className="bg-black/20 border-white/10 h-6 text-[10px] px-2" />
                  <Input type="number" step="0.1" value={martingaleMultiplier} onChange={(e) => setMartingaleMultiplier(Number(e.target.value))} disabled={!useMartingale} className="bg-black/20 border-white/10 h-6 text-[10px] px-2" placeholder="Mult" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[8px] text-muted-foreground uppercase font-bold">Soros Levels</label>
                  <Switch checked={useSoros} onCheckedChange={setUseSoros} className="scale-75" />
                </div>
                <Input type="number" value={maxSorosLevels} onChange={(e) => setMaxSorosLevels(Number(e.target.value))} disabled={!useSoros} className="bg-black/20 border-white/10 h-6 text-[10px] px-2" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[8px] text-muted-foreground uppercase font-bold px-1">Max Perdas Seguidas</label>
                <Input type="number" value={maxConsecutiveLosses} onChange={(e) => setMaxConsecutiveLosses(Number(e.target.value))} className="bg-black/20 border-white/10 h-6 text-[10px] px-2" />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] text-muted-foreground uppercase font-bold px-1">Cooldown Loss (s)</label>
                <Input type="number" value={cooldownAfterLoss} onChange={(e) => setCooldownAfterLoss(Number(e.target.value))} className="bg-black/20 border-white/10 h-6 text-[10px] px-2" />
              </div>
            </div>
          </div>

          <div className="flex items-end col-span-2">
            <Button
              className={cn("w-full h-11 gap-2 font-black uppercase tracking-widest transition-all duration-300 shadow-xl",
                isBotRunning ? "bg-red-600 hover:bg-red-700 shadow-red-500/20" : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/20")}
              onClick={() => setIsBotRunning(!isBotRunning)} disabled={!isAuthorized}>
              {isBotRunning ? <><Square className="w-5 h-5 fill-current" /> Stop IA</> : <><Play className="w-5 h-5 fill-current" /> Start IA</>}
            </Button>
          </div>
        </div>

        {/* Manual Buttons */}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 border-green-500/30 text-green-400 hover:bg-green-500/10 gap-2 font-bold" disabled={!isAuthorized || isBotRunning} onClick={() => placeTrade("CALL")}>
            <TrendingUp className="w-4 h-4" /> CALL
          </Button>
          <Button variant="outline" className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10 gap-2 font-bold" disabled={!isAuthorized || isBotRunning} onClick={() => placeTrade("PUT")}>
            <TrendingDown className="w-4 h-4" /> PUT
          </Button>
        </div>
      </NeonCard>
    </div>
  );
};
