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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PageResult =
  | { times: number[]; prices: number[] }
  | { candles: Candle[] }
  | { error: string };

/** Busca UMA página de histórico (ticks ou candles, consoante o estilo). */
function fetchOnePage(
  symbol: string,
  useRawTicks: boolean,
  granularitySeconds: number,
  count: number,
  endTime: number | "latest"
): Promise<PageResult> {
  return new Promise((resolve) => {
    if (!derivService.isSocketOpen()) {
      resolve({ error: "Não há ligação activa à Deriv. Liga-te primeiro no Dashboard." });
      return;
    }
    derivService.debugLogAllMessagesFor(20_000);

    let settled = false;
    const finish = (result: PageResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      unsubError();
      unsubSuccess();
      resolve(result);
    };

    const timeoutId = setTimeout(() => finish({ error: "A Deriv não respondeu a tempo (20s)." }), 20_000);

    const unsubError = derivService.on("ticks_history", (data: any) => {
      if (data.error) finish({ error: data.error.message || "Erro desconhecido ao pedir histórico à Deriv." });
    });

    const unsubSuccess = derivService.on(useRawTicks ? "history" : "candles", (data: any) => {
      if (data.error) {
        finish({ error: data.error.message || "Erro desconhecido ao pedir histórico à Deriv." });
        return;
      }
      if (useRawTicks) {
        const times = (data.history?.times ?? []).map(Number);
        const prices = (data.history?.prices ?? []).map(Number);
        finish({ times, prices });
      } else {
        const candles: Candle[] = (data.candles ?? []).map((c: any) => ({
          time: Number(c.epoch),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        }));
        finish({ candles });
      }
    });

    if (useRawTicks) {
      derivService.requestRawTicksHistory(symbol, count, endTime);
    } else {
      derivService.requestTicksHistory(symbol, count, granularitySeconds, endTime);
    }
  });
}

/** Tamanho de página confirmado empiricamente como o máximo aceite pela Deriv por pedido. */
const PAGE_SIZE = 1000;
/** Tecto de segurança — não é "ilimitado" (evita um loop descontrolado e é
 *  mais simpático com limites de taxa da Deriv), mas dá até ~50 mil pontos. */
const MAX_PAGES = 50;
const DELAY_BETWEEN_PAGES_MS = 400;

/**
 * Pede um lote histórico grande directamente da Deriv, paginando
 * automaticamente sempre que o total pedido excede o máximo por pedido
 * (1000, confirmado na prática — pedir mais devolve só 1000). Cada página
 * busca o troço imediatamente anterior ao mais antigo já obtido, até
 * atingir o total pedido, esgotar o histórico disponível, ou chegar ao
 * tecto de segurança (50 páginas).
 *
 * IMPORTANTE — partilha canais de eventos com o resto da app (App.tsx
 * ouve "candles" para o histórico normal). O buffer normal de candles
 * (useMarketStore) pode ser substituído temporariamente durante isto —
 * inofensivo com o bot parado, por isso o botão que chama isto só deve
 * ficar activo com o bot desligado.
 *
 * A Deriv não aceita granularity < 60s para style "candles" (confirmado:
 * "Input validation failed: granularity"). Para granularitySeconds < 60
 * pede-se ticks brutos (style: "ticks") e constrói-se os candles no
 * cliente com a mesma lógica usada ao vivo (useMarketStore.addTick).
 */
export async function fetchAndDownloadHistoricalDataset(
  symbol: string,
  granularitySeconds: number,
  desiredCount: number,
  onError: (message: string) => void,
  onSuccess: (candleCount: number) => void,
  onProgress?: (fetchedCount: number, page: number) => void
): Promise<void> {
  if (!derivService.isSocketOpen()) {
    onError("Não há ligação activa à Deriv. Liga-te primeiro no Dashboard.");
    return;
  }

  const useRawTicks = granularitySeconds < 60;
  let allTimes: number[] = [];
  let allPrices: number[] = [];
  let allCandles: Candle[] = [];
  let endTime: number | "latest" = "latest";
  let page = 0;

  while (page < MAX_PAGES) {
    page++;
    // IMPORTANTE: quando useRawTicks, "quantos já temos" tem de ser medido
    // em CANDLES depois de agregados, não em ticks brutos — vários ticks
    // podem cair no mesmo candle (ex.: timeframe 3s/5s com ticks a cada
    // ~1-2s). Comparar contagem de ticks com o total pedido em candles só
    // dava certo por coincidência a 1s (onde tende a ser 1 tick por candle).
    const alreadyCandles = useRawTicks
      ? bucketTicksIntoCandles(allTimes, allPrices, granularitySeconds).length
      : allCandles.length;
    if (alreadyCandles >= desiredCount) break;
    // Pede sempre o máximo por página — não há como prever de antemão
    // quantos ticks brutos fazem falta para preencher N candles.
    const pageCount = PAGE_SIZE;

    const result = await fetchOnePage(symbol, useRawTicks, granularitySeconds, pageCount, endTime);

    if ("error" in result) {
      // Se já há dados de páginas anteriores, é melhor exportar o que já
      // temos do que perder tudo por a última página ter falhado.
      if (alreadyCandles > 0) break;
      onError(result.error);
      return;
    }

    if (useRawTicks && "times" in result) {
      if (result.times.length === 0) break; // sem mais histórico disponível
      // times/prices vêm cronológicos (mais antigo → mais recente); a
      // próxima página (mais antiga ainda) entra ANTES desta no array final.
      allTimes = [...result.times, ...allTimes];
      allPrices = [...result.prices, ...allPrices];
      endTime = result.times[0] - 1;
      const nowCandles = bucketTicksIntoCandles(allTimes, allPrices, granularitySeconds).length;
      onProgress?.(nowCandles, page);
      if (result.times.length < pageCount) break; // Deriv devolveu menos do pedido = fim do histórico
    } else if (!useRawTicks && "candles" in result) {
      if (result.candles.length === 0) break;
      allCandles = [...result.candles, ...allCandles];
      endTime = result.candles[0].time - granularitySeconds;
      onProgress?.(allCandles.length, page);
      if (result.candles.length < pageCount) break;
    }

    if (page < MAX_PAGES) await sleep(DELAY_BETWEEN_PAGES_MS);
  }

  const rawFinalCandles = useRawTicks ? bucketTicksIntoCandles(allTimes, allPrices, granularitySeconds) : allCandles;
  if (rawFinalCandles.length === 0) {
    onError("Não foi possível obter nenhum dado histórico.");
    return;
  }
  // Como cada página pede sempre o máximo (1000 ticks), pode sobrar um
  // pouco a mais que o pedido depois de agregar — aparar para o total
  // exacto pedido, mantendo os mais recentes.
  const finalCandles = rawFinalCandles.length > desiredCount
    ? rawFinalCandles.slice(rawFinalCandles.length - desiredCount)
    : rawFinalCandles;
  downloadCandleDataset(finalCandles, symbol);
  onSuccess(finalCandles.length);
}
