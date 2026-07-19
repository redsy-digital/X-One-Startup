import { Candle } from "../types";

/**
 * Fase 2 da auditoria, item 10 — "criar um conjunto de dados de referência".
 *
 * Não há forma de obter aqui, no ambiente de análise, histórico real da
 * Deriv (a API é só WebSocket, não um endpoint que se possa simplesmente
 * ler à distância, e não há acesso de rede neste ambiente). A alternativa
 * prática: exportar os candles que a própria aplicação já tem em memória
 * (useMarketStore) durante uma sessão ao vivo, para ires construindo um
 * dataset real ao longo do tempo, capturando diferentes condições de
 * mercado (TRENDING, CHOPPY, etc.) em ficheiros separados.
 *
 * Uso sugerido: liga-te num símbolo, deixa a app a receber candles reais
 * por uns minutos/horas, depois exporta. Repete em dias/condições
 * diferentes para acumulares um dataset variado.
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
