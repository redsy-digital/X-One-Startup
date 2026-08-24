/** D5 — Forex session context. This is contextual only; market-open gating remains D2/trading_times. */
export type ForexSession = 'SYDNEY' | 'TOKYO' | 'LONDON' | 'NEW_YORK' | 'OVERLAP' | 'OFF_SESSION';

export interface ForexSessionSnapshot {
  session: ForexSession;
  activeSessions: Array<'SYDNEY' | 'TOKYO' | 'LONDON' | 'NEW_YORK'>;
  overlap: boolean;
  utcHour: number;
  calculatedAt: number;
  version: 'forex-session-v1.0.0';
}

// Approximate UTC session windows. These are contextual hints, not exchange-hours gates.
// DST changes are intentionally not used to override trading_times from Deriv.
const WINDOWS = {
  SYDNEY: [21, 6],
  TOKYO: [0, 9],
  LONDON: [7, 16],
  NEW_YORK: [12, 21],
} as const;

type NamedSession = keyof typeof WINDOWS;

function inWindow(hour: number, start: number, end: number): boolean {
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function getForexSession(nowMs = Date.now()): ForexSessionSnapshot {
  const date = new Date(nowMs);
  const hour = date.getUTCHours();
  const activeSessions = (Object.entries(WINDOWS) as Array<[NamedSession, readonly [number, number]]>)
    .filter(([, [start, end]]) => inWindow(hour, start, end))
    .map(([name]) => name);

  const overlap = activeSessions.length > 1;
  let session: ForexSession = 'OFF_SESSION';
  if (overlap) session = 'OVERLAP';
  else if (activeSessions.length === 1) session = activeSessions[0];

  return {
    session,
    activeSessions,
    overlap,
    utcHour: hour,
    calculatedAt: nowMs,
    version: 'forex-session-v1.0.0',
  };
}
