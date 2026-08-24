import type { ForexCalendarDecision, ForexEconomicEvent, ForexNewsImpact } from "../decision-engine/types";

export interface ForexCalendarConfig {
  preEventBlockMinutes: number;
  postEventBlockMinutes: number;
  mediumImpactWatchMinutes: number;
  blockMediumImpact: boolean;
  blockUnknownImpact: boolean;
}

export const DEFAULT_FOREX_CALENDAR_CONFIG: ForexCalendarConfig = {
  preEventBlockMinutes: 30,
  postEventBlockMinutes: 15,
  mediumImpactWatchMinutes: 30,
  blockMediumImpact: false,
  blockUnknownImpact: true,
};

export interface ForexCalendarQuery {
  now?: number;
  startDate?: number;
  endDate?: number;
}

export interface ForexCalendarProvider {
  getEvents(currency: string, startDate: number, endDate: number): Promise<ForexEconomicEvent[]>;
}

export interface DerivEconomicCalendarResponse {
  events?: unknown[];
  [key: string]: unknown;
}

export type CalendarImpactInput = ForexNewsImpact | string | number | null | undefined;

export interface ForexCalendarSnapshot extends ForexCalendarDecision {
  source: "deriv-native";
  currencies: string[];
}
