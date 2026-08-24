import React from "react";
import { useMarketStore } from "../store";
import { ForexDashboardPlaceholder } from "../components/ForexDashboardPlaceholder";

/**
 * Research/diagnostic workspace.
 * The former Forex dashboard is intentionally preserved here so none of the
 * Phase 2/3 investigation tooling is lost while the production dashboard is
 * rebuilt separately.
 */
export const TestesForexPage = () => {
  const { market, setMarket } = useMarketStore();
  React.useEffect(() => {
    if (market !== "forex") setMarket("forex");
  }, [market, setMarket]);
  return <ForexDashboardPlaceholder />;
};
