import React, { useState } from "react";
import { Plus, X, CircleDot, Layers3, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../lib/utils";
import { useSyntheticTabsStore, type SyntheticOperationKind } from "../synthetic/tabs";
import { useBotStore } from "../store/useBotStore";
import { useMarketStore } from "../store/useMarketStore";

const kindLabel = (kind: SyntheticOperationKind) => kind === "digits" ? "Digits" : "Accumulators";

export const SyntheticOperationTabs = () => {
  const { tabs, activeTabId, runningTabId, setActiveTab, closeTab, createTab } = useSyntheticTabsStore();
  const { isBotRunning } = useBotStore();
  const { setMarket } = useMarketStore();
  const [adding, setAdding] = useState(false);

  const create = (kind: SyntheticOperationKind) => {
    createTab(kind);
    setAdding(false);
  };

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 p-1.5 overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const running = tab.id === runningTabId && isBotRunning;
          return (
            <div key={tab.id} className={cn("flex items-center shrink-0 rounded-lg border transition-all", active ? "border-purple-500/40 bg-purple-500/15" : "border-transparent bg-white/5 hover:bg-white/10")}>
              <button
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase whitespace-nowrap"
              >
                {tab.kind === "digits" ? <CircleDot className="w-3.5 h-3.5 text-purple-400" /> : <Layers3 className="w-3.5 h-3.5 text-cyan-400" />}
                <span>{tab.name}</span>
                {running && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
              </button>
              <button
                type="button"
                onClick={() => closeTab(tab.id)}
                disabled={running}
                title={running ? "Pára o bot antes de fechar esta aba" : "Fechar aba"}
                className="p-1.5 mr-1 rounded-md text-muted-foreground hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:cursor-not-allowed"
                aria-label={`Fechar ${tab.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
        <button type="button" onClick={() => setAdding((v) => !v)} className="h-8 w-8 shrink-0 rounded-lg border border-dashed border-purple-500/30 text-purple-400 flex items-center justify-center hover:bg-purple-500/10" title="Nova aba">
          <Plus className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => !isBotRunning && setMarket(null)} disabled={isBotRunning} className="h-8 w-8 shrink-0 rounded-lg border border-white/10 text-muted-foreground flex items-center justify-center hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed" title={isBotRunning ? "Pára o bot antes de voltar aos mercados" : "Voltar à escolha de mercado"} aria-label="Voltar à escolha de mercado">
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="mt-2 flex gap-2">
            <button type="button" onClick={() => create("digits")} className="flex-1 rounded-xl border border-purple-500/30 bg-purple-500/10 px-3 py-2.5 text-left hover:bg-purple-500/15">
              <span className="text-[10px] font-black uppercase text-purple-300">Digits</span>
              <span className="block text-[9px] text-muted-foreground mt-0.5">Operação de dígitos</span>
            </button>
            <button type="button" onClick={() => create("accumulators")} className="flex-1 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2.5 text-left hover:bg-cyan-500/15">
              <span className="text-[10px] font-black uppercase text-cyan-300">Accumulators</span>
              <span className="block text-[9px] text-muted-foreground mt-0.5">Crescimento por tick</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const NoSyntheticTabs = () => {
  const { createTab } = useSyntheticTabsStore();
  const { setMarket } = useMarketStore();
  const { isBotRunning } = useBotStore();
  const [choosing, setChoosing] = useState(false);
  return (
    <div className="min-h-[68vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-2xl border border-purple-500/30 bg-purple-500/10 flex items-center justify-center">
          <Layers3 className="w-7 h-7 text-purple-400" />
        </div>
        <div>
          <h2 className="text-xl font-black uppercase tracking-widest text-white">Sem abas de operação</h2>
          <p className="text-[10px] text-muted-foreground mt-2">Cria uma aba para iniciar uma operação de Índices Sintéticos.</p>
        </div>
        {!choosing ? (
          <div className="flex flex-col items-center gap-2">
            <button type="button" onClick={() => setChoosing(true)} className="mx-auto h-12 px-6 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black uppercase tracking-widest text-[10px] shadow-lg shadow-purple-500/20">
              Criar Aba de Operação
            </button>
            <button type="button" onClick={() => !isBotRunning && setMarket(null)} disabled={isBotRunning} className="mx-auto h-10 px-5 rounded-xl border border-white/10 text-muted-foreground hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed text-[9px] font-black uppercase tracking-widest">
              Voltar à escolha de mercado
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => createTab("digits")} className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4 text-left hover:bg-purple-500/15">
              <CircleDot className="w-5 h-5 text-purple-400 mb-3" />
              <p className="text-[11px] font-black text-white uppercase">Digits</p>
              <p className="text-[9px] text-muted-foreground mt-1">Contratos de último dígito.</p>
            </button>
            <button type="button" onClick={() => createTab("accumulators")} className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-left hover:bg-cyan-500/15">
              <Layers3 className="w-5 h-5 text-cyan-400 mb-3" />
              <p className="text-[11px] font-black text-white uppercase">Accumulators</p>
              <p className="text-[9px] text-muted-foreground mt-1">Crescimento por tick.</p>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
