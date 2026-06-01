import React, { useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Activity, ArrowUpRight, ArrowDownRight, Clock } from "lucide-react";
import { NeonCard } from "../components/NeonCard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { TradingChart } from "../components/TradingChart";
import { BotControls } from "../components/BotControls";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SYMBOLS } from "../constants";
import { useConnectionStore, useBotStore, useMarketStore, useHistoryStore, useSettingsStore } from "../store";
import { useNavigate } from "react-router-dom";

export const DashboardPage = () => {
  const navigate = useNavigate();
  const { isAuthorized, activeAccount } = useConnectionStore();
  const { isBotRunning } = useBotStore();
  const { symbol, candles, ticks } = useMarketStore();
  const { history, loadHistory } = useHistoryStore();
  const { loadSettings } = useSettingsStore();

  useEffect(() => {
    loadHistory().catch(console.error);
    loadSettings();
  }, []);

  // Se não tem Deriv conectado, redireciona para home
  useEffect(() => {
    if (!isAuthorized && !activeAccount) {
      navigate("/");
    }
  }, [isAuthorized, activeAccount]);

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

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NeonCard variant="purple" className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Ativo</p>
          <div className="flex items-end justify-between">
            <h2 className="text-sm md:text-lg font-black tracking-tight truncate">
              {SYMBOLS.find(s => s.value === symbol)?.label || "Synthetic"}
            </h2>
            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/50 text-[8px]">LIVE</Badge>
          </div>
        </NeonCard>

        <NeonCard variant={isUp ? "cyan" : "pink"} className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Preço</p>
          <div className="flex items-center gap-1">
            <span className={cn("text-sm md:text-xl font-black tracking-tighter",
              isUp ? "text-cyan-400" : "text-pink-400")}>
              {currentPrice ? currentPrice.toFixed(2) : "---"}
            </span>
            {isUp ? <ArrowUpRight className="text-cyan-400 w-4 h-4" /> : <ArrowDownRight className="text-pink-400 w-4 h-4" />}
          </div>
        </NeonCard>

        <NeonCard variant="blue" className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Lucro</p>
          <h2 className={cn("text-sm md:text-xl font-black tracking-tighter",
            stats.totalProfit >= 0 ? "text-blue-400" : "text-red-400")}>
            {stats.totalProfit >= 0 ? "+" : ""}${stats.totalProfit.toFixed(2)}
          </h2>
        </NeonCard>

        <NeonCard variant="purple" className="p-3 md:p-4 flex flex-col justify-between h-24 md:h-32">
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Assertividade</p>
          <div className="flex items-end justify-between">
            <h2 className="text-sm md:text-xl font-black tracking-tighter text-purple-400">{stats.winRate}%</h2>
            <div className="hidden md:flex gap-1">
              {history.slice(0, 5).map((h, i) => (
                <div key={i} className={cn("w-2 h-2 rounded-full",
                  h.status === "WON" ? "bg-green-500" : "bg-red-500")} />
              ))}
            </div>
          </div>
        </NeonCard>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart + BotControls */}
        <div className="lg:col-span-2 space-y-6">
          <NeonCard variant="purple" className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-500" />
                <h3 className="font-bold uppercase tracking-widest text-[10px] md:text-sm">Market Analysis</h3>
              </div>
              <Badge variant="outline" className="border-purple-500/50 text-purple-400 text-[8px]">REAL-TIME</Badge>
            </div>
            <ErrorBoundary fallbackLabel="Erro no Gráfico">
              <TradingChart candles={candles} symbol={symbol} />
            </ErrorBoundary>
          </NeonCard>

          <ErrorBoundary fallbackLabel="Erro nos Controlos do Bot">
            <BotControls />
          </ErrorBoundary>
        </div>

        {/* Sidebar: Recent history */}
        <NeonCard variant="blue" className="p-4 flex flex-col min-h-[300px]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold uppercase tracking-widest text-[10px] flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" /> Histórico
            </h3>
          </div>
          <div className="space-y-2 flex-1 overflow-y-auto">
            <AnimatePresence mode="popLayout">
              {history.length > 0 ? history.slice(0, 10).map(trade => (
                <motion.div key={trade.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between hover:border-blue-500/30 transition-all">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center",
                      trade.profit && trade.profit > 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
                      {trade.profit && trade.profit > 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                    </div>
                    <div>
                      <p className="text-[10px] font-bold truncate max-w-[70px]">{trade.symbol}</p>
                      <p className="text-[8px] text-muted-foreground">{new Date(trade.time).toLocaleTimeString()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-[10px] font-black",
                      trade.profit && trade.profit > 0 ? "text-green-400" : "text-red-400")}>
                      {trade.profit && trade.profit > 0 ? "+" : ""}${trade.profit?.toFixed(2)}
                    </p>
                  </div>
                </motion.div>
              )) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-20 py-16">
                  <Activity className="w-10 h-10 mb-2" />
                  <p className="text-xs uppercase font-bold">Sem operações</p>
                </div>
              )}
            </AnimatePresence>
          </div>
          <Button variant="ghost" onClick={() => navigate("/historico")}
            className="w-full mt-3 text-[10px] text-muted-foreground hover:text-blue-400 uppercase font-bold">
            Relatório Completo
          </Button>
        </NeonCard>
      </div>
    </div>
  );
};
