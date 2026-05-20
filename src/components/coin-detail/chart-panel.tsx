"use client";

import { useState } from "react";
import { PriceChart } from "@/components/price-chart";

const FRAMES: Array<{ key: string; label: string }> = [
  { key: "1d", label: "1D" },
  { key: "7d", label: "7D" },
  { key: "1m", label: "1M" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
];

export function ChartPanel({ coinId }: { coinId: string }) {
  const [timeframe, setTimeframe] = useState("7d");
  return (
    <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
      <div className="flex items-center gap-1 mb-6">
        {FRAMES.map((f) => {
          const active = timeframe === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setTimeframe(f.key)}
              className={
                "num text-[12px] uppercase tracking-wider px-3.5 py-1.5 rounded-md font-medium transition-all " +
                (active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted border border-hairline hover:text-foreground")
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>
      <div className="bg-bg-tint border border-hairline rounded-md h-[360px] overflow-hidden">
        <PriceChart coinId={coinId} timeframe={timeframe} />
      </div>
    </div>
  );
}
