import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { cn } from "../lib/utils";
import { useConnectionStore } from "../store";
import { Wifi, WifiOff } from "lucide-react";

// ── Card de navegação (imagem clicável) ───────────────────────────────────────
interface NavCardProps {
  image: string;
  label: string;
  onClick: () => void;
  delay?: number;
  external?: boolean;
}

const NavCard = ({ image, label, onClick, delay = 0, external }: NavCardProps) => (
  <motion.button
    initial={{ opacity: 0, y: 30 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.3 + delay, duration: 0.5, ease: "easeOut" }}
    whileTap={{ scale: 0.97 }}
    onClick={onClick}
    className="relative shrink-0 w-[72vw] max-w-[280px] rounded-2xl overflow-hidden cursor-pointer group"
    style={{
      boxShadow: "0 0 30px rgba(124, 58, 237, 0.3), 0 0 60px rgba(59, 130, 246, 0.1)",
    }}
  >
    {/* Imagem */}
    <img
      src={image}
      alt={label}
      className="w-full aspect-[3/4] object-cover transition-transform duration-500 group-hover:scale-105"
      draggable={false}
    />

    {/* Overlay glow no hover */}
    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

    {/* Border neon */}
    <div className="absolute inset-0 rounded-2xl border border-purple-500/30 group-hover:border-blue-400/60 transition-colors duration-300" />

    {/* External indicator */}
    {external && (
      <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-green-400 animate-pulse" />
    )}
  </motion.button>
);

