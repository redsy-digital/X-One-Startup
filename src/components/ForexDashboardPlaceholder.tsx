import React from "react";
import { ArrowLeft, Radio, RefreshCw, CheckCircle2, AlertTriangle, FlaskConical, Clock3 } from "lucide-react";
import { useMarketStore } from "../store";
import { derivService } from "../lib/deriv";
import { ForexResearchPanel } from "./ForexResearchPanel";
import { forexMarketDataService } from "../forex/market-data";

type ProposalResult = {
  contractType: string;
  duration: number;
  durationUnit: "m";
  amount: number;
  ok: boolean;
  id?: string;
  askPrice?: number | string;
  payout?: number | string;
  spot?: number | string;
  barrier?: string;
  error?: string;
};

// Segunda bateria de validação da Fase 2:
// - confirmar a fronteira de duração em torno dos 15 min;
// - testar o stake mínimo numa duração realmente negociável;
// - descobrir quais offsets relativos funcionam para Higher/Lower.
const DURATION_PROBES = [1, 2, 5, 10, 15, 30, 60, 120];
const DURATION_BOUNDARY_PROBES = [13, 14, 15, 16, 17];
// Higher/Lower: descobrir a primeira duração aceite sem misturar isto
// com a bateria de Rise/Fall. Testamos uma barreira relativa pequena e
// simétrica: +0.00100 para HIGHER e -0.00100 para LOWER.
const HIGHER_LOWER_DURATION_PROBES = [15, 30, 60, 120, 180, 240, 300];
const STAKE_PROBES = [0.10, 0.20, 0.25, 0.30, 0.35, 0.49, 0.50, 0.51, 1.00];
// Fase 2: descoberta e feed Forex reais, sem execução.
// Tudo aqui usa exclusivamente a New API. Proposal apenas consulta preço;
// nenhum buy é enviado nesta fase.
export const ForexDashboardPlaceholder = () => {
  const { setMarket, symbol, ticks, candles } = useMarketStore();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [symbolInfo, setSymbolInfo] = React.useState<any | null>(null);
  const [contractItems, setContractItems] = React.useState<any[]>([]);
  const [probeLoading, setProbeLoading] = React.useState(false);
  const [probeResults, setProbeResults] = React.useState<ProposalResult[]>([]);
  const [probeError, setProbeError] = React.useState<string | null>(null);
  const [tradingTimes, setTradingTimes] = React.useState<any | null>(null);
  const [tradingTimesError, setTradingTimesError] = React.useState<string | null>(null);
  const [tradingTimesLoading, setTradingTimesLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await forexMarketDataService.getSymbolMetadata("frxEURUSD");
      const contractData = await derivService.getContractsFor("frxEURUSD");
      setSymbolInfo({
        underlying_symbol: info.underlyingSymbol,
        underlying_symbol_name: info.name,
        underlying_symbol_type: info.type,
        market: info.market,
        pip_size: info.pipSize,
        exchange_is_open: info.exchangeIsOpen ? 1 : 0,
        is_trading_suspended: info.tradingSuspended ? 1 : 0,
      });
      setContractItems(contractData.available ?? []);
    } catch (e: any) {
      setError(e.message || "Não foi possível validar o Forex na New API.");
    } finally {
      setLoading(false);
    }
  }, []);

  // A New API expõe os horários através de trading_times; contracts_for
  // não deve ser usado para inferir abertura/fecho do mercado. A resposta é
  // hierárquica (market → submarket → símbolo), por isso procuramos
  // recursivamente a entrada frxEURUSD sem assumir um shape Legacy.
  const findSymbolSchedule = React.useCallback((node: any, target: string): any | null => {
    if (!node || typeof node !== "object") return null;
    if (node.underlying_symbol === target || node.symbol === target) return node;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findSymbolSchedule(item, target);
        if (found) return found;
      }
      return null;
    }
    for (const value of Object.values(node)) {
      const found = findSymbolSchedule(value, target);
      if (found) return found;
    }
    return null;
  }, []);

  // A New API retorna os horários dentro de `times`, e não como `open`/`close`
  // diretamente no símbolo. `times.open` e `times.close` são arrays porque
  // um instrumento pode ter mais de uma janela de negociação no dia.
  const normalizeTradingSchedule = React.useCallback((schedule: any) => {
    const times = schedule?.times ?? {};
    const opens = Array.isArray(times?.open) ? times.open.map(String) : (times?.open != null ? [String(times.open)] : []);
    const closes = Array.isArray(times?.close) ? times.close.map(String) : (times?.close != null ? [String(times.close)] : []);
    const settlements = Array.isArray(times?.settlement) ? times.settlement.map(String) : (times?.settlement != null ? [String(times.settlement)] : []);
    return {
      ...schedule,
      displayOpen: opens.join(" · "),
      displayClose: closes.join(" · "),
      displaySettlement: settlements.join(" · "),
      openTimes: opens,
      closeTimes: closes,
    };
  }, []);

  const loadTradingTimes = React.useCallback(async () => {
    if (!derivService.isSocketOpen()) {
      setTradingTimesError("WebSocket da Deriv não está pronto.");
      return;
    }
    setTradingTimesLoading(true);
    setTradingTimesError(null);
    try {
      const normalizedSchedule = await forexMarketDataService.getTradingSchedule("frxEURUSD", "today");
      if (!normalizedSchedule) throw new Error("frxEURUSD não foi encontrado na resposta trading_times da New API.");
      const normalized = {
        ...normalizedSchedule,
        displayOpen: normalizedSchedule.openTimes.join(" · "),
        displayClose: normalizedSchedule.closeTimes.join(" · "),
        displaySettlement: normalizedSchedule.settlementTimes.join(" · "),
      };
      if (!normalized.openTimes.length && !normalized.closeTimes.length) {
        throw new Error("frxEURUSD foi encontrado, mas a resposta trading_times não contém times.open/times.close.");
      }
      setTradingTimes({ schedule: normalized, raw: normalizedSchedule.raw });
    } catch (e: any) {
      setTradingTimes(null);
      setTradingTimesError(e.message || "Não foi possível consultar trading_times.");
    } finally {
      setTradingTimesLoading(false);
    }
  }, [findSymbolSchedule, normalizeTradingSchedule]);


  React.useEffect(() => {
    let cancelled = false;
    if (!derivService.isSocketOpen()) {
      setLoading(false);
      setError("A ligação WebSocket da Deriv ainda não está pronta.");
      return;
    }
    load().catch(() => undefined);
    loadTradingTimes().catch(() => undefined);
    return () => { cancelled = true; void cancelled; };
  }, [load, loadTradingTimes, symbol]);


  const runProposalDiagnostics = async () => {
    if (!derivService.isSocketOpen()) {
      setProbeError("WebSocket da Deriv não está pronto.");
      return;
    }

    setProbeLoading(true);
    setProbeError(null);
    setProbeResults([]);

    const results: ProposalResult[] = [];
    const currency = derivService.getAccountCurrency();

    // 1) Durações reais: CALL/Rise-Fall é usado como contrato de referência.
    for (const duration of DURATION_PROBES) {
      try {
        const proposal = await derivService.probeProposal("frxEURUSD", "CALL", 1, duration, "m", currency);
        results.push({
          contractType: "CALL",
          duration,
          durationUnit: "m",
          amount: 1,
          ok: true,
          id: proposal?.id,
          askPrice: proposal?.ask_price,
          payout: proposal?.payout,
          spot: proposal?.spot,
        });
      } catch (e: any) {
        results.push({ contractType: "CALL", duration, durationUnit: "m", amount: 1, ok: false, error: e.message });
      }
      setProbeResults([...results]);
    }

    // 2) Stake: agora testamos a grelha numa duração válida (15 min).
    // O teste anterior usava 1 min, que a própria Proposal rejeitou por duração.
    for (const amount of STAKE_PROBES) {
      try {
        const proposal = await derivService.probeProposal("frxEURUSD", "CALL", amount, 15, "m", currency);
        results.push({
          contractType: "CALL",
          duration: 15,
          durationUnit: "m",
          amount,
          ok: true,
          id: proposal?.id,
          askPrice: proposal?.ask_price,
          payout: proposal?.payout,
          spot: proposal?.spot,
        });
      } catch (e: any) {
        results.push({ contractType: "CALL", duration: 15, durationUnit: "m", amount, ok: false, error: e.message });
      }
      setProbeResults([...results]);
    }

    // 3) Fronteira de duração: confirmar se 15 min é mesmo o mínimo.
    for (const duration of DURATION_BOUNDARY_PROBES) {
      try {
        const proposal = await derivService.probeProposal("frxEURUSD", "CALL", 1, duration, "m", currency);
        results.push({
          contractType: "CALL",
          duration,
          durationUnit: "m",
          amount: 1,
          ok: true,
          id: proposal?.id,
          askPrice: proposal?.ask_price,
          payout: proposal?.payout,
          spot: proposal?.spot,
        });
      } catch (e: any) {
        results.push({ contractType: "CALL", duration, durationUnit: "m", amount: 1, ok: false, error: e.message });
      }
      setProbeResults([...results]);
    }

    // 4) Higher/Lower: primeiro descobrimos a fronteira de duração.
    // A New API exige uma barreira relativa para contratos < 24h.
    // Não vamos testar várias barreiras ainda: uma barreira válida e simétrica
    // é suficiente para responder à pergunta atual: em que duração o contrato
    // começa a ser aceite? Nenhum BUY é enviado.
    const hasHigher = contractItems.some((c) => c.contract_type === "HIGHER");
    const hasLower = contractItems.some((c) => c.contract_type === "LOWER");
    const hlTypes: ("HIGHER" | "LOWER")[] = [
      ...(hasHigher ? ["HIGHER" as const] : []),
      ...(hasLower ? ["LOWER" as const] : []),
    ];

    for (const type of hlTypes) {
      const barrier = type === "HIGHER" ? "+0.00100" : "-0.00100";
      for (const duration of HIGHER_LOWER_DURATION_PROBES) {
        try {
          const proposal = await derivService.probeProposal("frxEURUSD", type, 1, duration, "m", currency, barrier);
          results.push({
            contractType: type,
            duration,
            durationUnit: "m",
            amount: 1,
            barrier,
            ok: true,
            id: proposal?.id,
            askPrice: proposal?.ask_price,
            payout: proposal?.payout,
            spot: proposal?.spot,
          });
        } catch (e: any) {
          results.push({ contractType: type, duration, durationUnit: "m", amount: 1, barrier, ok: false, error: e.message });
        }
        setProbeResults([...results]);
      }
    }

    setProbeLoading(false);
  };

  const lastPrice = ticks.length ? ticks[ticks.length - 1].price : candles.length ? candles[candles.length - 1].close : null;
  const contracts = [...new Set(contractItems.map((c) => c.contract_type).filter(Boolean))];
  const durationResults = probeResults.filter((r) => r.contractType === "CALL" && r.amount === 1 && DURATION_PROBES.includes(r.duration));
  const stakeResults = probeResults.filter((r) => r.contractType === "CALL" && r.duration === 15 && STAKE_PROBES.includes(r.amount));
  const boundaryResults = probeResults.filter((r) => r.contractType === "CALL" && r.durationUnit === "m" && r.amount === 1 && DURATION_BOUNDARY_PROBES.includes(r.duration));
  const hlResults = probeResults.filter((r) => (r.contractType === "HIGHER" || r.contractType === "LOWER") && !!r.barrier && HIGHER_LOWER_DURATION_PROBES.includes(r.duration));
  const lowestAcceptedStake = stakeResults.filter((r) => r.ok).sort((a, b) => a.amount - b.amount)[0]?.amount;

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
        {[
          ["Símbolo", symbolInfo?.underlying_symbol ?? symbol, symbolInfo?.underlying_symbol_name ?? "EUR/USD"],
          ["Preço", lastPrice == null ? "—" : String(lastPrice), `ticks recebidos: ${ticks.length}`],
          ["Pip size", symbolInfo?.pip_size ?? "—", "New API: pip_size"],
          ["Mercado", symbolInfo ? (symbolInfo.exchange_is_open ? "ABERTO" : "FECHADO") : "—", `candles carregados: ${candles.length}`],
        ].map(([title, value, sub]) => (
          <div key={title} className="rounded-2xl border border-emerald-500/20 bg-black/30 p-4">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{title}</p>
            <p className="mt-1 text-sm font-black text-white">{value}</p>
            <p className="text-[10px] text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      <div className="w-full max-w-xl mx-auto rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 text-left">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Trading Times — New API</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Consulta oficial do horário de negociação de <span className="text-white font-bold">frxEURUSD</span>. Não inferimos abertura/fecho a partir de <code>contracts_for</code>.</p>
          </div>
          <Clock3 className={`w-5 h-5 ${tradingTimesLoading ? "text-emerald-400 animate-pulse" : "text-emerald-400"}`} />
        </div>
        <div className="mt-3 rounded-xl bg-black/30 border border-white/5 p-3">
          {tradingTimesError ? (
            <p className="text-[10px] text-red-400">{tradingTimesError}</p>
          ) : tradingTimesLoading ? (
            <p className="text-[10px] text-muted-foreground">A consultar o calendário de negociação de hoje…</p>
          ) : tradingTimes ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[8px] uppercase tracking-widest text-muted-foreground">Símbolo</p>
                  <p className="text-sm font-black text-white">{tradingTimes.schedule.underlying_symbol ?? "frxEURUSD"}</p>
                </div>
                <div>
                  <p className="text-[8px] uppercase tracking-widest text-muted-foreground">Dias</p>
                  <p className="text-sm font-black text-white">{Array.isArray(tradingTimes.schedule.trading_days) ? tradingTimes.schedule.trading_days.join(", ") : "—"}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/5 p-2">
                  <p className="text-[8px] uppercase tracking-widest text-muted-foreground">Abertura</p>
                  <p className="text-xs font-black text-emerald-300">{tradingTimes.schedule.displayOpen || "—"}</p>
                </div>
                <div className="rounded-lg border border-white/5 p-2">
                  <p className="text-[8px] uppercase tracking-widest text-muted-foreground">Fecho</p>
                  <p className="text-xs font-black text-emerald-300">{tradingTimes.schedule.displayClose || "—"}</p>
                </div>
              </div>
              {tradingTimes.schedule.displaySettlement && (
                <p className="text-[9px] text-muted-foreground">Settlement: <span className="text-white font-bold">{tradingTimes.schedule.displaySettlement}</span></p>
              )}
              {Array.isArray(tradingTimes.schedule.events) && tradingTimes.schedule.events.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[9px] text-amber-300">Eventos especiais hoje: {tradingTimes.schedule.events.length}</p>
                  {tradingTimes.schedule.events.slice(0, 3).map((event: any, index: number) => (
                    <p key={index} className="text-[8px] text-amber-200/70">
                      {event?.dates ?? event?.date ?? "Evento"}: {event?.descrip ?? event?.description ?? "horário especial"}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">Ainda não consultado.</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => loadTradingTimes()}
          disabled={tradingTimesLoading}
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${tradingTimesLoading ? "animate-spin" : ""}`} />
          Actualizar horário
        </button>
      </div>

      <ForexResearchPanel />

      <div className="w-full max-w-xl mx-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-left">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-white">contracts_for</p>
          {!error && !loading ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{loading ? "A consultar a New API…" : error ? error : contracts.length ? contracts.join(" · ") : "Nenhum contrato devolvido"}</p>
        {symbolInfo && <p className="mt-2 text-[9px] text-muted-foreground/60">Fonte: active_symbols → underlying_symbol / underlying_symbol_name / pip_size. Não são campos Legacy.</p>}
      </div>

      <div className="w-full max-w-xl mx-auto rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 text-left">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Diagnóstico de Proposal</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Testa duração, stake mínimo e barreiras relativas sem executar nenhuma operação.</p>
          </div>
          <FlaskConical className="w-5 h-5 text-emerald-400" />
        </div>

        <button
          onClick={runProposalDiagnostics}
          disabled={probeLoading || loading}
          className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-black uppercase tracking-wide disabled:opacity-50"
        >
          {probeLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
          {probeLoading ? "A testar New API…" : "Executar bateria de validação"}
        </button>

        {probeError && <p className="mt-3 text-[10px] text-red-400">{probeError}</p>}

        {probeResults.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-black/30 border border-white/5 p-3">
                <p className="text-[8px] uppercase tracking-widest text-muted-foreground">Moeda da conta</p>
                <p className="text-sm font-black text-white">{derivService.getAccountCurrency()}</p>
              </div>
              <div className="rounded-xl bg-black/30 border border-white/5 p-3">
                <p className="text-[8px] uppercase tracking-widest text-muted-foreground">Menor stake testado aceite</p>
                <p className="text-sm font-black text-emerald-300">{lowestAcceptedStake == null ? "—" : lowestAcceptedStake.toFixed(2)}</p>
              </div>
            </div>

            <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Durações — CALL / 1 unidade de stake</p>
            <div className="overflow-x-auto rounded-xl border border-white/5">
              <table className="w-full text-[9px]">
                <thead className="bg-white/[0.03] text-muted-foreground">
                  <tr><th className="p-2 text-left">Min</th><th className="p-2 text-left">Estado</th><th className="p-2 text-left">Ask</th><th className="p-2 text-left">Payout</th></tr>
                </thead>
                <tbody>
                  {durationResults.map((r) => (
                    <tr key={`d-${r.duration}`} className="border-t border-white/5">
                      <td className="p-2 font-bold text-white">{r.duration}</td>
                      <td className={`p-2 font-bold ${r.ok ? "text-emerald-400" : "text-red-400"}`}>{r.ok ? "ACEITE" : "REJEITADO"}</td>
                      <td className="p-2 text-muted-foreground">{r.ok ? String(r.askPrice ?? "—") : "—"}</td>
                      <td className="p-2 text-muted-foreground">{r.ok ? String(r.payout ?? "—") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Stake — duração de 15 minutos</p>
            <div className="grid grid-cols-4 gap-2">
              {stakeResults.map((r) => (
                <div key={`s-${r.amount}`} className={`rounded-lg border p-2 text-center ${r.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/10 bg-red-500/5"}`}>
                  <p className="text-[9px] font-black text-white">{r.amount.toFixed(2)}</p>
                  <p className={`text-[8px] ${r.ok ? "text-emerald-400" : "text-red-400"}`}>{r.ok ? "OK" : "NO"}</p>
                </div>
              ))}
            </div>

            {boundaryResults.length > 0 && (
              <>
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Fronteira de duração — CALL / 15 min alvo</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                  {boundaryResults.map((r) => (
                    <div key={`boundary-${r.duration}`} className="rounded-lg bg-black/20 px-3 py-2 text-[9px]">
                      <span className="font-black text-white">{r.duration} min</span>
                      <span className={`ml-2 ${r.ok ? "text-emerald-400" : "text-red-400"}`}>{r.ok ? "OK" : "NO"}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {hlResults.length > 0 && (
              <>
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Higher / Lower — fronteira de duração (15 min → 5 h)</p>
                <div className="space-y-1">
                  {hlResults.map((r, i) => (
                    <div key={`${r.contractType}-${r.barrier}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-3 py-2 text-[9px]">
                      <span className="font-black text-white">{r.contractType} · {r.duration} min · {r.barrier}</span>
                      <span className={r.ok ? "text-emerald-400" : "text-red-400"}>{r.ok ? `ACEITE · ask ${r.askPrice ?? "—"} · payout ${r.payout ?? "—"}` : `REJEITADO · ${r.error}`}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <p className="text-[9px] text-muted-foreground/60">Os resultados indicam apenas o que foi aceite pela Proposal no momento do teste. Não constituem garantia de disponibilidade futura nem executam BUY.</p>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row justify-center gap-3">
        <button onClick={() => load()} className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-emerald-500/30 text-emerald-400 text-[11px] font-black uppercase tracking-wide hover:bg-emerald-500/10 transition-colors"><RefreshCw className="w-3.5 h-3.5" /> Actualizar dados</button>
        <button onClick={() => setMarket(null)} className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-white/10 text-muted-foreground text-[11px] font-black uppercase tracking-wide hover:bg-white/5 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> Escolher outro mercado</button>
      </div>
    </div>
  );
};
