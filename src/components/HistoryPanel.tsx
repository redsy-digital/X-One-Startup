import React, { useState, useEffect } from "react";
import { 
  History, 
  Trash2, 
  Download, 
  TrendingUp, 
  TrendingDown, 
  CheckCircle2, 
  XCircle,
  Filter,
  ArrowRight
} from "lucide-react";
import { getTradeHistory, clearTradeHistory, exportToPDF } from "../lib/storage";
import { TradeHistory } from "../types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NeonCard } from "./NeonCard";
import { cn } from "../lib/utils";
import { motion, AnimatePresence } from "motion/react";

export const HistoryPanel = () => {
  const [history, setHistory] = useState<TradeHistory[]>([]);
  const [filterResult, setFilterResult] = useState<"ALL" | "WON" | "LOST">("ALL");
  const [filterType, setFilterType] = useState<"ALL" | "CALL" | "PUT">("ALL");

  const loadHistory = () => {
    setHistory(getTradeHistory());
  };

  useEffect(() => {
    loadHistory();
    const handleUpdate = () => loadHistory();
    window.addEventListener("trade_history_updated", handleUpdate);
    return () => window.removeEventListener("trade_history_updated", handleUpdate);
  }, []);

  const filteredHistory = history.filter(trade => {
    const resultMatch = filterResult === "ALL" || trade.status === filterResult;
    const typeMatch = filterType === "ALL" || trade.type === filterType;
    return resultMatch && typeMatch;
  });

  const stats = {
    total: history.length,
    wins: history.filter(h => h.status === "WON").length,
    losses: history.filter(h => h.status === "LOST").length,
    profit: history.reduce((acc, h) => acc + (h.profit || 0), 0)
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <History className="text-purple-500 w-6 h-6" />
            Histórico Local
          </h2>
          <p className="text-muted-foreground text-sm">Últimos {history.length} trades salvos neste navegador.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => exportToPDF(history)}
            disabled={history.length === 0}
            className="border-white/10 hover:bg-white/5 gap-2"
          >
            <Download className="w-4 h-4" /> Exportar PDF
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => {
              if (confirm("Tem certeza que deseja apagar todo o histórico?")) {
                clearTradeHistory();
              }
            }}
            disabled={history.length === 0}
            className="border-red-500/30 text-red-400 hover:bg-red-500/10 gap-2"
          >
            <Trash2 className="w-4 h-4" /> Limpar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <NeonCard className="p-4 bg-white/5 border-white/10">
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Total Trades</p>
          <p className="text-xl font-black text-white">{stats.total}</p>
        </NeonCard>
        <NeonCard className="p-4 bg-white/5 border-white/10">
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Vitórias</p>
          <p className="text-xl font-black text-green-400">{stats.wins}</p>
        </NeonCard>
        <NeonCard className="p-4 bg-white/5 border-white/10">
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Derrotas</p>
          <p className="text-xl font-black text-red-400">{stats.losses}</p>
        </NeonCard>
        <NeonCard variant="purple" className="p-4 bg-purple-500/10 border-purple-500/20">
          <p className="text-[10px] text-purple-300 uppercase font-bold">Lucro Total</p>
          <p className={cn("text-xl font-black", stats.profit >= 0 ? "text-green-400" : "text-red-400")}>
            ${stats.profit.toFixed(2)}
          </p>
        </NeonCard>
      </div>

      <div className="bg-white/5 rounded-2xl border border-white/10 p-4 sticky top-20 z-40 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-bold uppercase text-muted-foreground">Filtros:</span>
          </div>
          
          <div className="flex gap-1 bg-black/20 p-1 rounded-lg border border-white/5">
            {["ALL", "WON", "LOST"].map(r => (
              <button
                key={r}
                onClick={() => setFilterResult(r as any)}
                className={cn(
                  "px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all",
                  filterResult === r ? "bg-purple-600 text-white" : "text-muted-foreground hover:text-white"
                )}
              >
                {r === "ALL" ? "Todos" : r === "WON" ? "Wins" : "Losses"}
              </button>
            ))}
          </div>

          <div className="flex gap-1 bg-black/20 p-1 rounded-lg border border-white/5">
            {["ALL", "CALL", "PUT"].map(t => (
              <button
                key={t}
                onClick={() => setFilterType(t as any)}
                className={cn(
                  "px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all",
                  filterType === t ? (t === "CALL" ? "bg-green-600 text-white" : "bg-red-600 text-white") : (t === "ALL" ? "bg-purple-600 text-white" : "text-muted-foreground hover:text-white"),
                  filterType !== t && "text-muted-foreground hover:text-white",
                  filterType === "ALL" && t === "ALL" && "bg-blue-600"
                )}
              >
                {t === "ALL" ? "Direções" : t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {filteredHistory.map((trade) => (
            <motion.div
              layout
              key={trade.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#111114] border border-white/10 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 group hover:border-white/20 transition-all hover:shadow-lg hover:shadow-purple-500/5"
            >
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                  trade.type === "CALL" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                )}>
                  {trade.type === "CALL" ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white tracking-tight">{trade.symbol}</span>
                    <Badge variant="outline" className="text-[8px] uppercase">{trade.type}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{new Date(trade.time).toLocaleString()}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 md:gap-8">
                <div className="text-center md:text-left">
                  <p className="text-[8px] text-muted-foreground uppercase font-bold">Investimento</p>
                  <p className="text-sm font-bold text-white">${trade.stake.toFixed(2)}</p>
                </div>
                
                <div className="text-center md:text-left">
                  <p className="text-[8px] text-muted-foreground uppercase font-bold">Confiança</p>
                  <p className="text-sm font-bold text-blue-400">{trade.confidence || 0}%</p>
                </div>

                <div className="text-center md:text-left">
                  <p className="text-[8px] text-muted-foreground uppercase font-bold">Resultado</p>
                  <div className={cn(
                    "flex items-center gap-1 font-black text-sm",
                    trade.status === "WON" ? "text-green-400" : trade.status === "LOST" ? "text-red-400" : "text-yellow-400"
                  )}>
                    {trade.status === "WON" ? <CheckCircle2 className="w-4 h-4" /> : trade.status === "LOST" ? <XCircle className="w-4 h-4" /> : null}
                    {trade.status === "WON" ? `+$${(trade.profit || 0).toFixed(2)}` : trade.status === "LOST" ? `-$${Math.abs(trade.profit || 0).toFixed(2)}` : "PENDENTE"}
                  </div>
                </div>

                {trade.entryPrice && trade.exitPrice && (
                  <div className="hidden lg:flex flex-col items-center gap-1 bg-white/5 px-3 py-1 rounded-lg border border-white/5">
                    <div className="flex items-center gap-2 text-[9px] font-mono">
                      <span className="text-muted-foreground">{trade.entryPrice}</span>
                      <ArrowRight className="w-2 h-2 text-muted-foreground" />
                      <span className="text-white">{trade.exitPrice}</span>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {filteredHistory.length === 0 && (
          <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-3xl">
            <History className="w-12 h-12 text-white/10 mx-auto mb-4" />
            <p className="text-muted-foreground">Nenhuma operação encontrada com os filtros selecionados.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const Badge = ({ children, variant, className }: any) => (
  <span className={cn(
    "px-1.5 py-0.5 rounded text-[10px] font-bold border",
    variant === "outline" ? "border-white/10 text-muted-foreground" : "bg-purple-600 text-white",
    className
  )}>
    {children}
  </span>
);
