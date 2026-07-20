import { Candle } from "../types";
import { derivService } from "./deriv";

/**
 * Fase 2 da auditoria, item 10 — "criar um conjunto de dados de referência".
 * Fase 3, etapa 3.0 — passou a puxar um lote grande directamente da Deriv
 * (requestTicksHistory já aceita um `count` maior), em vez de depender só
 * do que já estava em memória (até 500 candles).
 */

export interface CandleDataset {
  symbol: string;
  exportedAt: string; // ISO
  candleCount: number;
  candles: Candle[];
}

export function buildCandleDataset(candles: Candle[], symbol: string): CandleDataset {
  return {
    symbol,
    exportedAt: new Date().toISOString(),
    candleCount: candles.length,
    candles,
  };
}

/**
 * Dispara o download do dataset como ficheiro .json no browser.
 * Só funciona em contexto de browser (usa document/Blob) — não chamar
 * fora de um componente React.
 */
export function downloadCandleDataset(candles: Candle[], symbol: string): void {
  const dataset = buildCandleDataset(candles, symbol);
  const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = dataset.exportedAt.replace(/[:.]/g, "-");
  a.href = url;
  a.download = `xone-dataset-${symbol}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Pede um lote histórico grande directamente da Deriv (via WebSocket já
 * ligado) e descarrega-o como dataset assim que chegar.
 *
 * IMPORTANTE — partilha o mesmo canal de eventos "candles" que a app usa
 * para carregar o histórico normal (App.tsx). Isto significa que, ao
 * chamar isto, o buffer normal de candles (useMarketStore) TAMBÉM vai
 * ser substituído temporariamente por este lote maior — inofensivo com
 * o bot parado, mas por isso é que o botão que chama isto só deve ficar
 * activo com o bot desligado. Depois de exportar, troca de símbolo ou
 * volta a ligar para o gráfico voltar ao normal.
 *
 * A Deriv pode rejeitar `count` muito grande (não há como confirmar o
 * limite exacto sem uma chamada real) — nesse caso o erro é reportado
 * via onError em vez de descarregar um ficheiro vazio.
 */
export function fetchAndDownloadHistoricalDataset(
  symbol: string,
  granularitySeconds: number,
  count: number,
  onError: (message: string) => void,
  onSuccess: (candleCount: number) => void
): void {
  const unsubscribe = derivService.on("candles", (data: any) => {
    unsubscribe();
    if (data.error) {
      onError(data.error.message || "Erro desconhecido ao pedir histórico à Deriv.");
      return;
    }
    if (!data.candles?.length) {
      onError("A Deriv devolveu 0 candles para este pedido.");
      return;
    }
    const candles: Candle[] = data.candles.map((c: any) => ({
      time: Number(c.epoch),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));
    downloadCandleDataset(candles, symbol);
    onSuccess(candles.length);
  });
  derivService.requestTicksHistory(symbol, count, granularitySeconds);
}
