"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useTranslations } from "next-intl";
import {
  DEX_CANDLES_API,
  DEX_CANDLE_INTERVALS,
  parseDexCandles,
  parseDexPairs,
  type DexCandleInterval,
  type DexCandles,
  type DexPair,
} from "@/lib/dex-candles";

const UP = "#30B658";
const DOWN = "#E55C5C";
const GRID = "#2A2932";
const TEXT = "#9C99A6";
const VOL_UP = "rgba(48,182,88,0.5)";
const VOL_DOWN = "rgba(229,92,92,0.5)";

/** Ряд обновляется блоками сети: раз в полминуты достаточно. */
const POLL_MS = 30_000;

/**
 * Свечи нашего обмена в карточке монеты. Рисуем только там, где ряд у службы
 * действительно есть: список пар она публикует сама, и пара, которой в нём
 * нет, не превращается ни в пустой график, ни в сообщение об ошибке — блока
 * просто не будет.
 */
export function DexCandlesChart({ pairKey }: { pairKey: string }) {
  const t = useTranslations("coinCard.dexChart");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const [pair, setPair] = useState<DexPair | null>(null);
  const [missing, setMissing] = useState(false);
  const [interval, setIntervalKey] = useState<DexCandleInterval>("1h");
  const [data, setData] = useState<DexCandles | null>(null);
  const [failed, setFailed] = useState(false);

  // Есть ли у службы ряд этой пары.
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(DEX_CANDLES_API, { signal: ac.signal, cache: "no-store" });
        const found = parseDexPairs(await res.json()).find((p) => p.key === pairKey) ?? null;
        setPair(found);
        setMissing(!found);
      } catch {
        if (!ac.signal.aborted) setMissing(true);
      }
    })();
    return () => ac.abort();
  }, [pairKey]);

  // Сам ряд: при смене шага и дальше по кругу.
  useEffect(() => {
    if (!pair) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const res = await fetch(`${DEX_CANDLES_API}/${pair.key}/${interval}`, {
          signal: ac.signal,
          cache: "no-store",
        });
        const parsed = res.ok ? parseDexCandles(await res.json(), { pair, interval }) : null;
        if (ac.signal.aborted) return;
        setFailed(!parsed);
        if (parsed) setData(parsed);
      } catch {
        if (!ac.signal.aborted) setFailed(true);
      }
      if (!ac.signal.aborted) timer = setTimeout(load, POLL_MS);
    };
    void load();

    return () => {
      ac.abort();
      if (timer) clearTimeout(timer);
    };
  }, [pair, interval]);

  // График создаётся один раз на весь срок жизни блока.
  useEffect(() => {
    if (!pair || !containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 320,
      layout: { background: { color: "transparent" }, textColor: TEXT },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      handleScale: { axisPressedMouseMove: false },
    });
    chartRef.current = chart;
    candleRef.current = chart.addSeries(
      CandlestickSeries,
      { upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN },
      0,
    );
    volRef.current = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" } }, 1);

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
    };
  }, [pair]);

  // Данные в график.
  useEffect(() => {
    if (!data || !candleRef.current || !volRef.current) return;
    candleRef.current.setData(
      data.candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    volRef.current.setData(
      data.candles.map((c) => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? VOL_UP : VOL_DOWN,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  if (missing || !pair) return null;

  return (
    <section className="mt-6 border border-hairline rounded-md bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 className="num text-[12px] uppercase tracking-[0.15em] text-muted">
          {t("title", { pair: `${pair.base}/${pair.quote}` })}
        </h2>
        <div className="flex flex-wrap gap-1">
          {DEX_CANDLE_INTERVALS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setIntervalKey(key)}
              className={
                "num text-[11px] uppercase tracking-wider px-2 py-1 rounded-md transition-colors " +
                (key === interval
                  ? "bg-foreground text-bg"
                  : "text-muted border border-hairline hover:text-foreground")
              }
            >
              {key}
            </button>
          ))}
        </div>
      </div>
      {/* Что это за ряд — словами, а не намёком: цена здесь не сводный рынок. */}
      <p className="text-xs text-muted mb-3">{t("caption")}</p>
      <div ref={containerRef} className="w-full" />
      <p className="text-[11px] text-muted mt-2 num">
        {failed
          ? t("stale")
          : data?.block != null
            ? t("asOf", { block: data.block.toLocaleString("en-US") })
            : ""}
      </p>
    </section>
  );
}
