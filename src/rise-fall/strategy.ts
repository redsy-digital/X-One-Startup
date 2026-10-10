import type { RiseFallContractType, RiseFallDirection } from "./types";

export function directionFromPrices(previous: number | null, current: number): RiseFallDirection | null {
  if (previous == null || !Number.isFinite(previous) || !Number.isFinite(current) || current === previous) return null;
  return current > previous ? "UP" : "DOWN";
}

export function contractForDirection(direction: RiseFallDirection): RiseFallContractType {
  return direction === "UP" ? "CALL" : "PUT";
}

export function oppositeContract(direction: RiseFallDirection): RiseFallContractType {
  return direction === "UP" ? "PUT" : "CALL";
}

export function findSequenceSignal(
  directions: RiseFallDirection[],
  length: number,
): { contract: RiseFallContractType; direction: RiseFallDirection } | null {
  const n = Math.max(1, Math.floor(length));
  if (directions.length < n) return null;
  const tail = directions.slice(-n);
  if (tail.every((d) => d === "UP")) return { contract: "PUT", direction: "UP" };
  if (tail.every((d) => d === "DOWN")) return { contract: "CALL", direction: "DOWN" };
  return null;
}

export function findBlockDensitySignal(
  directions: RiseFallDirection[],
  windowSize: number,
  thresholdPercent: number,
): { contract: RiseFallContractType; dominant: RiseFallDirection; percent: number } | null {
  const n = Math.max(2, Math.floor(windowSize));
  if (directions.length < n) return null;
  const tail = directions.slice(-n);
  const up = tail.filter((d) => d === "UP").length;
  const down = tail.length - up;
  const upPct = (up / n) * 100;
  const downPct = (down / n) * 100;
  const threshold = Math.max(50, Math.min(100, thresholdPercent));
  if (upPct >= threshold) return { contract: "PUT", dominant: "UP", percent: upPct };
  if (downPct >= threshold) return { contract: "CALL", dominant: "DOWN", percent: downPct };
  return null;
}

export function findAlternatingSignal(
  directions: RiseFallDirection[],
  length: number,
): { contract: RiseFallContractType; lastDirection: RiseFallDirection } | null {
  const n = Math.max(2, Math.floor(length));
  if (directions.length < n) return null;
  const tail = directions.slice(-n);
  for (let i = 1; i < tail.length; i++) {
    if (tail[i] === tail[i - 1]) return null;
  }
  const lastDirection = tail[tail.length - 1];
  // Break the perfect alternation by repeating the direction of the last tick.
  return { contract: contractForDirection(lastDirection), lastDirection };
}


export interface PercentChannelState {
  highestHigh: number; lowestLow: number; centerLine: number; percent: number; zone: "HIGH" | "LOW" | "CENTER";
}

export function calculatePercentChannel(prices: number[], currentPrice?: number): PercentChannelState | null {
  const valid = prices.filter(Number.isFinite);
  if (valid.length < 2) return null;
  const highestHigh = Math.max(...valid);
  const lowestLow = Math.min(...valid);
  const centerLine = (highestHigh + lowestLow) / 2;
  const price = currentPrice ?? valid[valid.length - 1];
  const halfRange = (highestHigh - lowestLow) / 2;
  if (!Number.isFinite(halfRange) || halfRange <= 0) return { highestHigh, lowestLow, centerLine, percent: 0, zone: "CENTER" };
  if (price > centerLine) return { highestHigh, lowestLow, centerLine, percent: Math.max(0, Math.min(100, ((price - centerLine) / (highestHigh - centerLine)) * 100)), zone: "HIGH" };
  if (price < centerLine) return { highestHigh, lowestLow, centerLine, percent: Math.max(0, Math.min(100, ((centerLine - price) / (centerLine - lowestLow)) * 100)), zone: "LOW" };
  return { highestHigh, lowestLow, centerLine, percent: 0, zone: "CENTER" };
}

export function findPercentChannelSignal(args: { prices: number[]; directions: RiseFallDirection[]; thresholdPercent: number; sequenceLength: number; momentumFilter: boolean }): { contract: RiseFallContractType; reason: string } | null {
  const channel = calculatePercentChannel(args.prices);
  const sequenceLength = Math.max(1, Math.min(100, Math.floor(args.sequenceLength)));
  if (!channel || args.directions.length < sequenceLength) return null;
  const lastSequence = args.directions.slice(-sequenceLength);
  if (lastSequence.length === sequenceLength && lastSequence.every(d => d === "UP") && channel.zone === "HIGH" && channel.percent >= args.thresholdPercent) {
    if (args.momentumFilter) {
      if (sequenceLength < 3) return null;
      const tail = args.prices.slice(-(sequenceLength + 1));
      const moves = tail.slice(1).map((p, i) => Math.abs(p - tail[i]));
      const finalMove = moves[moves.length - 1];
      if (moves.length < sequenceLength || !(finalMove < moves[0] && finalMove < moves[1])) return null;
    }
    return { contract: "PUT", reason: `Canal Percentual ${channel.percent.toFixed(1)}% zona alta + ${sequenceLength} UP` };
  }
  if (lastSequence.length === sequenceLength && lastSequence.every(d => d === "DOWN") && channel.zone === "LOW" && channel.percent >= args.thresholdPercent) {
    if (args.momentumFilter) {
      if (sequenceLength < 3) return null;
      const tail = args.prices.slice(-(sequenceLength + 1));
      const moves = tail.slice(1).map((p, i) => Math.abs(p - tail[i]));
      const finalMove = moves[moves.length - 1];
      if (moves.length < sequenceLength || !(finalMove < moves[0] && finalMove < moves[1])) return null;
    }
    return { contract: "CALL", reason: `Canal Percentual ${channel.percent.toFixed(1)}% zona baixa + ${sequenceLength} DOWN` };
  }
  return null;
}
