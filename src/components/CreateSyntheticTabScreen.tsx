import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { LayoutGrid, CircleDot, TrendingUp, X } from "lucide-react";
import { cn } from "../lib/utils";
import { NeonCard } from "./NeonCard";
import { Button } from "./ui/button";
import { useSyntheticTabsStore, type SyntheticTabType } from "../store/useSyntheticTabsStore";

const TAB_TYPE_OPTIONS: Array<{
  type: SyntheticTabType;
  title: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
}> = [
  {
    type: "digits",
    title: "Digits",
    description: "Entrada determinística sobre o último dígito. Sem indicadores nem previsão.",
    icon: <CircleDot className="w-6 h-6" />,
    accent: "purple",
  },
  {
    type: "accumulators",
    title: "Accumulators",
    description: "Entrada fixa com Growth Rate por tick. Fecho automático por contagem de ticks.",
    icon: <TrendingUp className="w-6 h-6" />,
    accent: "blue",
  },
];

/** Modal de escolha do tipo de aba — reutilizado tanto pelo ecrã "sem abas"
 * como pelo botão "+" na barra de abas quando já existem abas abertas. */
export const ChooseTabTypeModal = ({ onClose }: { onClose: () => void }) => {
  const { addTab } = useSyntheticTabsStore();

  const handleChoose = (type: SyntheticTabType) => {
    addTab(type);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-[#111114] border border-purple-500/20 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <p className="font-black text-sm uppercase tracking-widest flex items-center gap-2 text-white">
            <LayoutGrid className="w-4 h-4 text-purple-400" /> Nova aba de operação
          </p>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground"><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-5 space-y-3">
          {TAB_TYPE_OPTIONS.map((option) => (
            <button
              key={option.type}
              onClick={() => handleChoose(option.type)}
              className={cn(
                "w-full text-left p-4 rounded-xl border transition-all duration-200 flex items-start gap-3",
                option.accent === "purple"
                  ? "border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/15 hover:border-purple-500/50"
                  : "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/15 hover:border-blue-500/50"
              )}
            >
              <div className={cn("shrink-0", option.accent === "purple" ? "text-purple-400" : "text-blue-400")}>
                {option.icon}
              </div>
              <div>
                <p className="text-sm font-black text-white uppercase tracking-wide">{option.title}</p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{option.description}</p>
              </div>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

/** Ecrã mostrado quando não há nenhuma aba de operação aberta para Índices
 * Sintéticos. Depois de criar uma aba, o DashboardPage passa a mostrar a
 * SyntheticTabsBar + o dashboard correspondente ao tipo escolhido. */
export const CreateSyntheticTabScreen = () => {
  const [showChooser, setShowChooser] = React.useState(false);

  return (
    <>
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-6 px-4 py-8">
        <NeonCard variant="purple" className="p-8 max-w-md w-full text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto">
            <LayoutGrid className="w-7 h-7 text-purple-400" />
          </div>
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-white">Sem abas de operação</p>
            <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
              Cria uma aba para começar a operar. Cada aba tem o seu próprio dashboard —
              Digits e Accumulators nunca partilham a mesma aba.
            </p>
          </div>
          <Button
            onClick={() => setShowChooser(true)}
            className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 font-black uppercase tracking-widest"
          >
            Criar Aba de Operação
          </Button>
        </NeonCard>
      </div>

      <AnimatePresence>
        {showChooser && <ChooseTabTypeModal onClose={() => setShowChooser(false)} />}
      </AnimatePresence>
    </>
  );
};
