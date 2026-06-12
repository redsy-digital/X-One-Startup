import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Terminal, Trash2, ArrowDown, Filter, FileDown } from "lucide-react";
import { cn } from "../lib/utils";
import { logger, LogEntry, LogLevel } from "../lib/logger";
import { NeonCard } from "./NeonCard";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { jsPDF } from "jspdf";

const LEVEL_CONFIG: Record<LogLevel, { label: string; bg: string; text: string; dot: string }> = {
  system: { label: "SISTEMA", bg: "bg-blue-500/15",    text: "text-blue-400",    dot: "bg-blue-400" },
  signal: { label: "SINAL",   bg: "bg-purple-500/15",  text: "text-purple-400",  dot: "bg-purple-400" },
  block:  { label: "BLOQ",    bg: "bg-amber-500/15",   text: "text-amber-400",   dot: "bg-amber-400" },
  trade:  { label: "TRADE",   bg: "bg-emerald-500/15", text: "text-emerald-400", dot: "bg-emerald-400" },
  risk:   { label: "RISCO",   bg: "bg-orange-500/15",  text: "text-orange-400",  dot: "bg-orange-400" },
  error:  { label: "ERRO",    bg: "bg-red-500/15",     text: "text-red-400",     dot: "bg-red-400" },
};

const ALL_LEVELS: LogLevel[] = ["system", "signal", "block", "trade", "risk", "error"];

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Exportar logs para PDF ────────────────────────────────────────────────────
function exportLogsPDF(entries: LogEntry[]) {
  const doc = new jsPDF();
  const dateStr = new Date().toISOString().split("T")[0];

  doc.setFontSize(18);
  doc.setTextColor(124, 58, 237);
  doc.text("X-ONE IA — Logs de Sessão", 14, 20);

  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Exportado: ${new Date().toLocaleString("pt-PT")}`, 14, 28);
  doc.text(`Total de entradas: ${entries.length}`, 14, 33);

  let y = 42;
  const levelColors: Record<LogLevel, [number, number, number]> = {
    system: [59, 130, 246],
    signal: [124, 58, 237],
    block:  [245, 158, 11],
    trade:  [16, 185, 129],
    risk:   [249, 115, 22],
    error:  [239, 68, 68],
  };

  for (const entry of entries) {
    if (y > 280) { doc.addPage(); y = 15; }

    const [r, g, b] = levelColors[entry.level] || [150, 150, 150];
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(formatTime(entry.time), 14, y);

    doc.setFontSize(7);
    doc.setTextColor(r, g, b);
    doc.text(`[${LEVEL_CONFIG[entry.level].label}]`, 36, y);

    doc.setFontSize(8);
    doc.setTextColor(50);
    const lines = doc.splitTextToSize(entry.message, 145);
    doc.text(lines, 62, y);

    y += Math.max(5, lines.length * 4);
  }

  doc.save(`x-one-logs-${dateStr}.pdf`);
}

// ── LogsPanel ─────────────────────────────────────────────────────────────────
export const LogsPanel = () => {
  const [entries, setEntries] = useState<LogEntry[]>(() => logger.getAll());
  const [activeFilters, setActiveFilters] = useState<Set<LogLevel>>(new Set(ALL_LEVELS));
  const [newActivityCount, setNewActivityCount] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    const unsub = logger.subscribe((entry) => {
      if (!entry) { setEntries([]); setNewActivityCount(0); return; }
      setEntries(prev => [...prev.slice(-299), entry]);
      if (!isAtBottomRef.current) setNewActivityCount(c => c + 1);
    });
    return unsub;
  }, []);

  // Auto-scroll dentro do container — não usa scrollIntoView
  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    if (atBottom) setNewActivityCount(0);
  }, []);

  const scrollToBottom = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setNewActivityCount(0);
    setIsAtBottom(true);
    isAtBottomRef.current = true;
  };

  const toggleFilter = (level: LogLevel) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(level) && next.size === 1) return next;
      next.has(level) ? next.delete(level) : next.add(level);
      return next;
    });
  };

  const filteredEntries = entries.filter(e => activeFilters.has(e.level));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-black uppercase tracking-widest">Logs em Tempo Real</h2>
          <Badge variant="outline" className="border-purple-500/30 text-purple-400 text-[9px]">
            {entries.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* Exportar PDF */}
          <Button variant="ghost" size="sm"
            onClick={() => exportLogsPDF(filteredEntries)}
            disabled={filteredEntries.length === 0}
            className="h-7 text-[10px] text-muted-foreground hover:text-blue-400 uppercase font-bold gap-1">
            <FileDown className="w-3 h-3" /> PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={() => logger.clear()}
            className="h-7 text-[10px] text-muted-foreground hover:text-red-400 uppercase font-bold gap-1">
            <Trash2 className="w-3 h-3" /> Limpar
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <NeonCard variant="purple" className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3 h-3 text-muted-foreground shrink-0" />
          {ALL_LEVELS.map(level => {
            const cfg = LEVEL_CONFIG[level];
            const active = activeFilters.has(level);
            const count = entries.filter(e => e.level === level).length;
            return (
              <button key={level} onClick={() => toggleFilter(level)}
                className={cn("flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-black uppercase transition-all border",
                  active ? `${cfg.bg} ${cfg.text} border-current/30` : "bg-white/5 text-muted-foreground border-white/10 opacity-50")}>
                <div className={cn("w-1.5 h-1.5 rounded-full", active ? cfg.dot : "bg-muted-foreground")} />
                {cfg.label}
                {count > 0 && <span className="opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>
      </NeonCard>

      {/* Lista — Fix scroll: overscrollBehavior contain + scrollTop em vez de scrollIntoView */}
      <NeonCard variant="blue" className="relative overflow-hidden"
        style={{ height: "calc(100vh - 300px)", minHeight: "400px" }}>
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto p-3 space-y-1 font-mono"
                style={{ overscrollBehavior: "contain" }}
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(124,58,237,0.3) transparent",
            overscrollBehavior: "contain",  // ← impede scroll da página
          }}
        >
          {filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-20">
              <Terminal className="w-12 h-12 mb-3" />
              <p className="text-xs uppercase font-bold">Sem entradas</p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {filteredEntries.map(entry => {
                const cfg = LEVEL_CONFIG[entry.level];
                return (
                  <motion.div key={entry.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.15 }}
                    className={cn("flex items-start gap-2 px-2 py-1.5 rounded-lg text-[11px] leading-snug", cfg.bg)}>
                    <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums mt-0.5">
                      {formatTime(entry.time)}
                    </span>
                    <span className={cn("shrink-0 text-[8px] font-black uppercase px-1.5 py-0.5 rounded mt-0.5 border border-current/20", cfg.bg, cfg.text)}>
                      {cfg.label}
                    </span>
                    <span className={cn("flex-1 break-words", cfg.text)}>{entry.message}</span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* Botão nova actividade */}
        <AnimatePresence>
          {!isAtBottom && newActivityCount > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-3 left-1/2 -translate-x-1/2">
              <Button onClick={scrollToBottom} size="sm"
                className="h-7 bg-purple-600/90 hover:bg-purple-700 text-[10px] font-black uppercase gap-1.5 shadow-lg">
                <ArrowDown className="w-3 h-3" />
                {newActivityCount} {newActivityCount === 1 ? "nova" : "novas"}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </NeonCard>
    </div>
  );
};
