import { beforeEach, describe, expect, it } from "vitest";
import { useMarketStore } from "./useMarketStore";
describe("historical/live synchronization", () => {
  beforeEach(() => useMarketStore.setState({ market:"synthetic",symbol:"R_10",timeframe:1,ticks:[],candles:[],historicalTicksLoading:false,historicalTicksError:null,pendingLiveTicks:[] }));
  it("keeps queued live ticks and lets live win on duplicate epoch", () => {
    useMarketStore.getState().setHistoricalTicksLoading(true);
    useMarketStore.getState().addTick({time:1005,price:9.99,pipSize:2});
    useMarketStore.getState().addTick({time:1006,price:8.88,pipSize:2});
    useMarketStore.getState().setHistoricalTicks([{time:1000,price:1},{time:1005,price:1.05},{time:1007,price:1.07}],1);
    const state=useMarketStore.getState();
    expect(state.ticks.map(t=>t.time)).toEqual([1000,1005,1006,1007]);
    expect(state.ticks.find(t=>t.time===1005)?.price).toBe(9.99);
    expect(state.pendingLiveTicks).toEqual([]);
  });
});
