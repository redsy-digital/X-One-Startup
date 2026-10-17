import { beforeEach, describe, expect, it } from "vitest";
import { useMarketStore } from "./useMarketStore";

describe("historical/live synchronization", () => {
  beforeEach(() => useMarketStore.setState({ market:"synthetic",symbol:"R_10",timeframe:1,ticks:[],candles:[],historicalTicksLoading:false,historicalTicksError:null,pendingLiveTicks:[] }));

  it("keeps live ticks and candles updating while historical data is loading", () => {
    useMarketStore.getState().setHistoricalTicksLoading(true);
    useMarketStore.getState().addTick({time:1005,price:9.99,pipSize:2});
    useMarketStore.getState().addTick({time:1006,price:8.88,pipSize:2});
    const state = useMarketStore.getState();
    expect(state.ticks.map(t => t.time)).toEqual([1005, 1006]);
    expect(state.candles.map(c => c.time)).toEqual([1005, 1006]);
    expect(state.pendingLiveTicks.map(t => t.time)).toEqual([1005, 1006]);
    expect(state.historicalTicksLoading).toBe(true);
  });

  it("merges historical and live ticks and lets live win on duplicate epoch", () => {
    useMarketStore.getState().setHistoricalTicksLoading(true);
    useMarketStore.getState().addTick({time:1005,price:9.99,pipSize:2});
    useMarketStore.getState().addTick({time:1006,price:8.88,pipSize:2});
    useMarketStore.getState().setHistoricalTicks([{time:1000,price:1},{time:1005,price:1.05},{time:1007,price:1.07}],1);
    const state=useMarketStore.getState();
    expect(state.ticks.map(t=>t.time)).toEqual([1000,1005,1006,1007]);
    expect(state.ticks.find(t=>t.time===1005)?.price).toBe(9.99);
    expect(state.pendingLiveTicks).toEqual([]);
    expect(state.historicalTicksLoading).toBe(false);
  });

  it("keeps candles chronologically valid when a delayed tick arrives out of order", () => {
    useMarketStore.getState().addTick({time:1002,price:10});
    useMarketStore.getState().addTick({time:1004,price:12});
    useMarketStore.getState().addTick({time:1003,price:11});
    const state = useMarketStore.getState();
    expect(state.ticks.map(t => t.time)).toEqual([1002, 1003, 1004]);
    expect(state.candles.map(c => c.time)).toEqual([1002, 1003, 1004]);
    expect(state.candles[state.candles.length - 1].close).toBe(12);
  });
});
