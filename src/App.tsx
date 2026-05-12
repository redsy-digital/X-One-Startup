import React, { useState, useEffect, useMemo } from "react";
import { cn } from "./lib/utils";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { BotControls } from "./components/BotControls";
import { TradingChart } from "./components/TradingChart";
import { NeonCard } from "./components/NeonCard";
import { derivService } from "./lib/deriv";
import { ScrollArea } from "./components/ui/scroll-area";
import { Badge } from "./components/ui/badge";
import { 
  Activity, 
  ArrowUpRight, 
  ArrowDownRight, 
  Clock, 
  Menu, 
  ShieldCheck, 
  Zap,
  TrendingUp,
  TrendingDown,
  LayoutDashboard,
  Bot,
  Settings
} from "lucide-react";
import { Button } from "./components/ui/button";
import { motion, AnimatePresence } from "motion/react";
import { Sheet, SheetContent, SheetTrigger } from "./components/ui/sheet";
import { HistoryPanel } from "./components/HistoryPanel";

import { SYMBOLS } from "./constants";
import { TickData, TradeHistory, Candle } from "./types";
import { Input } from "./components/ui/input";

import { GoogleGenAI } from "@google/genai";
import { getTradeHistory } from "./lib/storage";

export default function App() {
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [ticks, setTicks] = useState<TickData[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [timeframe, setTimeframe] = useState(1); // 1s
  const [symbol, setSymbol] = useState("R_100");
  const [history, setHistory] = useState<TradeHistory[]>([]);

  useEffect(() => {
    const loadLocalHistory = () => {
      setHistory(getTradeHistory());
    };
    loadLocalHistory();
    window.addEventListener("trade_history_updated", loadLocalHistory);
    return () => window.removeEventListener("trade_history_updated", loadLocalHistory);
  }, []);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Auth & Connection States
  const [token, setToken] = useState(() => localStorage.getItem("deriv_token") || "");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isDemo, setIsDemo] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [isBotRunning, setIsBotRunning] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem("deriv_token");
    if (savedToken) {
      handleLogin(savedToken);
    }
  }, []);

  const handleLogin = (t: string) => {
    if (!t) return;
    localStorage.setItem("deriv_token", t);
    setToken(t);
    derivService.setToken(t, isDemo);
    derivService.connect();
  };

  const handleLogout = () => {
    localStorage.removeItem("deriv_token");
    setIsLoggedIn(false);
    setIsAuthorized(false);
    setToken("");
    derivService.disconnect();
    window.location.reload(); // Hard reset for safety
  };

  useEffect(() => {
    if (isLoggedIn && token) {
      derivService.setToken(token, isDemo);
    }
  }, [isDemo, isLoggedIn, token]);

  useEffect(() => {
    setTicks([]); // Reset ticks when symbol changes
    setCandles([]);
  }, [symbol]);

  useEffect(() => {
    const unsubAuth = derivService.on("authorize", (data) => {
      if (!data.error) {
        setIsAuthorized(true);
        setIsLoggedIn(true);
        setBalance(data.authorize.balance);
        derivService.subscribeProposalOpenContract();
        derivService.send({ balance: 1, subscribe: 1 });
      } else {
        localStorage.removeItem("deriv_token");
        setIsAuthorized(false);
      }
    });

    const unsubBalance = derivService.on("balance", (data) => {
      if (!data.error) {
        setBalance(data.balance.balance);
      }
    });

    const unsubTick = derivService.on("tick", (data) => {
      if (data.tick) {
        const newTick = { time: data.tick.epoch, price: data.tick.quote };
        
        setTicks(prev => {
          const newTicks = [...prev, newTick].slice(-50);
          return newTicks;
        });

        // Tick to Candle Logic
        setCandles(prev => {
          const lastCandle = prev.length > 0 ? prev[prev.length - 1] : null;
          const currentTimestamp = Math.floor(newTick.time / timeframe) * timeframe;

          if (lastCandle && lastCandle.time === currentTimestamp) {
            // Update current candle
            const updatedCandle = {
              ...lastCandle,
              high: Math.max(lastCandle.high, newTick.price),
              low: Math.min(lastCandle.low, newTick.price),
              close: newTick.price,
            };
            return [...prev.slice(0, -1), updatedCandle];
          } else {
            // New candle
            const newCandle = {
              time: currentTimestamp,
              open: newTick.price,
              high: newTick.price,
              low: newTick.price,
              close: newTick.price,
            };
            return [...prev, newCandle].slice(-100);
          }
        });
      }
    });

    const unsubPOC = derivService.on("proposal_open_contract", (data) => {
      if (data.proposal_open_contract?.is_sold) {
        // Refresh balance when a trade is sold
        derivService.send({ balance: 1, subscribe: 1 });
      }
    });

    return () => {
      unsubTick();
      unsubAuth();
      unsubPOC();
      unsubBalance();
    };
  }, [timeframe]);

  const currentPrice = ticks.length > 0 ? ticks[ticks.length - 1].price : null;
  const prevPrice = ticks.length > 1 ? ticks[ticks.length - 2].price : null;
  const isUp = currentPrice && prevPrice ? currentPrice >= prevPrice : true;

  const stats = useMemo(() => {
    const wins = history.filter(h => h.status === "WON").length;
    const total = history.length;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
    const totalProfit = history.reduce((acc, h) => acc + (h.profit || 0), 0);
    return { winRate, totalProfit };
  }, [history]);

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in duration-500">
          <div className="text-center space-y-2">
            <div className="w-20 h-20 bg-white rounded-2xl mx-auto flex items-center justify-center neon-border-purple rotate-3 hover:rotate-0 transition-transform duration-300 overflow-hidden">
              <img src="https://lh3.googleusercontent.com/d/19uIpRxexOi6-7EZX-eMVHf3ewi3BxEys" alt="X-ONE Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
            </div>
            <h1 className="text-4xl font-black tracking-tighter neon-text-purple mt-6">X-ONE</h1>
            <p className="text-muted-foreground font-medium uppercase tracking-widest text-[10px]">Intelligence Trading Bot</p>
          </div>

          <NeonCard variant="purple" className="p-8 space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-purple-500" />
                  Acesso Restrito
                </h2>
                <Badge variant="outline" className="text-[8px] border-purple-500/30 text-purple-400">v2.0 PRO</Badge>
              </div>
              
              <div className="space-y-2">
                <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider ml-1">Token da Corretora (Deriv)</label>
                <div className="relative group">
                  <Input 
                    type="password"
                    placeholder="Insira seu token de acesso..."
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="bg-black/40 border-white/10 h-12 pl-4 focus:border-purple-500/50 transition-all text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-white/5 rounded-xl border border-white/5">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Utilizamos o seu token apenas para conexão segura via WebSocket direto com a Deriv.
                </p>
              </div>

              <Button 
                onClick={() => handleLogin(token)}
                disabled={!token}
                className="w-full h-12 bg-purple-600 hover:bg-purple-700 font-black uppercase tracking-widest shadow-xl shadow-purple-500/20 active:scale-95 transition-all"
              >
                Entrar no Painel
              </Button>
            </div>
          </NeonCard>

          <p className="text-center text-[10px] text-muted-foreground font-bold uppercase tracking-widest opacity-50">
            Powered by Quantitative Algorithms
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#0a0a0c] text-slate-200 font-sans selection:bg-purple-500/30">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <Sidebar onLogout={handleLogout} activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>

      <main className="flex-1 flex flex-col min-w-0">
        <Header 
          balance={balance} 
          isDemo={isDemo} 
          setIsDemo={setIsDemo} 
          isBotRunning={isBotRunning} 
        />
        
        {/* Mobile Header Extra */}
        <div className="lg:hidden px-6 py-3 border-b border-white/5 flex items-center justify-between bg-black/40">
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger render={
              <Button variant="ghost" size="icon" className="text-purple-400">
                <Menu className="w-6 h-6" />
              </Button>
            } />
            <SheetContent side="left" className="p-0 w-64 bg-[#0a0a0c] border-r border-white/10">
              <Sidebar onLogout={handleLogout} activeTab={activeTab} setActiveTab={setActiveTab} closeMobile={() => setIsMobileMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Live Server</span>
          </div>
        </div>

        <div className="flex-1 overflow-x-hidden">
          <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-7xl mx-auto w-full">
            {activeTab === "Histórico" ? (
              <HistoryPanel />
            ) : (
              <>
                {/* Top Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <NeonCard variant="purple" className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
                <p className="text-[10px] md:text-xs text-muted-foreground uppercase font-bold">Ativo</p>
                <div className="flex items-end justify-between">
                  <h2 className="text-sm md:text-lg font-black tracking-tight truncate">
                    {SYMBOLS.find(s => s.value === symbol)?.label || "Synthetic"}
                  </h2>
                  <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/50 text-[8px] md:text-[10px]">LIVE</Badge>
                </div>
              </NeonCard>

              <NeonCard variant={isUp ? "cyan" : "pink"} className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
                <p className="text-[10px] md:text-xs text-muted-foreground uppercase font-bold">Preço</p>
                <div className="flex items-center gap-1 md:gap-2">
                  <span className={cn(
                    "text-sm md:text-xl font-black tracking-tighter transition-colors duration-300",
                    isUp ? "text-cyan-400 neon-text-blue" : "text-pink-400 shadow-[0_0_5px_rgba(236,72,153,0.5)]"
                  )}>
                    {currentPrice ? currentPrice.toFixed(2) : "---"}
                  </span>
                  {isUp ? <ArrowUpRight className="text-cyan-400 w-3 h-3 md:w-5 md:h-5" /> : <ArrowDownRight className="text-pink-400 w-3 h-3 md:w-5 md:h-5" />}
                </div>
              </NeonCard>

              <NeonCard variant="blue" className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
                <p className="text-[10px] md:text-xs text-muted-foreground uppercase font-bold">Lucro</p>
                <div className="flex items-end justify-between">
                  <h2 className={cn(
                    "text-sm md:text-xl font-black tracking-tighter",
                    stats.totalProfit >= 0 ? "text-blue-400" : "text-red-400"
                  )}>
                    {stats.totalProfit >= 0 ? "+" : ""}${stats.totalProfit.toFixed(2)}
                  </h2>
                </div>
              </NeonCard>

              <NeonCard variant="purple" className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
                <p className="text-[10px] md:text-xs text-muted-foreground uppercase font-bold">Assertividade</p>
                <div className="flex items-end justify-between">
                  <h2 className="text-sm md:text-xl font-black tracking-tighter text-purple-400">{stats.winRate}%</h2>
                  <div className="hidden md:flex gap-1">
                    {history.slice(0, 5).map((h, i) => (
                      <div key={i} className={cn("w-2 h-2 rounded-full", h.status === "WON" ? "bg-green-500" : "bg-red-500")} />
                    ))}
                  </div>
                </div>
              </NeonCard>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
              {/* Chart Section */}
              <div className="lg:col-span-2 space-y-6 md:space-y-8">
                <NeonCard variant="purple" className="p-4 md:p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 md:w-5 md:h-5 text-purple-500" />
                      <h3 className="font-bold uppercase tracking-widest text-[10px] md:text-sm">Market Analysis</h3>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="outline" className="border-purple-500/50 text-purple-400 text-[8px] md:text-[10px]">REAL-TIME</Badge>
                    </div>
                  </div>
                  <TradingChart candles={candles} symbol={symbol} />
                </NeonCard>

                <BotControls 
                  symbol={symbol} 
                  setSymbol={setSymbol} 
                  candles={candles} 
                  setTimeframe={setTimeframe}
                  timeframe={timeframe}
                  token={token}
                  isAuthorized={isAuthorized}
                  isBotRunning={isBotRunning}
                  setIsBotRunning={setIsBotRunning}
                  isDemo={isDemo}
                  setIsDemo={setIsDemo}
                  balance={balance}
                />
              </div>

              {/* Sidebar Content */}
              <div className="space-y-6 md:space-y-8">
                <NeonCard variant="blue" className="p-4 md:p-6 flex flex-col h-full min-h-[400px]">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-bold uppercase tracking-widest text-[10px] md:text-sm flex items-center gap-2">
                      <Clock className="w-4 h-4 text-blue-500" />
                      Histórico
                    </h3>
                  </div>
                  
                  <div className="space-y-3 flex-1">
                    <AnimatePresence mode="popLayout">
                      {history.length > 0 ? (
                        history.map((trade) => (
                          <motion.div
                            key={trade.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between group hover:border-blue-500/30 transition-all"
                          >
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-8 h-8 rounded-lg flex items-center justify-center",
                                trade.profit && trade.profit > 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                              )}>
                                {trade.profit && trade.profit > 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                              </div>
                              <div>
                                <p className="text-xs font-bold truncate max-w-[80px]">{trade.symbol}</p>
                                <p className="text-[9px] text-muted-foreground">
                                  {new Date(trade.time).toLocaleTimeString()}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={cn(
                                "text-xs font-black",
                                trade.profit && trade.profit > 0 ? "text-green-400" : "text-red-400"
                              )}>
                                {trade.profit && trade.profit > 0 ? "+" : ""}${trade.profit?.toFixed(2)}
                              </p>
                              <Badge variant="outline" className={cn(
                                "text-[8px] py-0 h-3 uppercase",
                                trade.profit && trade.profit > 0 ? "border-green-500/30 text-green-400" : "border-red-500/30 text-red-400"
                              )}>
                                {trade.profit && trade.profit > 0 ? "WON" : "LOSS"}
                              </Badge>
                            </div>
                          </motion.div>
                        ))
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-20 py-20">
                          <Activity className="w-12 h-12 mb-2" />
                          <p className="text-xs uppercase font-bold">Sem operações</p>
                        </div>
                      )}
                    </AnimatePresence>
                  </div>

                  <Button 
                    variant="ghost" 
                    onClick={() => setActiveTab("Histórico")}
                    className="w-full mt-4 text-[10px] text-muted-foreground hover:text-blue-400 uppercase font-bold"
                  >
                    Relatório Completo
                  </Button>
                </NeonCard>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  </main>
</div>
  );
}
