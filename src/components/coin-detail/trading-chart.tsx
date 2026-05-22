"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useTranslations } from "next-intl";
import { TIMEFRAMES, type Timeframe } from "@/lib/chart-intervals";
import { EXCHANGES, exchangeSupports, baseTicker, type ExchangeId } from "@/lib/exchanges";
import { sma, ema, bollinger, rsi, macd } from "@/lib/indicators";
import type { OHLCV } from "@/lib/binance-klines";

const POLL_MS = 15_000; // non-Binance exchanges have no WS path — refresh by polling

const UP = "#30B658";
const DOWN = "#E55C5C";
const ORANGE = "#F7931A";
const GRID = "#2A2932";
const TEXT = "#9C99A6";
const VOL_UP = "rgba(48,182,88,0.5)";
const VOL_DOWN = "rgba(229,92,92,0.5)";

type IndicatorKey = "ma" | "ema" | "bollinger" | "rsi" | "macd";
const INDICATOR_KEYS: IndicatorKey[] = ["ma", "ema", "bollinger", "rsi", "macd"];

export function TradingChart({ coinId, symbol }: { coinId: string; symbol: string }) {
  const t = useTranslations("detail");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlayRefs = useRef<ISeriesApi<"Line">[]>([]);
  const paneSeriesRefs = useRef<ISeriesApi<"Line">[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const dataRef = useRef<OHLCV[]>([]);
  const typeRef = useRef<"candles" | "line">("candles");

  const [tf, setTf] = useState<Timeframe>("1h");
  const [exchange, setExchange] = useState<ExchangeId>("binance");
  const [type, setType] = useState<"candles" | "line">("candles");
  const [active, setActive] = useState<Set<IndicatorKey>>(new Set<IndicatorKey>(["ma"]));
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Keep the latest chart type readable from the long-lived WS closure.
  useEffect(() => {
    typeRef.current = type;
  }, [type]);

  // Push one candle into the chart in place (no fitContent — preserves zoom/pan).
  // Shared by the Binance WS stream and the poll loop for other exchanges.
  function pushCandle(candle: OHLCV) {
    const arr = dataRef.current;
    const last = arr[arr.length - 1];
    if (last && last.time === candle.time) arr[arr.length - 1] = candle;
    else if (!last || candle.time > last.time) arr.push(candle);
    const time = candle.time as Time;
    if (typeRef.current === "candles") {
      candleRef.current?.update({ time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    } else {
      lineRef.current?.update({ time, value: candle.close });
    }
    volRef.current?.update({ time, value: candle.volume, color: candle.close >= candle.open ? VOL_UP : VOL_DOWN });
  }

  // Switch exchange; if it can't serve the current timeframe, fall back to 1H.
  function selectExchange(id: ExchangeId) {
    setExchange(id);
    const conf = TIMEFRAMES.find((f) => f.key === tf)!;
    if (!exchangeSupports(id, conf.interval)) setTf("1h");
  }

  // Create the chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 460,
      layout: { background: { color: "transparent" }, textColor: TEXT },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true },
    });
    chartRef.current = chart;
    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      lineRef.current = null;
      volRef.current = null;
      overlayRefs.current = [];
      paneSeriesRefs.current = [];
    };
  }, []);

  // Recompute & redraw all series from dataRef + active indicators.
  function redraw() {
    const chart = chartRef.current;
    if (!chart) return;
    const data = dataRef.current;
    const closes = data.map((d) => d.close);

    // Clear previous indicator series.
    for (const s of overlayRefs.current) chart.removeSeries(s);
    for (const s of paneSeriesRefs.current) chart.removeSeries(s);
    overlayRefs.current = [];
    paneSeriesRefs.current = [];

    // Price series (candles or line).
    if (type === "candles") {
      if (lineRef.current) {
        chart.removeSeries(lineRef.current);
        lineRef.current = null;
      }
      if (!candleRef.current) {
        candleRef.current = chart.addSeries(
          CandlestickSeries,
          { upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN },
          0,
        );
      }
      candleRef.current.setData(
        data.map((d) => ({ time: d.time as Time, open: d.open, high: d.high, low: d.low, close: d.close })),
      );
    } else {
      if (candleRef.current) {
        chart.removeSeries(candleRef.current);
        candleRef.current = null;
      }
      if (!lineRef.current) {
        lineRef.current = chart.addSeries(LineSeries, { color: ORANGE, lineWidth: 2 }, 0);
      }
      lineRef.current.setData(data.map((d) => ({ time: d.time as Time, value: d.close })));
    }

    // Volume pane (pane 1).
    if (!volRef.current) {
      volRef.current = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" } }, 1);
    }
    volRef.current.setData(
      data.map((d) => ({ time: d.time as Time, value: d.volume, color: d.close >= d.open ? VOL_UP : VOL_DOWN })),
    );

    const lineData = (vals: (number | null)[], color: string, pane: number) => {
      const s = chart.addSeries(
        LineSeries,
        { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
        pane,
      );
      s.setData(
        vals
          .map((v, i) => ({ time: data[i].time as Time, value: v }))
          .filter((p) => p.value !== null) as { time: Time; value: number }[],
      );
      return s;
    };

    // Overlays on the price pane (0).
    if (active.has("ma")) overlayRefs.current.push(lineData(sma(closes, 20), "#5B8DEF", 0));
    if (active.has("ema")) overlayRefs.current.push(lineData(ema(closes, 50), "#E0A93B", 0));
    if (active.has("bollinger")) {
      const b = bollinger(closes, 20, 2);
      overlayRefs.current.push(lineData(b.upper, "#8A87A0", 0));
      overlayRefs.current.push(lineData(b.mid, "#56535F", 0));
      overlayRefs.current.push(lineData(b.lower, "#8A87A0", 0));
    }

    // RSI / MACD in their own panes (assigned contiguously after volume).
    let pane = 2;
    if (active.has("rsi")) {
      paneSeriesRefs.current.push(lineData(rsi(closes, 14), "#C792EA", pane));
      pane++;
    }
    if (active.has("macd")) {
      const m = macd(closes, 12, 26, 9);
      paneSeriesRefs.current.push(lineData(m.macd, UP, pane));
      paneSeriesRefs.current.push(lineData(m.signal, ORANGE, pane));
    }

    chart.timeScale().fitContent();
  }

  // Fetch on coin / timeframe / exchange change, then start live updates.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const conf = TIMEFRAMES.find((f) => f.key === tf)!;
    const klinesUrl = `/api/coins/${encodeURIComponent(coinId)}/klines?interval=${conf.interval}&limit=${conf.limit}&exchange=${exchange}&symbol=${encodeURIComponent(symbol)}`;

    fetch(klinesUrl)
      .then((r) => r.json())
      .then((res: { source: string; candles: OHLCV[] }) => {
        if (cancelled) return;
        dataRef.current = res.candles ?? [];
        setSource(res.source);
        redraw();
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    // Live updates. Binance has a direct per-symbol WS; everyone else polls.
    // Derive the pair from the coin's own ticker so admin-added coins (Dash)
    // get live candles too. If the pair doesn't exist, the WS just stays quiet.
    const wsBase = baseTicker(coinId, symbol);
    if (exchange === "binance" && wsBase) {
      const ws = new WebSocket(
        `wss://stream.binance.com:9443/ws/${wsBase.toLowerCase()}usdt@kline_${conf.interval}`,
      );
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        let k: Record<string, string> | undefined;
        try {
          k = JSON.parse(ev.data).k;
        } catch {
          return;
        }
        if (!k) return;
        pushCandle({
          time: Math.floor(Number(k.t) / 1000),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v),
        });
      };
    }

    let poll: ReturnType<typeof setInterval> | null = null;
    if (exchange !== "binance") {
      poll = setInterval(() => {
        fetch(klinesUrl)
          .then((r) => r.json())
          .then((res: { candles?: OHLCV[] }) => {
            if (cancelled || !res.candles?.length) return;
            for (const c of res.candles.slice(-2)) pushCandle(c);
          })
          .catch(() => {});
      }, POLL_MS);
    }

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
      if (poll) clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinId, symbol, tf, exchange]);

  // Redraw on type / indicator changes without refetching.
  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, active]);

  const toggle = (k: IndicatorKey) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {EXCHANGES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            onClick={() => selectExchange(ex.id)}
            className={
              "text-[12px] px-3 py-1.5 rounded-md font-medium transition-all " +
              (exchange === ex.id
                ? "bg-accent text-accent-foreground"
                : "text-muted border border-hairline hover:text-foreground")
            }
          >
            {ex.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {TIMEFRAMES.map((f) => {
          const ok = exchangeSupports(exchange, f.interval);
          return (
            <button
              key={f.key}
              type="button"
              disabled={!ok}
              onClick={() => setTf(f.key)}
              className={
                "num text-[12px] uppercase tracking-wider px-3 py-1.5 rounded-md font-medium transition-all " +
                (!ok
                  ? "text-muted/40 border border-hairline cursor-not-allowed"
                  : tf === f.key
                    ? "bg-foreground text-bg"
                    : "text-muted border border-hairline hover:text-foreground")
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1 mb-4">
        <button
          type="button"
          onClick={() => setType("candles")}
          className={
            "text-[12px] px-3 py-1.5 rounded-md " +
            (type === "candles" ? "bg-foreground text-bg" : "text-muted border border-hairline")
          }
        >
          {t("candles")}
        </button>
        <button
          type="button"
          onClick={() => setType("line")}
          className={
            "text-[12px] px-3 py-1.5 rounded-md " +
            (type === "line" ? "bg-foreground text-bg" : "text-muted border border-hairline")
          }
        >
          {t("line")}
        </button>
        <span className="mx-2 text-muted text-[11px] uppercase tracking-wider">{t("indicators")}</span>
        {INDICATOR_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => toggle(k)}
            className={
              "text-[12px] px-2.5 py-1.5 rounded-md border transition-all " +
              (active.has(k)
                ? "border-accent text-foreground"
                : "border-hairline text-muted hover:text-foreground")
            }
          >
            {t(k)}
          </button>
        ))}
      </div>
      {source === "coingecko" && <p className="text-[11px] text-muted mb-2">{t("reducedGranularity")}</p>}
      <div className="relative bg-bg-tint border border-hairline rounded-md overflow-hidden">
        <div ref={containerRef} className="w-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted pointer-events-none">
            {t("loading")}
          </div>
        )}
      </div>
    </div>
  );
}
