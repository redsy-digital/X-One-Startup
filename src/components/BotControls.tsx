import { useState, useEffect, useCallback, useRef } from "react";
import confetti from "canvas-confetti";
import { derivService } from "../lib/deriv";
import { NeonCard } from "./NeonCard";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { 
  Play, 
  Square, 
  TrendingUp, 
  TrendingDown, 
  Settings, 
  ShieldCheck, 
  Cpu,
  BarChart3
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

import { motion, AnimatePresence } from "motion/react";
import { SYMBOLS } from "../constants";
import { Candle, BotSettings, TradeSignal } from "../types";
import { analyzeMarket } from "../lib/strategy";
import { saveTrade } from "../lib/storage";

interface BotControlsProps {
  symbol: string;
  setSymbol: (s: string) => void;
  candles: Candle[];
  timeframe: number;
  setTimeframe: (t: number) => void;
  // Lifted from App
  token: string;
  isAuthorized: boolean;
  isBotRunning: boolean;
  setIsBotRunning: (val: boolean) => void;
  isDemo: boolean;
  setIsDemo: (val: boolean) => void;
  balance: number | null;
}

export const BotControls = ({ 
  symbol, 
  setSymbol, 
  candles, 
  timeframe, 
  setTimeframe,
  token,
  isAuthorized,
  isBotRunning,
  setIsBotRunning,
  isDemo,
  setIsDemo,
  balance
}: BotControlsProps) => {
  // Settings
  const [stake, setStake] = useState(1);
  const [currentStake, setCurrentStake] = useState(1);
  const [targetProfit, setTargetProfit] = useState(10);
  const [stopLoss, setStopLoss] = useState(5);
  const [minConfidence, setMinConfidence] = useState(70);
  const [cooldownSeconds, setCooldownSeconds] = useState(5);
  
  // Advanced Risk Management
  const [useMartingale, setUseMartingale] = useState(true);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2.1);
  const [maxMartingaleSteps, setMaxMartingaleSteps] = useState(5);
  const [martingaleStep, setMartingaleStep] = useState(0);
  
  const [useSoros, setUseSoros] = useState(false);
  const [sorosLevel, setSorosLevel] = useState(0);
  const [maxSorosLevels, setMaxSorosLevels] = useState(3);

  const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(5);
  const [cooldownAfterLoss, setCooldownAfterLoss] = useState(30); // seconds
  
  // Strategy Profile
  const [strategyProfile, setStrategyProfile] = useState<"conservative" | "balanced" | "aggressive">("balanced");
  
  const [initialBalance, setInitialBalance] = useState<number | null>(null);
  const [lastProposal, setLastProposal] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSignal, setLastSignal] = useState<TradeSignal | null>(null);
  const lastSignalRef = useRef<TradeSignal | null>(null);

  useEffect(() => {
    lastSignalRef.current = lastSignal;
  }, [lastSignal]);
  
  const [showModal, setShowModal] = useState<{ show: boolean; type: "profit" | "loss"; amount: number }>({
    show: false,
    type: "profit",
    amount: 0
  });
  
  // Session Stats
  const [sessionStats, setSessionStats] = useState({ wins: 0, losses: 0, consecutiveLosses: 0 });
  
  const isBotRunningRef = useRef(false);
  const isProcessingTradeRef = useRef<boolean>(false);
  const lastActionTimeRef = useRef<number>(0);
  const lastCandleTimeRef = useRef<number>(0);
  
  // Discipline & Structure Refs
  const lastTradeResultRef = useRef<"WON" | "LOST" | null>(null);
  const lastTradeTypeRef = useRef<"CALL" | "PUT" | null>(null);
  const lastTradeStructureIdRef = useRef<string | null>(null);
  const currentStructureIdRef = useRef<string>(Math.random().toString(36).substring(7));
  const currentStructureDirectionRef = useRef<"UP" | "DOWN" | "CHOPPY" | null>(null);
  const candlesSinceLastLossRef = useRef<number>(0);

  useEffect(() => {
    isBotRunningRef.current = isBotRunning;
    if (isBotRunning && balance !== null) {
      setInitialBalance(balance);
      lastActionTimeRef.current = 0;
      setMartingaleStep(0);
      setSorosLevel(0);
      setCurrentStake(stake);
      setSessionStats({ wins: 0, losses: 0, consecutiveLosses: 0 });
      lastTradeResultRef.current = null;
      lastTradeTypeRef.current = null;
      lastTradeStructureIdRef.current = null;
      candlesSinceLastLossRef.current = 0;
    }
    if (!isBotRunning) {
      isProcessingTradeRef.current = false;
    }
  }, [isBotRunning]);

  // Safety Timeout for stuck processing state
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isProcessingTradeRef.current) {
      timeout = setTimeout(() => {
        if (isProcessingTradeRef.current) {
          console.warn("Trade processing stuck, resetting...");
          isProcessingTradeRef.current = false;
        }
      }, 15000); // 15 seconds safety
    }
    return () => clearTimeout(timeout);
  }, [isProcessingTradeRef.current]);

  // Monitor Profit/Loss for Stop Loss and Take Profit
  useEffect(() => {
    if (isBotRunning && initialBalance !== null && balance !== null) {
      const currentProfit = balance - initialBalance;
      
      if (currentProfit >= targetProfit) {
        setIsBotRunning(false);
        setShowModal({ show: true, type: "profit", amount: currentProfit });
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#a855f7', '#3b82f6', '#22c55e']
        });
      } else if (currentProfit <= -stopLoss) {
        setIsBotRunning(false);
        setShowModal({ show: true, type: "loss", amount: currentProfit });
      }
    }
  }, [balance, initialBalance, isBotRunning, targetProfit, stopLoss]);

  const placeTrade = useCallback((type: "CALL" | "PUT") => {
    if (!isAuthorized || isProcessingTradeRef.current) return;
    setError(null);
    isProcessingTradeRef.current = true;
    derivService.getPriceProposal(symbol, type, stake, 5, "t");
  }, [isAuthorized, symbol, stake]);

  // Strategy Execution based on Candles
  useEffect(() => {
    if (!isBotRunning || isProcessingTradeRef.current || candles.length < 50) return;

    const lastCandle = candles[candles.length - 1];
    if (lastCandle.time === lastCandleTimeRef.current) return; 
    
    // New Candle Formed!
    lastCandleTimeRef.current = lastCandle.time;
    if (lastTradeResultRef.current === "LOST") {
      candlesSinceLastLossRef.current += 1;
    }
    
    const analysis = analyzeMarket(candles, symbol);
    setLastSignal(analysis);

    // --- ENHANCED MARKET STRUCTURE MANAGEMENT ---
    const newDir = analysis.indicators.marketCondition === "CHOPPY" ? "CHOPPY" : (analysis.indicators.emaFast > analysis.indicators.emaSlow ? "UP" : "DOWN");
    const last5 = candles.slice(-5);
    
    // Structure Persistence Logic (Context-Aware)
    let shouldReset = false;
    let resetReason = "";
    
    if (newDir !== currentStructureDirectionRef.current) {
      shouldReset = true; 
      resetReason = "Mudança de Direção Dominante";
    } else if (newDir === "UP") {
      // Pullback check: 3 red candles or price deep below EMA Slow
      const redCount = last5.filter(c => c.close < c.open).length;
      if (redCount >= 3) {
        shouldReset = true;
        resetReason = "Pullback Estrutural (3+ Red)";
      } else if (lastCandle.close < analysis.indicators.emaSlow) {
        shouldReset = true;
        resetReason = "Quebra de Suporte (EMA Slow)";
      }
    } else if (newDir === "DOWN") {
      const greenCount = last5.filter(c => c.close > c.open).length;
      if (greenCount >= 3) {
        shouldReset = true;
        resetReason = "Pullback Estrutural (3+ Green)";
      } else if (lastCandle.close > analysis.indicators.emaSlow) {
        shouldReset = true;
        resetReason = "Quebra de Resistência (EMA Slow)";
      }
    }
    
    if (analysis.indicators.marketCondition === "CHOPPY" && currentStructureDirectionRef.current !== "CHOPPY") {
      shouldReset = true;
      resetReason = "Entrada em Zona de Lateralização";
    }

    if (shouldReset) {
      currentStructureIdRef.current = Math.random().toString(36).substring(7);
      currentStructureDirectionRef.current = newDir;
      if (analysis.indicators) {
        analysis.indicators.structureResetReason = resetReason;
      }
    }

    if (analysis.type === "NEUTRAL") return;

    // 1. Discipline: Post-Loss Confirmation
    if (lastTradeResultRef.current === "LOST" && analysis.type === lastTradeTypeRef.current) {
      if (lastTradeStructureIdRef.current === currentStructureIdRef.current) {
        // Still in the same move as the loss, block reentry
        return;
      }
    }

    // 2. Discipline: Saturated Trend / Entry Timing
    const freshness = analysis.indicators.trendFreshnessScore || 0;
    const timing = analysis.indicators.timingQuality || 0;
    
    if (freshness < 4) return; // Movimento já correu demais (Exaustão)
    if (timing < 5) return; // Entrada atrasada detectada (Late Entry)

    // 3. Confidence Requirement (Strictly following user panel settings)
    const effectiveMinConf = minConfidence;
    if (analysis.confidence < effectiveMinConf) return;

    // 4. Cooldown Safety
    const now = Date.now();
    if (now - lastActionTimeRef.current < cooldownSeconds * 1000) return;

    // 5. Execution
    isProcessingTradeRef.current = true;
    lastActionTimeRef.current = now;
    lastTradeTypeRef.current = analysis.type as "CALL" | "PUT";
    lastTradeStructureIdRef.current = currentStructureIdRef.current;
    
    derivService.getPriceProposal(symbol, analysis.type as "CALL" | "PUT", currentStake, 5, "t");

  }, [candles, isBotRunning, currentStake, minConfidence, cooldownSeconds, maxConsecutiveLosses, cooldownAfterLoss, sessionStats.consecutiveLosses]);

  useEffect(() => {
    const unsubProposal = derivService.on("proposal", (data) => {
      if (data.error) {
        setError(data.error.message);
        isProcessingTradeRef.current = false;
        return;
      }

      if (data.proposal) {
        setLastProposal(data.proposal);
        if (isBotRunningRef.current) {
          derivService.buy(data.proposal.id, data.proposal.ask_price);
        } else {
          isProcessingTradeRef.current = false;
        }
      }
    });

    const unsubBuy = derivService.on("buy", (data) => {
      isProcessingTradeRef.current = false;
      if (data.error) {
        setError(data.error.message);
      } else {
        setError(null);
        // Log entry
        const buy = data.buy;
        if (buy) {
          saveTrade({
            id: String(buy.contract_id),
            time: Date.now(),
            symbol: symbol,
            type: lastTradeTypeRef.current || "CALL",
            stake: buy.buy_price,
            status: "PENDING",
            confidence: lastSignalRef.current?.confidence,
            score: lastSignalRef.current?.indicators.score,
            indicators: lastSignalRef.current?.indicators ? {
              ...lastSignalRef.current.indicators,
              lossStreak: sessionStats.consecutiveLosses,
              structureId: currentStructureIdRef.current,
            } : undefined
          });
        }
      }
    });

    const unsubPOC = derivService.on("proposal_open_contract", (data) => {
      if (data.proposal_open_contract) {
        const contract = data.proposal_open_contract;
        
        // Instant Balance Update Request
        if (contract.is_sold) {
          derivService.send({ balance: 1, subscribe: 1 });
          
          const isWin = contract.status === "won";
          
          // Update Discipline Refs
          lastTradeResultRef.current = isWin ? "WON" : "LOST";
          if (!isWin) {
            candlesSinceLastLossRef.current = 0; 
          }
          
          // CRITICAL: Ensure correct settlement in history
          saveTrade({
            id: String(contract.contract_id),
            time: contract.date_start * 1000,
            symbol: contract.display_name,
            type: contract.contract_type === "CALL" || contract.contract_type === "CALLE" ? "CALL" : "PUT",
            stake: contract.buy_price,
            status: isWin ? "WON" : "LOST",
            profit: contract.profit,
            entryPrice: contract.entry_tick,
            exitPrice: contract.exit_tick,
            // Preserve indicators from existing record if possible
          });

          setSessionStats(prev => ({
            wins: prev.wins + (isWin ? 1 : 0),
            losses: prev.losses + (isWin ? 0 : 1),
            consecutiveLosses: isWin ? 0 : prev.consecutiveLosses + 1
          }));

          if (isBotRunningRef.current) {
            if (isWin) {
              lastActionTimeRef.current = Date.now();
              // Reset Martingale
              setMartingaleStep(0);
              // Handle Soros
              if (useSoros) {
                const nextSoros = currentStake + (contract.profit || 0);
                setCurrentStake(nextSoros);
                setSorosLevel(prev => prev + 1);
                
                if (sorosLevel >= maxSorosLevels) {
                  setCurrentStake(stake);
                  setSorosLevel(0);
                }
              } else {
                setCurrentStake(stake);
              }
            } else {
              lastActionTimeRef.current = Date.now();
              // Handle Martingale
              if (useMartingale && martingaleStep < maxMartingaleSteps) {
                const nextStep = martingaleStep + 1;
                setMartingaleStep(nextStep);
                setCurrentStake(stake * Math.pow(martingaleMultiplier, nextStep));
              } else {
                setMartingaleStep(0);
                setCurrentStake(stake);
              }
              // Reset Soros
              setSorosLevel(0);
            }
          }
        }
      }
    });

    return () => {
      unsubProposal();
      unsubBuy();
      unsubPOC();
    };
  }, [stake, symbol, currentStake, strategyProfile, useMartingale, martingaleMultiplier, martingaleStep, useSoros, isBotRunning, setIsBotRunning, balance]);

  // Subscribe to ticks when symbol changes
  useEffect(() => {
    if (isAuthorized) {
      derivService.unsubscribeTicks(symbol); // Forget previous stream
      derivService.subscribeTicks(symbol);
    }
  }, [symbol, isAuthorized]);

  const runBacktest = () => {
    if (candles.length < 50) {
      setError("Duração insuficiente de dados para backtest.");
      return;
    }
    
    let virtualBalance = 1000;
    let wins = 0;
    let losses = 0;
    
    for (let i = 30; i < candles.length - 1; i++) {
      const slice = candles.slice(0, i + 1);
      const signal = analyzeMarket(slice, symbol);
      
      if (signal.type !== "NEUTRAL" && signal.confidence >= minConfidence) {
        // Simple simulation: check if next candle closed in favor
        const nextCandle = candles[i + 1];
        const isWin = signal.type === "CALL" ? nextCandle.close > nextCandle.open : nextCandle.close < nextCandle.open;
        
        if (isWin) {
          wins++;
          virtualBalance += stake * 0.95;
        } else {
          losses++;
          virtualBalance -= stake;
        }
      }
    }
    
    const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    setError(`Backtest: ${wins}W / ${losses}L | WinRate: ${winRate}% | Saldo Simulado: $${virtualBalance.toFixed(2)}`);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 relative">
      {/* Success/Loss Modal Overlay */}
      {showModal.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <NeonCard 
            variant={showModal.type === "profit" ? "purple" : "blue"} 
            className="max-w-md w-full p-8 text-center space-y-6 shadow-2xl"
          >
            <div className={cn(
              "w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4",
              showModal.type === "profit" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
            )}>
              {showModal.type === "profit" ? (
                <TrendingUp className="w-10 h-10" />
              ) : (
                <TrendingDown className="w-10 h-10" />
              )}
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-black uppercase tracking-tighter">
                {showModal.type === "profit" ? "Parabéns!" : "Operação Encerrada"}
              </h2>
              <p className="text-muted-foreground font-medium">
                {showModal.type === "profit" 
                  ? `Meta de $${targetProfit} atingida com sucesso!` 
                  : "Meta de perdas atingida, operação encerrada."}
              </p>
            </div>

            <div className="py-4 px-6 bg-white/5 rounded-2xl border border-white/10">
              <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Resultado da Sessão</p>
              <p className={cn(
                "text-3xl font-black",
                showModal.type === "profit" ? "text-green-400" : "text-red-400"
              )}>
                {showModal.type === "profit" ? "+" : ""}${showModal.amount.toFixed(2)}
              </p>
            </div>

            <Button 
              onClick={() => setShowModal({ ...showModal, show: false })}
              className="w-full bg-purple-600 hover:bg-purple-700 font-bold uppercase py-6"
            >
              Entendido
            </Button>
          </NeonCard>
        </div>
      )}

      <NeonCard variant="purple" className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-purple-500" />
            Configurações Técnicas
          </h3>
          <Badge variant="outline" className="border-purple-500/30 text-purple-400">STATUS: {isAuthorized ? "ESTÁVEL" : "DESCONECTADO"}</Badge>
        </div>
        
        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-[10px] text-red-400 font-bold uppercase animate-pulse">
              Mensagem: {error}
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <label className="text-xs text-muted-foreground uppercase font-bold px-1">Perfil da IA</label>
              <Select value={strategyProfile} onValueChange={(val: any) => setStrategyProfile(val)}>
                <SelectTrigger className="bg-black/20 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#111114] border-white/10 text-white">
                  <SelectItem value="conservative">Conservador (Min. 80% Conf.)</SelectItem>
                  <SelectItem value="balanced">Equilibrado (Min. 70% Conf.)</SelectItem>
                  <SelectItem value="aggressive">Agressivo (Min. 55% Conf.)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground uppercase font-bold">Confiança Min. (%)</label>
              <Input 
                type="number" 
                value={minConfidence} 
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                className="bg-black/20 border-white/10 h-9"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground uppercase font-bold">Cooldown (s)</label>
              <Input 
                type="number" 
                value={cooldownSeconds} 
                onChange={(e) => setCooldownSeconds(Number(e.target.value))}
                className="bg-black/20 border-white/10 h-9"
              />
            </div>

            <div className="p-4 bg-white/5 rounded-xl border border-white/10 col-span-2">
              <p className="text-[10px] text-muted-foreground uppercase font-bold mb-2">Resumo da Conexão</p>
              <div className="flex items-center justify-between">
                <div>
                  <span className={cn("text-xs font-black uppercase", isDemo ? "text-blue-400" : "text-red-400")}>
                    Conta {isDemo ? "Demo" : "Real"}
                  </span>
                  <p className="text-[10px] text-muted-foreground">ID da Sessão: {Math.floor(Math.random() * 1000000)}</p>
                </div>
                <Badge variant={isAuthorized ? "default" : "destructive"} className={isAuthorized ? "bg-green-500/20 text-green-400" : ""}>
                  {isAuthorized ? "Conectado" : "Erro"}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </NeonCard>

      <NeonCard variant="blue" className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-500" />
            IA X-One Intelligence
          </h3>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn(
              "text-[8px] md:text-[10px] uppercase font-black px-2 py-0.5",
              lastSignal?.indicators.marketCondition === "TRENDING" ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
            )}>
              {lastSignal?.indicators.marketCondition || "ANALISANDO..."}
            </Badge>
            <Switch checked={isBotRunning} onCheckedChange={setIsBotRunning} disabled={!isAuthorized} />
          </div>
        </div>

        {/* Confidence Meter */}
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-muted-foreground">
            <span>Confiança da IA</span>
            <span className={cn(
              "font-black",
              (lastSignal?.confidence || 0) >= minConfidence ? "text-green-400" : "text-red-400"
            )}>{lastSignal?.confidence || 0}%</span>
          </div>
          <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/10">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${lastSignal?.confidence || 0}%` }}
              className={cn(
                "h-full transition-all duration-500",
                (lastSignal?.confidence || 0) >= minConfidence ? "bg-gradient-to-r from-blue-500 to-green-400" : "bg-gradient-to-r from-red-500 to-yellow-500"
              )}
            />
          </div>
        </div>

        {/* Technical Signals Breakdown */}
        <div className="grid grid-cols-2 gap-2 mb-6">
          <div className="p-2 bg-white/5 rounded-lg border border-white/5 flex flex-col items-center justify-center">
            <span className="text-[7px] text-muted-foreground uppercase font-bold">Trend Freshness</span>
            <span className={cn(
              "text-[9px] font-black uppercase tracking-widest",
              (lastSignal?.indicators.trendFreshnessScore || 0) > 7 ? "text-green-400" : (lastSignal?.indicators.trendFreshnessScore || 0) > 4 ? "text-yellow-400" : "text-red-400"
            )}>
              {lastSignal?.indicators.trendFreshnessScore?.toFixed(1) || "0.0"}/10
            </span>
          </div>
          <div className="p-2 bg-white/5 rounded-lg border border-white/5 flex flex-col items-center justify-center">
            <span className="text-[7px] text-muted-foreground uppercase font-bold">Timing Quality</span>
            <span className={cn(
              "text-[9px] font-black uppercase tracking-widest",
              (lastSignal?.indicators.timingQuality || 0) > 7 ? "text-green-400" : "text-yellow-400"
            )}>
              {lastSignal?.indicators.timingQuality?.toFixed(1) || "0.0"}/10
            </span>
          </div>
          <div className="p-2 bg-white/5 rounded-lg border border-white/5 flex flex-col items-center justify-center col-span-2">
            <span className="text-[7px] text-muted-foreground uppercase font-bold">Análise Estrutural</span>
            <span className="text-[8px] font-black uppercase text-blue-400 text-center leading-tight">
              {lastSignal?.indicators.reason || "Aguardando confirmação..."}
            </span>
            {lastSignal?.indicators.isExhausted && (
              <Badge variant="destructive" className="mt-1 h-3 text-[6px] uppercase px-1">Exaustão Detectada</Badge>
            )}
          </div>
        </div>

        {/* Session Stats Dashboard */}
        <div className="grid grid-cols-4 gap-2 mb-6">
          <div className="p-2 bg-white/5 rounded-lg border border-white/10 text-center">
            <p className="text-[8px] text-muted-foreground uppercase font-bold">Wins</p>
            <p className="text-sm font-black text-green-400">{sessionStats.wins}</p>
          </div>
          <div className="p-2 bg-white/5 rounded-lg border border-white/10 text-center">
            <p className="text-[8px] text-muted-foreground uppercase font-bold">Losses</p>
            <p className="text-sm font-black text-red-400">{sessionStats.losses}</p>
          </div>
          <div className="p-2 bg-white/5 rounded-lg border border-white/10 text-center">
            <p className="text-[8px] text-muted-foreground uppercase font-bold">WR</p>
            <p className="text-sm font-black text-blue-400">
              {sessionStats.wins + sessionStats.losses > 0 
                ? Math.round((sessionStats.wins / (sessionStats.wins + sessionStats.losses)) * 100) 
                : 0}%
            </p>
          </div>
          <div className="p-2 bg-white/5 rounded-lg border border-white/10 text-center">
            <p className="text-[8px] text-muted-foreground uppercase font-bold">Conseq. L</p>
            <p className="text-sm font-black text-orange-400">{sessionStats.consecutiveLosses}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="space-y-2 col-span-2">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">Ativo & Timeframe</label>
            <div className="flex gap-2">
              <Select value={symbol} onValueChange={(val) => setSymbol(val)}>
                <SelectTrigger className="bg-black/20 border-white/10 flex-1">
                  <SelectValue placeholder="Ativo" />
                </SelectTrigger>
                <SelectContent className="bg-[#111114] border-white/10 text-white">
                  {SYMBOLS.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={String(timeframe)} onValueChange={(val) => setTimeframe(Number(val))}>
                <SelectTrigger className="bg-black/20 border-white/10 w-24">
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
          
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">Stake Base ($)</label>
            <Input 
              type="number" 
              value={stake} 
              onChange={(e) => setStake(Number(e.target.value))}
              className="bg-black/20 border-white/10 h-9"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">Stake Atual ($)</label>
            <div className="h-9 flex items-center px-3 bg-white/5 rounded-lg border border-white/10 text-blue-400 font-black text-sm">
              ${currentStake.toFixed(2)}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">Take Profit ($)</label>
            <Input 
              type="number" 
              value={targetProfit} 
              onChange={(e) => setTargetProfit(Number(e.target.value))}
              className="bg-black/20 border-white/10 text-green-400 h-9"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase font-bold">Stop Loss ($)</label>
            <Input 
              type="number" 
              value={stopLoss} 
              onChange={(e) => setStopLoss(Number(e.target.value))}
              className="bg-black/20 border-white/10 text-red-400 h-9"
            />
          </div>

          {/* Advanced Risk Management UI */}
          <div className="col-span-2 p-3 bg-white/5 rounded-xl border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Gestão Avançada</span>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={runBacktest}
                className="h-6 text-[8px] uppercase font-bold text-blue-400 hover:text-blue-300"
              >
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
                  <Input 
                    type="number" 
                    value={maxMartingaleSteps} 
                    onChange={(e) => setMaxMartingaleSteps(Number(e.target.value))}
                    disabled={!useMartingale}
                    className="bg-black/20 border-white/10 h-6 text-[10px] px-2"
                  />
                  <Input 
                    type="number" 
                    step="0.1"
                    value={martingaleMultiplier} 
                    onChange={(e) => setMartingaleMultiplier(Number(e.target.value))}
                    disabled={!useMartingale}
                    className="bg-black/20 border-white/10 h-6 text-[10px] px-2"
                    placeholder="Mult"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[8px] text-muted-foreground uppercase font-bold">Soros Levels</label>
                  <Switch checked={useSoros} onCheckedChange={setUseSoros} className="scale-75" />
                </div>
                <Input 
                  type="number" 
                  value={maxSorosLevels} 
                  onChange={(e) => setMaxSorosLevels(Number(e.target.value))}
                  disabled={!useSoros}
                  className="bg-black/20 border-white/10 h-6 text-[10px] px-2"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[8px] text-muted-foreground uppercase font-bold px-1">Max Perdas Seguidas</label>
                <Input 
                  type="number" 
                  value={maxConsecutiveLosses} 
                  onChange={(e) => setMaxConsecutiveLosses(Number(e.target.value))}
                  className="bg-black/20 border-white/10 h-6 text-[10px] px-2"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] text-muted-foreground uppercase font-bold px-1">Cooldown Loss (s)</label>
                <Input 
                  type="number" 
                  value={cooldownAfterLoss} 
                  onChange={(e) => setCooldownAfterLoss(Number(e.target.value))}
                  className="bg-black/20 border-white/10 h-6 text-[10px] px-2"
                />
              </div>
            </div>
          </div>
          
          <div className="flex items-end col-span-2">
            <Button 
              className={cn(
                "w-full h-11 gap-2 font-black uppercase tracking-widest transition-all duration-300 shadow-xl",
                isBotRunning 
                  ? "bg-red-600 hover:bg-red-700 shadow-red-500/20" 
                  : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/20"
              )}
              onClick={() => setIsBotRunning(!isBotRunning)}
              disabled={!isAuthorized}
            >
              {isBotRunning ? (
                <><Square className="w-5 h-5 fill-current" /> Stop IA</>
              ) : (
                <><Play className="w-5 h-5 fill-current" /> Start IA</>
              )}
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="flex-1 border-green-500/30 text-green-400 hover:bg-green-500/10 gap-2 font-bold" 
            disabled={!isAuthorized || isBotRunning}
            onClick={() => placeTrade("CALL")}
          >
            <TrendingUp className="w-4 h-4" /> CALL
          </Button>
          <Button 
            variant="outline" 
            className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10 gap-2 font-bold" 
            disabled={!isAuthorized || isBotRunning}
            onClick={() => placeTrade("PUT")}
          >
            <TrendingDown className="w-4 h-4" /> PUT
          </Button>
        </div>
      </NeonCard>
    </div>
  );
};