// ── HomePage ──────────────────────────────────────────────────────────────────
export const HomePage = () => {
  const navigate = useNavigate();
  const { isAuthorized, activeAccount } = useConnectionStore();
  const derivConnected = isAuthorized && !!activeAccount;

  const handleOperar = () => {
    if (!derivConnected) {
      navigate("/dashboard"); // abre dashboard que vai pedir conexão Deriv
    } else {
      navigate("/dashboard");
    }
  };

  const handleCriarConta = () => {
    window.open(
      "https://partner-tracking.deriv.com/click?a=17770&o=1&c=4&link_id=1",
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <div
      className="min-h-screen bg-[#0a0a0c] relative overflow-hidden"
      style={{
        background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(124,58,237,0.15) 0%, transparent 70%), #0a0a0c",
      }}
    >
      {/* Matrix rain lines (decorativo) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="absolute top-0 text-[10px] font-mono text-purple-500/10 animate-pulse leading-tight"
            style={{
              left: `${i * 8.5 + 2}%`,
              animationDelay: `${i * 0.3}s`,
              animationDuration: `${2 + i * 0.2}s`,
            }}
          >
            {Array.from({ length: 30 }, () => Math.round(Math.random())).join("\n")}
          </div>
        ))}
      </div>

      <div className="relative z-10 flex flex-col min-h-screen px-5 pt-8 pb-10">

        {/* ── Header: logo + status Deriv ── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-8"
        >
          <div>
            <h1
              className="text-3xl font-black tracking-tighter"
              style={{ textShadow: "0 0 20px rgba(124,58,237,0.8), 0 0 40px rgba(59,130,246,0.4)" }}
            >
              X<span className="text-blue-400">-</span>ONE
            </h1>
            <p className="text-[9px] text-muted-foreground uppercase tracking-[0.3em] font-bold">
              Intelligence Trading Bot
            </p>
          </div>

          {/* Badge de status Deriv */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            onClick={() => !derivConnected && navigate("/dashboard")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase cursor-pointer transition-all",
              derivConnected
                ? "bg-green-500/10 border-green-500/40 text-green-400"
                : "bg-red-500/10 border-red-500/40 text-red-400 animate-pulse"
            )}
          >
            {derivConnected
              ? <><Wifi className="w-3 h-3" /> Conectado</>
              : <><WifiOff className="w-3 h-3" /> Conectar</>
            }
          </motion.div>
        </motion.div>

        {/* ── Secção do criador: texto + retrato ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="flex items-start gap-5 mb-10"
        >
          {/* Texto */}
          <div className="flex-1 pt-2">
            <motion.p
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="text-[11px] text-purple-400/80 uppercase font-black tracking-widest mb-2"
            >
              Criado por
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 }}
              className="text-2xl font-black tracking-tight text-white leading-tight mb-3"
            >
              Pedro<br />dos Santos
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="text-[11px] text-muted-foreground leading-relaxed"
            >
              Tecnologia de automação inteligente que opera por ti, com algoritmos de análise
              quântica em tempo real.
            </motion.p>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="flex items-center gap-2 mt-4"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">
                Sistema activo
              </span>
            </motion.div>
          </div>

          {/* Retrato — formato rectangular arredondado */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.6, ease: "easeOut" }}
            className="shrink-0 relative"
            style={{ width: "38vw", maxWidth: "160px" }}
          >
            {/* Glow atrás do retrato */}
            <div
              className="absolute inset-0 rounded-[20px] blur-xl"
              style={{
                background: "radial-gradient(ellipse, rgba(124,58,237,0.4) 0%, rgba(59,130,246,0.2) 50%, transparent 70%)",
                transform: "scale(1.15)",
              }}
            />
            {/* Imagem */}
            <img
              src="/images/meu_retrato.png"
              alt="Pedro dos Santos — Criador do X-ONE"
              className="relative z-10 w-full object-cover"
              style={{
                borderRadius: "20px",
                aspectRatio: "3/4",
                objectPosition: "top center",
                boxShadow: "0 0 25px rgba(124,58,237,0.5), 0 0 50px rgba(59,130,246,0.2), inset 0 0 0 1px rgba(124,58,237,0.4)",
              }}
              draggable={false}
            />
            {/* Border neon */}
            <div
              className="absolute inset-0 z-20"
              style={{
                borderRadius: "20px",
                border: "1px solid rgba(124,58,237,0.5)",
                boxShadow: "inset 0 0 20px rgba(124,58,237,0.1)",
              }}
            />
          </motion.div>
        </motion.div>

        {/* ── Título da secção de navegação ── */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-[10px] text-muted-foreground uppercase font-black tracking-[0.25em] mb-4"
        >
          O que queres fazer?
        </motion.p>

        {/* ── Cards de navegação — scroll horizontal ── */}
        <div className="flex-1 flex flex-col justify-center">
          <div
            className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth"
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              WebkitOverflowScrolling: "touch",
              marginLeft: "-20px",
              paddingLeft: "20px",
              marginRight: "-20px",
              paddingRight: "20px",
            }}
          >
            <NavCard
              image="/images/operar.png"
              label="Operar"
              onClick={handleOperar}
              delay={0}
            />
            <NavCard
              image="/images/historico.png"
              label="Histórico"
              onClick={() => navigate("/historico")}
              delay={0.08}
            />
            <NavCard
              image="/images/criar_conta.png"
              label="Criar Conta Deriv"
              onClick={handleCriarConta}
              delay={0.16}
              external
            />
            <NavCard
              image="/images/configuracoes.png"
              label="Configurações"
              onClick={() => navigate("/configuracoes")}
              delay={0.24}
            />
            {/* Spacer final */}
            <div className="shrink-0 w-4" />
          </div>

          {/* Indicador de scroll */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="flex items-center justify-center gap-1.5 mt-3"
          >
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={cn(
                  "h-1 rounded-full transition-all",
                  i === 0 ? "w-4 bg-purple-500" : "w-1.5 bg-white/20"
                )}
              />
            ))}
          </motion.div>
        </div>

        {/* ── Footer ── */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="text-center text-[9px] text-muted-foreground/40 uppercase tracking-widest mt-6 font-bold"
        >
          X-ONE v2.0 · Powered by Quantitative Algorithms
        </motion.p>
      </div>
    </div>
  );
};
