import React from "react";
import { motion } from "motion/react";
import { useMarketStore } from "../store";

interface MarketCardProps {
  image: string;
  label: string;
  glowColor: string;
  onClick: () => void;
  delay?: number;
}

const MarketCard = ({ image, label, glowColor, onClick, delay = 0 }: MarketCardProps) => (
  <motion.button
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.5, ease: "easeOut" }}
    whileTap={{ scale: 0.97 }}
    onClick={onClick}
    className="relative w-full max-w-[320px] rounded-2xl overflow-hidden cursor-pointer group"
    style={{ boxShadow: `0 0 30px ${glowColor}, 0 0 60px ${glowColor}` }}
  >
    <img
      src={image}
      alt={label}
      className="w-full aspect-[3/4] object-cover transition-transform duration-500 group-hover:scale-105"
      draggable={false}
    />
    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
    <div className="absolute inset-0 rounded-2xl border-2 border-white/10 group-hover:border-white/30 transition-colors duration-300" />
  </motion.button>
);

// Ecrã mostrado sempre que se entra no Dashboard sem mercado escolhido nesta
// sessão (market === null). De propósito não lembra a última escolha entre
// recarregamentos de página — defaults (stake, risco, duração) são muito
// diferentes entre mercados para arriscar assumir silenciosamente.
export const MarketSelectScreen = () => {
  const { setMarket } = useMarketStore();

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center gap-8 px-4 py-8">
      <div className="text-center space-y-2">
        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
          Escolhe o mercado
        </p>
        <p className="text-[11px] text-muted-foreground/60 max-w-xs mx-auto">
          Cada mercado tem o seu próprio motor, configurações e gestão de risco.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6 items-center">
        <MarketCard
          image="/images/synthetic_index.png"
          label="Índices Sintéticos"
          glowColor="rgba(124, 58, 237, 0.35)"
          onClick={() => setMarket("synthetic")}
          delay={0.1}
        />
        <MarketCard
          image="/images/forex.png"
          label="Forex"
          glowColor="rgba(16, 185, 129, 0.35)"
          onClick={() => setMarket("forex")}
          delay={0.2}
        />
      </div>
    </div>
  );
};
