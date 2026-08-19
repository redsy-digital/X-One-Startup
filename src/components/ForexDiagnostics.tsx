import React, { useState, useCallback, useEffect, useRef } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { derivService } from "../lib/deriv";

interface ContractInfo {
  contract_type: string;
  min_contract_duration?: string;
  max_contract_duration?: string;
  barrier_category?: string;
}

// Fase 2 do plano multi-mercado. Chama contracts_for + active_symbols ao
// vivo para frxEURUSD — é a única forma fiável de confirmar duração
// mínima/máxima real e nome exacto do par, em vez de assumir a partir da
// documentação genérica da Deriv (ver forex_ux_architecture.md, pergunta 1).
// Mostra sempre o JSON bruto ao lado do resumo — os nomes exactos dos
// campos não foram testados ao vivo antes desta sessão, por isso prefiro
// não esconder nada caso o resumo interprete algum campo incorrectamente.
export const ForexDiagnostics = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contracts, setContracts] = useState<ContractInfo[]>([]);
  const [symbolInfo, setSymbolInfo] = useState<any | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [rawContractsFor, setRawContractsFor] = useState<any | null>(null);
  const gotContractsRef = useRef(false);
  const gotSymbolsRef = useRef(false);

  useEffect(() => {
    const unsubContracts = derivService.on("contracts_for", (data: any) => {
      gotContractsRef.current = true;
      if (data.error) { setError(data.error.message); setLoading(false); return; }
      const cf = data.contracts_for;
      setRawContractsFor(cf);
      const list: ContractInfo[] = (cf?.available || []).map((c: any) => ({
        contract_type: c.contract_type,
        min_contract_duration: c.min_contract_duration,
        max_contract_duration: c.max_contract_duration,
        barrier_category: c.barrier_category,
      }));
      setContracts(list);
      setLoading(false);
    });

    const unsubSymbols = derivService.on("active_symbols", (data: any) => {
      gotSymbolsRef.current = true;
      if (data.error) return; // não crítico — contracts_for já dá o essencial
      const found = (data.active_symbols || []).find((s: any) => s.symbol === "frxEURUSD");
      if (found) setSymbolInfo(found);
    });

    const unsubTick = derivService.on("tick", (data: any) => {
      if (data.tick?.symbol === "frxEURUSD") setLivePrice(data.tick.quote);
    });

    return () => { unsubContracts(); unsubSymbols(); unsubTick(); };
  }, []);

  const runCheck = useCallback(() => {
    if (!derivService.isSocketOpen()) {
      setError("Sem ligação activa à Deriv — liga a conta primeiro (mesmo fluxo dos Índices Sintéticos).");
      return;
    }
    setLoading(true);
    setError(null);
    gotContractsRef.current = false;
    gotSymbolsRef.current = false;
    derivService.getContractsFor("frxEURUSD");
    derivService.getActiveSymbols();
    derivService.subscribeTicks("frxEURUSD");

    setTimeout(() => {
      if (!gotContractsRef.current) {
        setLoading(false);
        setError("Sem resposta da Deriv em 8s — tenta novamente.");
      }
    }, 8000);
  }, []);

  return (
    <div className="w-full max-w-md p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 space-y-3 text-left">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
          Fase 2 — Confirmar dados reais (frxEURUSD)
        </p>
        <button
          onClick={runCheck}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-400 text-[9px] font-black uppercase hover:bg-emerald-500/10 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={loading ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
          {loading ? "A verificar..." : "Verificar"}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-red-300">{error}</p>
        </div>
      )}

      {symbolInfo && (
        <div className="text-[10px] text-emerald-200/80 space-y-0.5">
          <p><span className="text-muted-foreground">Nome:</span> {symbolInfo.display_name}</p>
          <p><span className="text-muted-foreground">Pip size:</span> {symbolInfo.pip}</p>
          <p><span className="text-muted-foreground">Mercado/submercado:</span> {symbolInfo.market}/{symbolInfo.submarket}</p>
        </div>
      )}

      {livePrice !== null && (
        <p className="text-[10px] text-emerald-200/80">
          <span className="text-muted-foreground">Preço ao vivo:</span>{" "}
          <span className="font-mono font-bold text-emerald-300">{livePrice}</span>{" "}
          <CheckCircle2 className="w-3 h-3 inline text-emerald-400" /> ligação de dados confirmada
        </p>
      )}

      {contracts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-black uppercase text-muted-foreground">Tipos de contrato disponíveis</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {contracts.map((c, i) => (
              <div key={i} className="flex justify-between text-[9px] px-2 py-1 rounded bg-black/30 border border-white/5">
                <span className="text-emerald-300 font-bold">{c.contract_type}</span>
                <span className="text-muted-foreground">
                  {c.min_contract_duration || "?"} — {c.max_contract_duration || "?"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rawContractsFor && (
        <details className="text-[9px]">
          <summary className="cursor-pointer text-muted-foreground/60 uppercase font-black">
            Ver JSON bruto (contracts_for)
          </summary>
          <pre className="mt-1.5 p-2 rounded bg-black/40 overflow-x-auto text-emerald-200/70 max-h-48 overflow-y-auto">
            {JSON.stringify(rawContractsFor, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};
