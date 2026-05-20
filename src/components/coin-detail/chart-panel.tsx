"use client";

import { useState } from "react";
import { PriceChart } from "@/components/price-chart";
import { TimeframeTabs } from "@/components/timeframe-tabs";

export function ChartPanel({ coinId }: { coinId: string }) {
  const [timeframe, setTimeframe] = useState("7d");
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <TimeframeTabs value={timeframe} onChange={setTimeframe} />
      </div>
      <PriceChart coinId={coinId} timeframe={timeframe} />
    </div>
  );
}
