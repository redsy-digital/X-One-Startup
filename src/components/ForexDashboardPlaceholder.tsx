import React from "react";
import { Construction, ArrowLeft, Radio, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { useMarketStore } from "../store";
import { derivService } from "../lib/deriv";

// Fase 2 do plano multi-mercado: descoberta e feed Forex reais, sem execução.
// O motor de decisão de Forex (indicadores, estrutura, macro, risco) é
// construído nas fases seguintes — ver forex_ux_architecture.md e
// forex_feature_inventory.md para o plano completo. Este placeholder
// existe para o tema/fluxo poderem ser testados já, sem fingir que há
// negociação real a acontecer.
export const ForexDashboardPlaceholder = () => {
  const { setMarket, symbol, ticks, candles } = useMarketStore();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [symbolInfo, setSymbolInfo] = React.useState<any | null>(null);
  const [contracts, setContracts] = React.useState<string[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError(null);
      try {
        const symbols = await derivService.getActiveSymbols(["CALL", "PUT"]);
        const info = symbols.find((item: any) => item.underlying_symbol === "frxEURUSD");
        if (!info) throw new Error("frxEURUSD não foi devolvido pela New API em active_symbols.");
        const contractData = await derivService.getContractsFor("frxEURUSD");
        if (cancelled) return;
        setSymbolInfo(info);
        setContracts((contractData.available ?? []).map((c: any) => c.contract_type).filter(Boolean));
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Não foi possível validar o Forex na New API.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (derivService.isSocketOpen()) load();
    else { setLoading(false); setError("A ligação WebSocket da Deriv ainda não está pronta."); }
    return () => { cancelled = true; };
  }, [symbol]);

  const lastPrice = ticks.length ? ticks[ticks.length - 1].price : candles.length ? candles[candles.length - 1].close : null;

  return (
    <div className="min-h-[70vh] flex flex-col gap-6 px-4 py-8 text-center">
      <div className="space-y-2 max-w-xl mx-auto">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
          {loading ? <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" /> : <Radio className="w-8 h-8 text-emerald-400" />}
        </div>
        <p className="text-base font-black uppercase tracking-wide text-emerald-400">Forex — Fase 2: dados reais</p>
        <p className="text-[12px] text-muted-foreground">O X-ONE está a validar <span className="text-white font-bold">frxEURUSD</span> directamente pela New API da Deriv. Ainda não existe motor de decisão nem execução Forex.</p>
      </div>

      <div className="w-full max-w-xl mx-auto grid grid-cols-2 gap-3 text-left">
        {[["Símbolo", symbolInfo?.underlying_symbol ?? symbol, symbolInfo?.underlying_symbol_name ?? "EUR/USD"], ["Preço", lastPrice == null ? "—" : String(lastPrice), `ticks recebidos: ${ticks.length}`], ["Pip size", symbolInfo?.pip_size ?? "—", "New API: pip_size"], ["Mercado", symbolInfo ? (symbolInfo.exchange_is_open ? "ABERTO" : "FECHADO") : "—", `candles carregados: ${candles.length}`]].map(([title, value, sub]) => (
          <div key={title} className="rounded-2xl border border-emerald-500/20 bg-black/30 p-4">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{title}</p>
            <p className="mt-1 text-sm font-black text-white">{value}</p>
            <p className="text-[10px] text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      <div className="w-full max-w-xl mx-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-white">contracts_for</p>
          {!error && !loading ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{loading ? "A consultar a New API…" : error ? error : contracts.length ? contracts.join(" · ") : "Nenhum contrato devolvido"}</p>
        {symbolInfo && <p className="mt-2 text-[9px] text-muted-foreground/60">Fonte: active_symbols → underlying_symbol / underlying_symbol_name / pip_size. Não são campos Legacy.</p>}
      </div>

      <div className="flex flex-col sm:flex-row justify-center gap-3">
        <button onClick={() => window.location.reload()} className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-emerald-500/30 text-emerald-400 text-[11px] font-black uppercase tracking-wide hover:bg-emerald-500/10 transition-colors"><RefreshCw className="w-3.5 h-3.5" /> Actualizar dados</button>
        <button onClick={() => setMarket(null)} className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-white/10 text-muted-foreground text-[11px] font-black uppercase tracking-wide hover:bg-white/5 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> Escolher outro mercado</button>
      </div>
    </div>
  );
};
