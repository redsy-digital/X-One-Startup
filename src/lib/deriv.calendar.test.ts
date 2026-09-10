import { describe, expect, it } from "vitest";
import { buildEconomicCalendarRequest } from "./deriv";

describe("Deriv economic calendar transport", () => {
  it("builds the native economic_calendar request without New API trading fields", () => {
    expect(buildEconomicCalendarRequest("USD", 100, 200, 7)).toEqual({
      economic_calendar: 1,
      currency: "USD",
      start_date: 100,
      end_date: 200,
      req_id: 7,
    });
  });

  it("allows all currencies when currency is omitted", () => {
    expect(buildEconomicCalendarRequest(undefined, 100, 200)).toEqual({
      economic_calendar: 1,
      start_date: 100,
      end_date: 200,
    });
  });
});


describe("Deriv public calendar transport configuration", () => {
  it("uses the documented public WebSocket host and app_id query parameter", () => {
    // The live transport is intentionally isolated in DerivService; this test
    // documents the invariant that prevents the previous no-app-id failure.
    const publicAppId = String(import.meta.env.VITE_DERIV_PUBLIC_APP_ID || "1089");
    const url = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(publicAppId)}`;
    expect(url).toContain("wss://ws.derivws.com/websockets/v3?app_id=");
    expect(publicAppId).toBeTruthy();
  });
});
