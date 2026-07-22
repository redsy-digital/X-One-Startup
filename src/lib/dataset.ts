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
 * Agrega ticks brutos em candles OHLC — réplica exacta da lógica usada
 * ao vivo em useMarketStore.addTick (Math.floor(time/timeframe)*timeframe),
 * aqui aplicada de uma vez sobre um array em vez de tick a tick.
 */
function bucketTicksIntoCandles(times: number[], prices: number[], timeframeSeconds: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < times.length; i++) {
    const time = Number(times[i]);
    const price = Number(prices[i]);
    const bucketTime = Math.floor(time / timeframeSeconds) * timeframeSeconds;
    const last = candles[candles.length - 1];
    if (last && last.time === bucketTime) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
    } else {
      candles.push({ time: bucketTime, open: price, high: price, low: price, close: price });
    }
  }
  return candles;
}

/**
 * Pede um lote histórico grande directamente da Deriv (via WebSocket já
 * ligado) e descarrega-o como dataset assim que chegar.
 *
 * IMPORTANTE — partilha canais de eventos com o resto da app (App.tsx
 * ouve "candles" para o histórico normal). Isto significa que, ao chamar
 * isto, o buffer normal de candles (useMarketStore) TAMBÉM pode ser
 * substituído temporariamente por este lote maior — inofensivo com o bot
 * parado, mas por isso é que o botão que chama isto só deve ficar activo
 * com o bot desligado. Depois de exportar, troca de símbolo ou volta a
 * ligar para o gráfico voltar ao normal.
 *
 * A Deriv não aceita granularity < 60s para style "candles" (confirmado:
 * "Input validation failed: granularity"). Para granularitySeconds < 60
 * (ex.: timeframes de 1s dos símbolos 1HZ), pede-se ticks brutos
 * (style: "ticks", sem limite de granularidade) e constrói-se os candles
 * no cliente com a mesma lógica usada ao vivo — para os dois lados
 * (histórico e ao vivo) ficarem consistentes.
 *
 * Erros vêm sempre com msg_type "ticks_history" (o nome do campo do
 * pedido), independentemente do style pedido — confirmado para "candles";
 * assumido por analogia para "ticks" (mesma chave de pedido).
 */
export function fetchAndDownloadHistoricalDataset(
  symbol: string,
  granularitySeconds: number,
  count: number,
  onError: (message: string) => void,
  onSuccess: (candleCount: number) => void
): void {
  if (!derivService.isSocketOpen()) {
    onError("Não há ligação activa à Deriv. Liga-te primeiro no Dashboard.");
    return;
  }

  derivService.debugLogAllMessagesFor(20_000);

  const useRawTicks = granularitySeconds < 60;
  let settled = false;

  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    unsubError();
    unsubSuccess();
    fn();
  };

  const timeoutId = setTimeout(() => {
    finish(() => onError("A Deriv não respondeu a tempo (20s). Tenta novamente."));
  }, 20_000);

  const unsubError = derivService.on("ticks_history", (data: any) => {
    if (data.error) {
      finish(() => onError(data.error.message || "Erro desconhecido ao pedir histórico à Deriv."));
    }
  });

  const unsubSuccess = derivService.on(useRawTicks ? "history" : "candles", (data: any) => {
    if (data.error) {
      finish(() => onError(data.error.message || "Erro desconhecido ao pedir histórico à Deriv."));
      return;
    }
    let candles: Candle[];
    if (useRawTicks) {
      const times: number[] = data.history?.times ?? [];
      const prices: number[] = data.history?.prices ?? [];
      if (!times.length) {
        finish(() => onError("A Deriv devolveu 0 ticks para este pedido."));
        return;
      }
      candles = bucketTicksIntoCandles(times, prices, granularitySeconds);
    } else {
      if (!data.candles?.length) {
        finish(() => onError("A Deriv devolveu 0 candles para este pedido."));
        return;
      }
      candles = data.candles.map((c: any) => ({
        time: Number(c.epoch),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }));
    }
    finish(() => {
      downloadCandleDataset(candles, symbol);
      onSuccess(candles.length);
    });
  });

  if (useRawTicks) {
    derivService.requestRawTicksHistory(symbol, count);
  } else {
    derivService.requestTicksHistory(symbol, count, granularitySeconds);
  }
}
