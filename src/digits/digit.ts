import type { TickData } from "../types";

/** Centralized quote -> last digit extraction used by both chart and engine. */
export function extractLastDigit(value: unknown): number | null {
  const text = String(value ?? "").trim();
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (char >= "0" && char <= "9") return Number(char);
  }
  return null;
}

export function extractLastDigitFromQuote(quote: unknown, pipSize?: unknown): number | null {
  const numericQuote = Number(quote);
  if (!Number.isFinite(numericQuote)) return null;
  const numericPipSize = Number(pipSize);
  const decimals = Number.isInteger(numericPipSize) && numericPipSize >= 0 && numericPipSize <= 8
    ? numericPipSize
    : 2;
  return extractLastDigit(numericQuote.toFixed(decimals));
}

export function extractLastDigitFromTick(tick: Pick<TickData, "price"> & { pipSize?: number | null }): number | null {
  return extractLastDigitFromQuote(tick.price, tick.pipSize);
}
