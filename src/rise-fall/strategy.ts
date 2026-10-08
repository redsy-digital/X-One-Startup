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
