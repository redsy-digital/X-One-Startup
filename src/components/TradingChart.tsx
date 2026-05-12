import React, { useMemo } from "react";
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from "recharts";
import { format } from "date-fns";

import { Candle } from "../types";

interface TradingChartProps {
  candles: Candle[];
  symbol: string;
}

export const TradingChart = ({ candles, symbol }: TradingChartProps) => {
  const chartData = useMemo(() => {
    return candles.map(c => ({
      ...c,
      formattedTime: format(new Date(c.time * 1000), "HH:mm:ss")
    }));
  }, [candles]);

  const minPrice = useMemo(() => candles.length > 0 ? Math.min(...candles.map(d => d.low)) * 0.9999 : 0, [candles]);
  const maxPrice = useMemo(() => candles.length > 0 ? Math.max(...candles.map(d => d.high)) * 1.0001 : 100, [candles]);

  return (
    <div className="w-full h-[300px] mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis 
            dataKey="formattedTime" 
            stroke="#94a3b8" 
            fontSize={10} 
            tickLine={false}
            axisLine={false}
          />
          <YAxis 
            domain={[minPrice, maxPrice]} 
            stroke="#94a3b8" 
            fontSize={10} 
            tickLine={false}
            axisLine={false}
            tickFormatter={(val) => val.toFixed(2)}
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: "#111114", 
              border: "1px solid #27272a",
              borderRadius: "8px",
              fontSize: "12px"
            }}
            itemStyle={{ color: "#a855f7" }}
          />
          <Area 
            type="stepAfter" 
            dataKey="close" 
            stroke="#a855f7" 
            fillOpacity={1} 
            fill="url(#colorPrice)" 
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
