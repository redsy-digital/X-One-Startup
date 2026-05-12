import { Candle } from "../types";

export const calculateEMA = (data: number[], period: number): number => {
  if (data.length < period) return 0;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * k + ema;
  }
  return ema;
};

export const calculateRSI = (data: number[], period: number = 14): number => {
  if (data.length <= period) return 50;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    let currentGain = change > 0 ? change : 0;
    let currentLoss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

export const calculateADX = (candles: Candle[], period: number = 14) => {
  if (candles.length < period * 2) return { adx: 0, plusDI: 0, minusDI: 0 };

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const highDiff = candles[i].high - candles[i - 1].high;
    const lowDiff = candles[i - 1].low - candles[i].low;

    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
  }

  const smooth = (data: number[], p: number) => {
    const results: number[] = [];
    let current = data.slice(0, p).reduce((a, b) => a + b, 0);
    results.push(current);
    for (let i = p; i < data.length; i++) {
      current = current - current / p + data[i];
      results.push(current);
    }
    return results;
  };

  const str = smooth(tr, period);
  const sPlusDM = smooth(plusDM, period);
  const sMinusDM = smooth(minusDM, period);

  const dx: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const plusDI = (sPlusDM[i] / str[i]) * 100;
    const minusDI = (sMinusDM[i] / str[i]) * 100;
    const diff = Math.abs(plusDI - minusDI);
    const sum = plusDI + minusDI;
    dx.push(sum === 0 ? 0 : (diff / sum) * 100);
  }

  const adx = calculateEMA(dx, period);
  const lastIdx = str.length - 1;

  return {
    adx,
    plusDI: (sPlusDM[lastIdx] / str[lastIdx]) * 100,
    minusDI: (sMinusDM[lastIdx] / str[lastIdx]) * 100
  };
};

export const calculateATR = (candles: Candle[], period: number = 14): number => {
  if (candles.length < period + 1) return 0;
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  return calculateEMA(tr, period);
};

export const calculateMACD = (data: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9) => {
  if (data.length < slowPeriod) return { macd: 0, signal: 0, histogram: 0 };
  
  const fastEMA: number[] = [];
  const slowEMA: number[] = [];
  
  // Need to calculate EMAs for the whole range to get proper signal line
  let fEMA = data[0];
  let sEMA = data[0];
  const fk = 2 / (fastPeriod + 1);
  const sk = 2 / (slowPeriod + 1);
  
  const macdLine: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    fEMA = (data[i] - fEMA) * fk + fEMA;
    sEMA = (data[i] - sEMA) * sk + sEMA;
    
    if (i >= slowPeriod) {
      macdLine.push(fEMA - sEMA);
    }
  }
  
  if (macdLine.length < signalPeriod) return { macd: 0, signal: 0, histogram: 0 };
  
  const signalLine = calculateEMA(macdLine, signalPeriod);
  const lastMACD = macdLine[macdLine.length - 1];
  
  return {
    macd: lastMACD,
    signal: signalLine,
    histogram: lastMACD - signalLine
  };
};

export const calculateBollingerBands = (data: number[], period: number = 20, multiplier: number = 2) => {
  if (data.length < period) return { middle: 0, upper: 0, lower: 0 };
  
  const window = data.slice(-period);
  const middle = window.reduce((a, b) => a + b, 0) / period;
  
  const variance = window.reduce((total, val) => total + Math.pow(val - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  
  return {
    middle,
    upper: middle + multiplier * stdDev,
    lower: middle - multiplier * stdDev
  };
};
