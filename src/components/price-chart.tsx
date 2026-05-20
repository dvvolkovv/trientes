"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";

type Point = { time: number; value: number };

export function PriceChart({ coinId, timeframe }: { coinId: string; timeframe: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const { resolvedTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("detail");

  // Init chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 360,
      layout: {
        background: { color: "transparent" },
        textColor: resolvedTheme === "dark" ? "#cbd5e1" : "#475569",
      },
      grid: {
        vertLines: { color: resolvedTheme === "dark" ? "#1e293b" : "#e2e8f0" },
        horzLines: { color: resolvedTheme === "dark" ? "#1e293b" : "#e2e8f0" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#22c55e",
      topColor: "rgba(34,197,94,0.4)",
      bottomColor: "rgba(34,197,94,0.0)",
      lineWidth: 2,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);

  // Fetch data on coin / timeframe change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/coins/${encodeURIComponent(coinId)}/history?timeframe=${encodeURIComponent(timeframe)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((points: Point[]) => {
        if (cancelled || !seriesRef.current) return;
        const lineColor = points.length > 0 && points[points.length - 1].value >= points[0].value
          ? "#22c55e"
          : "#ef4444";
        seriesRef.current.applyOptions({
          lineColor,
          topColor: lineColor === "#22c55e" ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)",
          bottomColor: lineColor === "#22c55e" ? "rgba(34,197,94,0.0)" : "rgba(239,68,68,0.0)",
        });
        seriesRef.current.setData(points.map((p) => ({ time: p.time as Time, value: p.value })));
        chartRef.current?.timeScale().fitContent();
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "fetch failed");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [coinId, timeframe]);

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
          {t("loading")}
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-red-500">{error}</div>
      )}
    </div>
  );
}
