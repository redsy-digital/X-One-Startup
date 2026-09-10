import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { X, Plus, CircleDot, TrendingUp } from "lucide-react";
import { cn } from "../lib/utils";
import { useSyntheticTabsStore } from "../store/useSyntheticTabsStore";
import { useBotStore } from "../store";
import { ChooseTabTypeModal } from "./CreateSyntheticTabScreen";

const TAB_ICON: Record<string, React.ReactNode> = {
  digits: <CircleDot className="w-3.5 h-3.5" />,
  accumulators: <TrendingUp className="w-3.5 h-3.5" />,
};

/** Barra horizontal de abas de operação para Índices Sintéticos. Permite
 * alternar rapidamente entre abas, fechá-las e criar novas — nunca mistura
 * Digits e Accumulators no mesmo dashboard. */
export const SyntheticTabsBar = () => {
  const { tabs, activeTabId, runningTabId, setActiveTab, closeTab, setRunningTab } = useSyntheticTabsStore();
  const { isBotRunning, setIsBotRunning } = useBotStore();
  const [showChooser, setShowChooser] = React.useState(false);

  const handleClose = (id: string) => {
    // Se a aba a fechar é a que está a operar, pára o bot primeiro — nunca
    // deixamos uma execução "órfã" sem aba para a controlar.
    if (runningTabId === id && isBotRunning) {
      setIsBotRunning(false);
      setRunningTab(null);
    }
    closeTab(id);
  };

  return (
    <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1"
      style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(124,58,237,0.3) transparent" }}>
      <AnimatePresence initial={false}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isRunning = tab.id === runningTabId && isBotRunning;
          return (
            <motion.div
              key={tab.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={cn(
                "shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-all duration-200 select-none",
                isActive
                  ? "bg-purple-500/15 border-purple-500/50 text-white"
                  : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10 hover:text-white"
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className={cn(isActive ? "text-purple-400" : "text-muted-foreground")}>{TAB_ICON[tab.type]}</span>
              <span className="text-[11px] font-black uppercase tracking-wide whitespace-nowrap">{tab.label}</span>
              {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />}
              <button
                onClick={(e) => { e.stopPropagation(); handleClose(tab.id); }}
                title={isRunning ? "Fechar aba (para o bot)" : "Fechar aba"}
                className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center hover:bg-white/15 text-muted-foreground hover:text-white transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>

      <button
        onClick={() => setShowChooser(true)}
        title="Criar nova aba de operação"
        className="shrink-0 w-9 h-9 rounded-xl border border-dashed border-white/15 text-muted-foreground hover:text-purple-400 hover:border-purple-500/40 flex items-center justify-center transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {showChooser && <ChooseTabTypeModal onClose={() => setShowChooser(false)} />}
      </AnimatePresence>
    </div>
  );
};
