import type { DerivService } from "../../lib/deriv";
import type { ForexEconomicEvent } from "../decision-engine/types";
import type { ForexCalendarProvider, CalendarImpactInput } from "./types";

const CURRENCY_RE = /^[A-Z]{3}$/;

function numberOrString(value: unknown): number | string | null | undefined {
  if (value === null || value === undefined || value === "") return value as null | undefined;
  if (typeof value === "number" || typeof value === "string") return value;
  return undefined;
}

function epochFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

export function normalizeImpact(value: CalendarImpactInput): "low" | "medium" | "high" | "critical" {
  if (typeof value === "number") {
    if (value >= 4) return "critical";
    if (value >= 3) return "high";
    if (value >= 2) return "medium";
    return "low";
  }
  const v = String(value ?? "").trim().toLowerCase();
  if (v.includes("critical") || v === "4") return "critical";
  if (v.includes("high") || v === "3") return "high";
  if (v.includes("medium") || v.includes("moderate") || v === "2") return "medium";
  return "low";
}

function pick(obj: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  return undefined;
}

export function normalizeEconomicEvent(raw: unknown, fallbackCurrency: string): ForexEconomicEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const eventTime = epochFrom(pick(obj, "event_time", "timestamp", "time", "date"));
  if (eventTime === undefined) return null;
  const currency = String(pick(obj, "currency", "currency_code", "currency_symbol") ?? fallbackCurrency).toUpperCase();
  if (!CURRENCY_RE.test(currency)) return null;
  const name = String(pick(obj, "event_name", "name", "title", "event") ?? "Economic event");
  const eventId = String(pick(obj, "event_id", "id", "eventId") ?? `${currency}:${eventTime}:${name}`);
  return {
    eventId,
    currency,
    name,
    impact: normalizeImpact(pick(obj, "impact", "importance", "importance_level") as CalendarImpactInput),
    eventTime,
    actual: numberOrString(pick(obj, "actual")),
    forecast: numberOrString(pick(obj, "forecast", "expected")),
    previous: numberOrString(pick(obj, "previous", "prior")),
  };
}

export function extractEvents(response: unknown, fallbackCurrency: string): ForexEconomicEvent[] {
  const root = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const rawEvents = Array.isArray(root.events)
    ? root.events
    : Array.isArray(root.data) ? root.data
    : [];
  return rawEvents.map((event) => normalizeEconomicEvent(event, fallbackCurrency)).filter(Boolean) as ForexEconomicEvent[];
}

export class DerivForexCalendarProvider implements ForexCalendarProvider {
  constructor(private readonly deriv: Pick<DerivService, "getEconomicCalendar">) {}

  async getEvents(currency: string, startDate: number, endDate: number) {
    const response = await this.deriv.getEconomicCalendar(currency, startDate, endDate);
    return extractEvents(response, currency);
  }
}
