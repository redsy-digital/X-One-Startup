import type { ForexCalendarDecision, ForexEconomicEvent, ForexReasonCode } from "../decision-engine/types";
import { DEFAULT_FOREX_CALENDAR_CONFIG, ForexCalendarConfig } from "./types";

export interface ForexCalendarEngineInput {
  now: number;
  events: ForexEconomicEvent[];
  config?: Partial<ForexCalendarConfig>;
}

export function evaluateForexCalendar(input: ForexCalendarEngineInput): ForexCalendarDecision {
  const cfg = { ...DEFAULT_FOREX_CALENDAR_CONFIG, ...(input.config ?? {}) };
  const pre = cfg.preEventBlockMinutes * 60;
  const post = cfg.postEventBlockMinutes * 60;
  const watch = cfg.mediumImpactWatchMinutes * 60;
  const relevant = input.events
    .filter((e) => Math.abs(e.eventTime - input.now) <= Math.max(pre, post, watch) || e.eventTime >= input.now)
    .sort((a, b) => a.eventTime - b.eventTime);

  const inWindow = (event: ForexEconomicEvent, before: number, after: number) =>
    input.now >= event.eventTime - before && input.now <= event.eventTime + after;

  const critical = relevant.find((e) => e.impact === "critical" && inWindow(e, pre, post));
  const high = relevant.find((e) => e.impact === "high" && inWindow(e, pre, post));
  if (critical || high) {
    const event = critical ?? high!;
    return {
      state: "BLOCK",
      reasonCode: "NEWS_BLOCK_HIGH_IMPACT" as ForexReasonCode,
      relevantEvents: relevant,
      blockedUntil: event.eventTime + post,
      checkedAt: input.now,
    };
  }

  if (cfg.blockMediumImpact) {
    const medium = relevant.find((e) => e.impact === "medium" && inWindow(e, pre, post));
    if (medium) {
      return {
        state: "BLOCK",
        reasonCode: "NEWS_BLOCK_MEDIUM_IMPACT",
        relevantEvents: relevant,
        blockedUntil: medium.eventTime + post,
        checkedAt: input.now,
      };
    }
  }

  const mediumWatch = relevant.find((e) => e.impact === "medium" && inWindow(e, watch, post));
  if (mediumWatch) {
    return { state: "WATCH", relevantEvents: relevant, checkedAt: input.now };
  }

  const unknown = relevant.find((e) => !["low", "medium", "high", "critical"].includes(e.impact));
  if (unknown && cfg.blockUnknownImpact) {
    return { state: "UNKNOWN", reasonCode: "NEWS_BLOCK_HIGH_IMPACT", relevantEvents: relevant, checkedAt: input.now };
  }

  return { state: "CLEAR", relevantEvents: relevant, checkedAt: input.now };
}
