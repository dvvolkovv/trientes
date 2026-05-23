"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useTranslations } from "next-intl";
import { formatPrice, formatPercent } from "@/lib/format";
import { summarizeSeries, type SeriesPoint, type SeriesSummary } from "@/lib/price-series";
import { baseTicker } from "@/lib/exchanges";

// Ledger palette (the site is dark-only) — matches the Pro TradingChart.
const UP = "#30B658";
const DOWN = "#E55C5C";
const FILL = {
  up: { top: "rgba(48,182,88,0.28)", bot: "rgba(48,182,88,0.0)" },
  down: { top: "rgba(229,92,92,0.28)", bot: "rgba(229,92,92,0.0)" },
};
const GRID = "#211F29";
const TEXT = "#9C99A6";

export function PriceChart({
  coinId,
  symbol,
  timeframe,
}: {
  coinId: string;
  symbol: string;
  timeframe: string;
}) {
  const t = useTranslations("detail");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  const [summary, setSummary] = useState<SeriesSummary | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const [hover, setHover] = useState<{ time: number; value: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Create the chart once. Pan/zoom are locked: this is the "simple" view,
  // and locking keeps it from being scrolled into an empty/confusing state. ----
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 340,
      layout: { background: { color: "transparent" }, textColor: TEXT, fontFamily: "inherit" },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        vertLine: { color: "#46434F", width: 1, labelBackgroundColor: "#312F3A" },
        horzLine: { color: "#46434F", labelBackgroundColor: "#312F3A" },
      },
      handleScale: false,
      handleScroll: false,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: UP,
      topColor: FILL.up.top,
      bottomColor: FILL.up.bot,
      lineWidth: 2,
      priceLineVisible: true,
      priceLineColor: "#46434F",
      lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    // Hover anywhere on the chart drives the header readout (price + date).
    chart.subscribeCrosshairMove((param) => {
      if (param.time === undefined || !seriesRef.current) {
        setHover(null);
        return;
      }
      const d = param.seriesData.get(seriesRef.current) as { value?: number } | undefined;
      if (d && typeof d.value === "number") setHover({ time: Number(param.time), value: d.value });
      else setHover(null);
    });

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        chartRef.current.timeScale().fitContent(); // refit so the line always fills the width
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // ---- Fetch history on coin / timeframe change ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHover(null);
    fetch(`/api/coins/${encodeURIComponent(coinId)}/history?timeframe=${encodeURIComponent(timeframe)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((points: SeriesPoint[]) => {
        if (cancelled || !seriesRef.current || !chartRef.current) return;
        const s = summarizeSeries(points);
        setSummary(s);
        const rising = s ? s.last >= s.first : true;
        seriesRef.current.applyOptions({
          lineColor: rising ? UP : DOWN,
          topColor: rising ? FILL.up.top : FILL.down.top,
          bottomColor: rising ? FILL.up.bot : FILL.down.bot,
        });
        seriesRef.current.setData(points.map((p) => ({ time: p.time as Time, value: p.value })));
        lastTimeRef.current = points.length ? points[points.length - 1].time : null;
        chartRef.current.timeScale().fitContent();
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

  // ---- Live last price from Binance (same source as the home-page ticks) ----
  useEffect(() => {
    const base = baseTicker(coinId, symbol);
    if (!base) return;
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${base.toLowerCase()}usdt@miniTicker`);
    ws.onmessage = (ev) => {
      let c: number | undefined;
      try {
        c = Number(JSON.parse(ev.data).c);
      } catch {
        return;
      }
      if (!Number.isFinite(c) || !c) return;
      setLive(c);
      // Nudge the line's tip to the live price (updates the last point in place).
      if (seriesRef.current && lastTimeRef.current != null) {
        seriesRef.current.update({ time: lastTimeRef.current as Time, value: c });
      }
    };
    return () => ws.close();
  }, [coinId, symbol]);

  // ---- Header readout: hovered point > live tick > last history point ----
  const displayed = hover?.value ?? live ?? summary?.last ?? null;
  const baseVal = summary?.first ?? null;
  const delta = displayed != null && baseVal != null ? displayed - baseVal : null;
  const deltaPct = delta != null && baseVal ? (delta / baseVal) * 100 : delta != null ? 0 : null;
  const up = (delta ?? 0) >= 0;
  const tfLabel = timeframe.toUpperCase();

  return (
    <div>
      {/* Header readout */}
      <div className="flex items-end justify-between gap-4 mb-4 flex-wrap">
        <div>
          <div className="num text-[28px] md:text-[34px] font-bold leading-none tracking-tight">
            {displayed != null ? formatPrice(displayed) : "—"}
          </div>
          <div className="flex items-center gap-2 mt-2 text-[13px] flex-wrap">
            <span className="num font-semibold" style={{ color: up ? UP : DOWN }}>
              {up ? "▲" : "▼"} {delta != null ? formatPrice(Math.abs(delta)) : "—"} · {formatPercent(deltaPct)}
            </span>
            <span className="text-muted text-[12px]">
              {hover ? new Date(hover.time * 1000).toLocaleString() : tfLabel}
            </span>
            {!hover && live != null && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: UP }} />
                {t("live")}
              </span>
            )}
          </div>
        </div>
        {summary && (
          <div className="num text-[12px] text-muted leading-relaxed text-right">
            <div>
              {t("high")}: <span className="text-foreground">{formatPrice(summary.max)}</span>
            </div>
            <div>
              {t("low")}: <span className="text-foreground">{formatPrice(summary.min)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="relative bg-bg-tint border border-hairline rounded-md overflow-hidden">
        <div ref={containerRef} className="w-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted pointer-events-none">
            {t("loading")}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-red-500">{error}</div>
        )}
      </div>
    </div>
  );
}
