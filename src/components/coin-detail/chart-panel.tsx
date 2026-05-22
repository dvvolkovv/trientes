"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PriceChart } from "@/components/price-chart";
import { TradingChart } from "@/components/coin-detail/trading-chart";

const FRAMES: Array<{ key: string; label: string }> = [
  { key: "1d", label: "1D" },
  { key: "7d", label: "7D" },
  { key: "1m", label: "1M" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
];

export function ChartPanel({ coinId }: { coinId: string }) {
  const t = useTranslations("detail");
  const [mode, setMode] = useState<"simple" | "pro">("simple");
  const [timeframe, setTimeframe] = useState("7d");

  return (
    <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
      <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode("simple")}
            className={
              "text-[12px] uppercase tracking-wider px-3.5 py-1.5 rounded-md font-medium transition-all " +
              (mode === "simple" ? "bg-foreground text-bg" : "text-muted border border-hairline hover:text-foreground")
            }
          >
            {t("simple")}
          </button>
          <button
            type="button"
            onClick={() => setMode("pro")}
            className={
              "text-[12px] uppercase tracking-wider px-3.5 py-1.5 rounded-md font-medium transition-all " +
              (mode === "pro" ? "bg-foreground text-bg" : "text-muted border border-hairline hover:text-foreground")
            }
          >
            {t("pro")}
          </button>
        </div>
        {mode === "simple" && (
          <div className="flex flex-wrap items-center gap-1">
            {FRAMES.map((f) => {
              const activeF = timeframe === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setTimeframe(f.key)}
                  className={
                    "num text-[12px] uppercase tracking-wider px-3.5 py-1.5 rounded-md font-medium transition-all " +
                    (activeF ? "bg-foreground text-bg" : "text-muted border border-hairline hover:text-foreground")
                  }
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {mode === "simple" ? (
        <div className="bg-bg-tint border border-hairline rounded-md h-[240px] md:h-[360px] overflow-hidden">
          <PriceChart coinId={coinId} timeframe={timeframe} />
        </div>
      ) : (
        <TradingChart coinId={coinId} />
      )}
    </div>
  );
}
