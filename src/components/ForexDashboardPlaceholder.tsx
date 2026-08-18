import React from "react";
import { Construction, ArrowLeft } from "lucide-react";
import { useMarketStore } from "../store";
import { ForexDiagnostics } from "./ForexDiagnostics";

// Fase 1 (selector + tema) + Fase 2 (diagnóstico de dados reais) do plano
// multi-mercado. O motor de decisão de Forex em si (indicadores, estrutura,
// macro, risco) ainda não existe — ver forex_ux_architecture.md e
// forex_feature_inventory.md para o plano completo. Este placeholder existe
// para o tema/fluxo/dados poderem ser testados já, sem fingir que há
// negociação real a acontecer.
export const ForexDashboardPlaceholder = () => {
  const { setMarket } = useMarketStore();

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center gap-6 px-4 py-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
        <Construction className="w-8 h-8 text-emerald-400" />
      </div>
      <div className="space-y-2 max-w-sm">
        <p className="text-base font-black uppercase tracking-wide text-emerald-400">
          Forex — em construção
        </p>
        <p className="text-[13px] text-muted-foreground">
          O motor de decisão de Forex ainda está a ser construído (estrutura, sessão,
          calendário macro, gestão de risco própria). Por agora, os Índices Sintéticos
          continuam totalmente operacionais.
        </p>
      </div>
      <ForexDiagnostics />

      <button
        onClick={() => setMarket(null)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-500/30 text-emerald-400 text-[11px] font-black uppercase tracking-wide hover:bg-emerald-500/10 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Escolher outro mercado
      </button>
    </div>
  );
};
