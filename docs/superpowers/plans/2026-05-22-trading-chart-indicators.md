# Trading Chart with TA Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a crypto.com-style trading chart to the coin detail page with selectable granularity from 1 second (real time) up to 1 year, plus TA indicators, behind a non-destructive Simple/Pro toggle.

**Architecture:** Candle data comes from Binance public klines REST (`1s`→`1M` intervals) with a CoinGecko OHLC fallback for non-Binance coins. Live updates use a direct browser→Binance WebSocket while the chart is mounted. Indicators are pure client-side functions over the OHLCV array. Rendering uses lightweight-charts v5 multi-pane (price + volume + RSI + MACD).

**Tech Stack:** Next.js 16 (App Router), TypeScript, lightweight-charts ^5.2.0, ioredis, vitest, Playwright, next-intl.

**Local env note:** every bash step must prefix node/npm with the nvm path:
`export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"`
`npx tsc --noEmit` and `npm run build` hang locally (SWC bug) — do NOT run them; rely on vitest + the server build.

---

### Task 1: Indicator math library

**Files:**
- Create: `src/lib/indicators.ts`
- Test: `tests/indicators.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/indicators.test.ts
import { describe, it, expect } from "vitest";
import { sma, ema, bollinger, rsi, macd } from "@/lib/indicators";

describe("sma", () => {
  it("averages over the window, null before the window fills", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe("ema", () => {
  it("seeds with the SMA of the first window then smooths", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBeCloseTo(2, 6);          // seed = sma(1,2,3)
    expect(out[3]).toBeCloseTo(3, 6);          // 4*0.5 + 2*0.5
    expect(out[4]).toBeCloseTo(4, 6);          // 5*0.5 + 3*0.5
  });
});

describe("bollinger", () => {
  it("returns mid/upper/lower with k*stddev band", () => {
    const b = bollinger([2, 4, 6, 8, 10], 5, 2);
    expect(b.mid[4]).toBeCloseTo(6, 6);
    // population stddev of [2,4,6,8,10] = sqrt(8) ≈ 2.828427
    expect(b.upper[4]).toBeCloseTo(6 + 2 * Math.sqrt(8), 6);
    expect(b.lower[4]).toBeCloseTo(6 - 2 * Math.sqrt(8), 6);
    expect(b.mid[3]).toBeNull();
  });
});

describe("rsi", () => {
  it("is 100 when all changes are gains", () => {
    const out = rsi([1, 2, 3, 4, 5, 6], 3);
    expect(out[0]).toBeNull();
    expect(out[out.length - 1]).toBeCloseTo(100, 6);
  });
  it("sits at 50 for a perfectly alternating series after warmup", () => {
    const out = rsi([10, 11, 10, 11, 10, 11, 10, 11], 2);
    expect(out[out.length - 1]).toBeGreaterThan(0);
    expect(out[out.length - 1]).toBeLessThan(100);
  });
});

describe("macd", () => {
  it("returns macd/signal/histogram aligned to input length", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const m = macd(closes, 12, 26, 9);
    expect(m.macd).toHaveLength(60);
    expect(m.signal).toHaveLength(60);
    expect(m.histogram).toHaveLength(60);
    // steady uptrend → macd line positive once defined
    const last = m.macd[59]!;
    expect(last).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx vitest run tests/indicators.test.ts`
Expected: FAIL — `Cannot find module '@/lib/indicators'`.

- [ ] **Step 3: Implement `src/lib/indicators.ts`**

```ts
// All functions take a numeric series (typically closes) and return an
// equal-length array with `null` where the value is not yet defined.

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with SMA of the first `period` values.
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function bollinger(
  values: number[],
  period: number,
  k: number,
): { mid: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i]!;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - m) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  }
  return { mid, upper, lower };
}

export function rsi(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d >= 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(
  values: number[],
  fast: number,
  slow: number,
  signalPeriod: number,
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: (number | null)[] = values.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i]! - emaSlow[i]! : null,
  );
  // Signal = EMA of the defined portion of the MACD line, re-aligned to length.
  const firstDefined = macdLine.findIndex((v) => v !== null);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  if (firstDefined !== -1) {
    const defined = macdLine.slice(firstDefined).map((v) => v as number);
    const sig = ema(defined, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[firstDefined + i] = sig[i];
  }
  const histogram: (number | null)[] = values.map((_, i) =>
    macdLine[i] !== null && signal[i] !== null ? macdLine[i]! - signal[i]! : null,
  );
  return { macd: macdLine, signal, histogram };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx vitest run tests/indicators.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/indicators.ts tests/indicators.test.ts
git commit -m "feat(chart): TA indicator math (sma/ema/bollinger/rsi/macd)"
```

---

### Task 2: Chart interval config + Binance klines fetcher

**Files:**
- Create: `src/lib/chart-intervals.ts`
- Create: `src/lib/binance-klines.ts`
- Test: `tests/binance-klines.test.ts`

- [ ] **Step 1: Create `src/lib/chart-intervals.ts`** (no test — pure config)

```ts
// Timeframe button → Binance kline interval + how many candles to request.
// Binance caps a single klines request at 1000 candles.
export type Timeframe =
  | "1s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M" | "1y";

export const TIMEFRAMES: { key: Timeframe; label: string; interval: string; limit: number }[] = [
  { key: "1s", label: "1S", interval: "1s", limit: 1000 },
  { key: "1m", label: "1m", interval: "1m", limit: 1000 },
  { key: "5m", label: "5m", interval: "5m", limit: 1000 },
  { key: "15m", label: "15m", interval: "15m", limit: 1000 },
  { key: "1h", label: "1H", interval: "1h", limit: 720 },
  { key: "4h", label: "4H", interval: "4h", limit: 720 },
  { key: "1d", label: "1D", interval: "1d", limit: 365 },
  { key: "1w", label: "1W", interval: "1w", limit: 260 },
  { key: "1M", label: "1M", interval: "1M", limit: 120 },
  { key: "1y", label: "1Y", interval: "1d", limit: 365 },
];

// Allowlist of Binance intervals we will proxy (route validation).
export const ALLOWED_INTERVALS = new Set([
  "1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M",
]);

// Intervals coarse enough to be worth caching in Redis (seconds of TTL).
export const CACHEABLE_INTERVAL_TTL: Record<string, number> = {
  "1h": 60, "4h": 300, "1d": 600, "1w": 1800, "1M": 3600,
};
```

- [ ] **Step 2: Write failing test for normalization**

```ts
// tests/binance-klines.test.ts
import { describe, it, expect } from "vitest";
import { parseKline, type OHLCV } from "@/lib/binance-klines";

describe("parseKline", () => {
  it("maps a Binance kline tuple to OHLCV with time in seconds", () => {
    // [openTime, open, high, low, close, volume, closeTime, ...]
    const tuple = [
      1700000000000, "100.5", "110.0", "99.0", "105.25", "12.5",
      1700000059999, "0", 0, "0", "0", "0",
    ];
    const out: OHLCV = parseKline(tuple);
    expect(out).toEqual({
      time: 1700000000,
      open: 100.5,
      high: 110,
      low: 99,
      close: 105.25,
      volume: 12.5,
    });
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx vitest run tests/binance-klines.test.ts`
Expected: FAIL — `Cannot find module '@/lib/binance-klines'`.

- [ ] **Step 4: Implement `src/lib/binance-klines.ts`**

```ts
export type OHLCV = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const BINANCE_BASE = "https://api.binance.com";

export function parseKline(tuple: unknown): OHLCV {
  const t = tuple as (string | number)[];
  return {
    time: Math.floor(Number(t[0]) / 1000),
    open: Number(t[1]),
    high: Number(t[2]),
    low: Number(t[3]),
    close: Number(t[4]),
    volume: Number(t[5]),
  };
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<OHLCV[]> {
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${encodeURIComponent(
    symbol,
  )}&interval=${encodeURIComponent(interval)}&limit=${Math.min(limit, 1000)}`;
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`binance klines ${res.status}: ${body.slice(0, 200)}`);
  }
  const raw = (await res.json()) as unknown[];
  if (!Array.isArray(raw)) throw new Error("binance klines: not an array");
  return raw.map(parseKline);
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx vitest run tests/binance-klines.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src/lib/chart-intervals.ts src/lib/binance-klines.ts tests/binance-klines.test.ts
git commit -m "feat(chart): Binance klines fetcher + timeframe config"
```

---

### Task 3: CoinGecko OHLC fallback

**Files:**
- Modify: `src/lib/coingecko.ts` (add `fetchOhlc` near `fetchMarketChart`, ~line 240)
- Test: `tests/coingecko-ohlc.test.ts`

- [ ] **Step 1: Write failing test for the parser**

```ts
// tests/coingecko-ohlc.test.ts
import { describe, it, expect } from "vitest";
import { parseOhlc } from "@/lib/coingecko";

describe("parseOhlc", () => {
  it("maps [ms,o,h,l,c] rows to OHLCV with volume 0 and time in seconds", () => {
    const raw = [
      [1700000000000, 100, 110, 95, 105],
      [1700086400000, 105, 120, 104, 118],
    ];
    expect(parseOhlc(raw)).toEqual([
      { time: 1700000000, open: 100, high: 110, low: 95, close: 105, volume: 0 },
      { time: 1700086400, open: 105, high: 120, low: 104, close: 118, volume: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx vitest run tests/coingecko-ohlc.test.ts`
Expected: FAIL — `parseOhlc is not a function`.

- [ ] **Step 3: Add to `src/lib/coingecko.ts`** (import the type at top, add fns after `fetchMarketChart`)

At the top of the file, add the import:

```ts
import type { OHLCV } from "@/lib/binance-klines";
```

After `fetchMarketChart` (~line 245), add:

```ts
export function parseOhlc(raw: unknown): OHLCV[] {
  if (!Array.isArray(raw)) throw new Error("coingecko ohlc: not an array");
  return (raw as unknown[]).map((row) => {
    const r = row as number[];
    return {
      time: Math.floor(Number(r[0]) / 1000),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: 0,
    };
  });
}

// CoinGecko OHLC candles (no volume). days ∈ {1,7,14,30,90,180,365,"max"}.
export async function fetchOhlc(id: string, days: number | "max"): Promise<OHLCV[]> {
  const raw = await cgFetch(`/coins/${encodeURIComponent(id)}/ohlc`, {
    vs_currency: "usd",
    days: String(days),
  });
  return parseOhlc(raw);
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx vitest run tests/coingecko-ohlc.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/coingecko.ts tests/coingecko-ohlc.test.ts
git commit -m "feat(chart): CoinGecko OHLC fallback fetcher"
```

---

### Task 4: Klines API route

**Files:**
- Create: `src/app/api/coins/[id]/klines/route.ts`

(No unit test — exercised by e2e in Task 9. Follows the existing `history/route.ts` pattern.)

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchKlines } from "@/lib/binance-klines";
import { fetchOhlc } from "@/lib/coingecko";
import { CG_TO_BINANCE } from "@/lib/live/binance-mapping";
import { ALLOWED_INTERVALS, CACHEABLE_INTERVAL_TTL } from "@/lib/chart-intervals";

export const dynamic = "force-dynamic";

// Maps a Binance interval to a CoinGecko `days` window for the fallback path.
function fallbackDays(interval: string): number {
  switch (interval) {
    case "1s": case "1m": case "5m": case "15m": return 1;
    case "1h": return 7;
    case "4h": return 30;
    case "1d": return 365;
    default: return 365;
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const interval = url.searchParams.get("interval") ?? "1h";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "500") || 500, 1000);

  if (!/^[a-z0-9-]+$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (!ALLOWED_INTERVALS.has(interval)) {
    return NextResponse.json({ error: "invalid interval" }, { status: 400 });
  }

  const symbol = CG_TO_BINANCE[id];
  const cacheKey = `coin:klines:${id}:${interval}:${limit}`;
  const ttl = CACHEABLE_INTERVAL_TTL[interval];

  // Try cache for coarse intervals only.
  if (symbol && ttl) {
    try {
      if (redis.status === "wait" || redis.status === "end") await redis.connect();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json(
          { source: "binance", candles: JSON.parse(cached) },
          { headers: { "x-cache": "hit" } },
        );
      }
    } catch {
      // ignore — fall through
    }
  }

  if (symbol) {
    try {
      const candles = await fetchKlines(symbol, interval, limit);
      if (ttl) {
        try {
          await redis.set(cacheKey, JSON.stringify(candles), "EX", ttl);
        } catch {
          // best-effort
        }
      }
      return NextResponse.json({ source: "binance", candles }, { headers: { "x-cache": "miss" } });
    } catch {
      // fall through to CoinGecko fallback
    }
  }

  // Fallback: CoinGecko OHLC (coarser, no volume).
  try {
    const candles = await fetchOhlc(id, fallbackDays(interval));
    return NextResponse.json({ source: "coingecko", candles });
  } catch (err) {
    return NextResponse.json(
      { error: `fetch_failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Smoke the route locally**

Run the dev server in the background, then:
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
curl -s 'http://localhost:3000/api/coins/bitcoin/klines?interval=1h&limit=10' | head -c 300
```
Expected: JSON `{"source":"binance","candles":[{"time":...,"open":...}]}`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/coins/[id]/klines/route.ts
git commit -m "feat(chart): /api/coins/[id]/klines route (Binance + CoinGecko fallback)"
```

---

### Task 5: i18n keys (10 locales)

**Files:**
- Modify: `messages/{de,en,es,fr,ja,ko,pt-BR,ru,tr,zh-CN}.json` — add keys to the `detail` object.

- [ ] **Step 1: Add keys to each locale's `detail` block**

`en.json` (English reference):
```json
"simple": "Simple",
"pro": "Pro",
"candles": "Candles",
"line": "Line",
"indicators": "Indicators",
"ma": "MA",
"ema": "EMA",
"bollinger": "Bollinger",
"rsi": "RSI",
"macd": "MACD",
"volumePane": "Volume",
"reducedGranularity": "Limited data — this coin isn't on Binance, showing daily candles"
```

`ru.json` (Russian):
```json
"simple": "Просто",
"pro": "Про",
"candles": "Свечи",
"line": "Линия",
"indicators": "Индикаторы",
"ma": "MA",
"ema": "EMA",
"bollinger": "Боллинджер",
"rsi": "RSI",
"macd": "MACD",
"volumePane": "Объём",
"reducedGranularity": "Ограниченные данные — монеты нет на Binance, показаны дневные свечи"
```

For the remaining 8 locales (de, es, fr, ja, ko, pt-BR, tr, zh-CN) use the same keys; translate `simple/pro/candles/line/indicators/volumePane/reducedGranularity` and keep `ma/ema/bollinger/rsi/macd` as their standard uppercase abbreviations. Translations:

- **de:** simple "Einfach", pro "Pro", candles "Kerzen", line "Linie", indicators "Indikatoren", volumePane "Volumen", reducedGranularity "Begrenzte Daten – diese Münze ist nicht auf Binance, zeige Tageskerzen"
- **es:** "Simple", "Pro", "Velas", "Línea", "Indicadores", "Volumen", "Datos limitados: esta moneda no está en Binance, mostrando velas diarias"
- **fr:** "Simple", "Pro", "Bougies", "Ligne", "Indicateurs", "Volume", "Données limitées : cette pièce n'est pas sur Binance, affichage des bougies journalières"
- **ja:** "シンプル", "プロ", "ローソク足", "ライン", "指標", "出来高", "データ制限 — この通貨はBinance未対応のため日足を表示"
- **ko:** "간단", "프로", "캔들", "라인", "지표", "거래량", "제한된 데이터 — 이 코인은 Binance에 없어 일봉을 표시합니다"
- **pt-BR:** "Simples", "Pro", "Velas", "Linha", "Indicadores", "Volume", "Dados limitados — esta moeda não está na Binance, mostrando velas diárias"
- **tr:** "Basit", "Pro", "Mumlar", "Çizgi", "Göstergeler", "Hacim", "Sınırlı veri — bu coin Binance'te yok, günlük mumlar gösteriliyor"
- **zh-CN:** "简单", "专业", "K线", "折线", "指标", "成交量", "数据有限 — 该币种不在 Binance，显示日线"

- [ ] **Step 2: Validate every locale file is still valid JSON**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
for f in messages/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))" && echo "OK $f"; done
```
Expected: `OK messages/...` for all 10 files, no parse errors.

- [ ] **Step 3: Commit**

```bash
git add messages/*.json
git commit -m "i18n(chart): trading chart + indicator labels in 10 locales"
```

---

### Task 6: TradingChart component

**Files:**
- Create: `src/components/coin-detail/trading-chart.tsx`

This is the largest unit. It owns: fetching candles, rendering the candlestick/line price series, a volume histogram pane, RSI + MACD panes, indicator overlays (MA/EMA/Bollinger), the timeframe row, the candle/line toggle, the indicator menu, and the live Binance WebSocket.

- [ ] **Step 1: Create the component**

```tsx
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
import { CG_TO_BINANCE } from "@/lib/live/binance-mapping";
import { sma, ema, bollinger, rsi, macd } from "@/lib/indicators";
import type { OHLCV } from "@/lib/binance-klines";

const UP = "#30B658";
const DOWN = "#E55C5C";
const ORANGE = "#F7931A";
const GRID = "#2A2932";
const TEXT = "#9C99A6";

type IndicatorKey = "ma" | "ema" | "bollinger" | "rsi" | "macd";

export function TradingChart({ coinId }: { coinId: string }) {
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

  const [tf, setTf] = useState<Timeframe>("1h");
  const [type, setType] = useState<"candles" | "line">("candles");
  const [active, setActive] = useState<Set<IndicatorKey>>(new Set(["ma"]));
  const [source, setSource] = useState<"binance" | "coingecko" | null>(null);
  const [loading, setLoading] = useState(true);

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
      crosshair: { mode: 1 },
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
      if (lineRef.current) { chart.removeSeries(lineRef.current); lineRef.current = null; }
      if (!candleRef.current) {
        candleRef.current = chart.addSeries(CandlestickSeries, {
          upColor: UP, downColor: DOWN, borderVisible: false,
          wickUpColor: UP, wickDownColor: DOWN,
        }, 0);
      }
      candleRef.current.setData(
        data.map((d) => ({ time: d.time as Time, open: d.open, high: d.high, low: d.low, close: d.close })),
      );
    } else {
      if (candleRef.current) { chart.removeSeries(candleRef.current); candleRef.current = null; }
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
      data.map((d) => ({
        time: d.time as Time,
        value: d.volume,
        color: d.close >= d.open ? "rgba(48,182,88,0.5)" : "rgba(229,92,92,0.5)",
      })),
    );

    const lineData = (vals: (number | null)[], color: string, pane: number) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane);
      s.setData(
        vals.map((v, i) => ({ time: data[i].time as Time, value: v })).filter((p) => p.value !== null) as { time: Time; value: number }[],
      );
      return s;
    };

    // Overlays on price pane (0).
    if (active.has("ma")) overlayRefs.current.push(lineData(sma(closes, 20), "#5B8DEF", 0));
    if (active.has("ema")) overlayRefs.current.push(lineData(ema(closes, 50), "#E0A93B", 0));
    if (active.has("bollinger")) {
      const b = bollinger(closes, 20, 2);
      overlayRefs.current.push(lineData(b.upper, "#8A87A0", 0));
      overlayRefs.current.push(lineData(b.mid, "#56535F", 0));
      overlayRefs.current.push(lineData(b.lower, "#8A87A0", 0));
    }

    // RSI / MACD in their own panes (2, 3 — created on demand).
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

  // Fetch on coin / timeframe change, then open the live WS.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const conf = TIMEFRAMES.find((f) => f.key === tf)!;
    fetch(`/api/coins/${encodeURIComponent(coinId)}/klines?interval=${conf.interval}&limit=${conf.limit}`)
      .then((r) => r.json())
      .then((res: { source: "binance" | "coingecko"; candles: OHLCV[] }) => {
        if (cancelled) return;
        dataRef.current = res.candles;
        setSource(res.source);
        redraw();
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });

    // Live updates via direct Binance WS (Binance-listed coins only).
    const symbol = CG_TO_BINANCE[coinId];
    if (symbol) {
      const ws = new WebSocket(
        `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${conf.interval}`,
      );
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        const k = JSON.parse(ev.data).k;
        if (!k) return;
        const candle: OHLCV = {
          time: Math.floor(k.t / 1000),
          open: Number(k.o), high: Number(k.h), low: Number(k.l),
          close: Number(k.c), volume: Number(k.v),
        };
        const arr = dataRef.current;
        const last = arr[arr.length - 1];
        if (last && last.time === candle.time) arr[arr.length - 1] = candle;
        else arr.push(candle);
        // Update the live price/volume series in place (cheap path).
        if (type === "candles") candleRef.current?.update({ time: candle.time as Time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
        else lineRef.current?.update({ time: candle.time as Time, value: candle.close });
        volRef.current?.update({ time: candle.time as Time, value: candle.volume, color: candle.close >= candle.open ? "rgba(48,182,88,0.5)" : "rgba(229,92,92,0.5)" });
      };
    }

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinId, tf]);

  // Redraw indicator/type changes without refetching.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { redraw(); }, [type, active]);

  const toggle = (k: IndicatorKey) =>
    setActive((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const indicatorKeys: IndicatorKey[] = ["ma", "ema", "bollinger", "rsi", "macd"];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {TIMEFRAMES.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setTf(f.key)}
            className={
              "num text-[12px] uppercase tracking-wider px-3 py-1.5 rounded-md font-medium transition-all " +
              (tf === f.key ? "bg-foreground text-bg" : "text-muted border border-hairline hover:text-foreground")
            }
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1 mb-4">
        <button type="button" onClick={() => setType("candles")}
          className={"text-[12px] px-3 py-1.5 rounded-md " + (type === "candles" ? "bg-foreground text-bg" : "text-muted border border-hairline")}>
          {t("candles")}
        </button>
        <button type="button" onClick={() => setType("line")}
          className={"text-[12px] px-3 py-1.5 rounded-md " + (type === "line" ? "bg-foreground text-bg" : "text-muted border border-hairline")}>
          {t("line")}
        </button>
        <span className="mx-2 text-muted text-[11px] uppercase tracking-wider">{t("indicators")}</span>
        {indicatorKeys.map((k) => (
          <button key={k} type="button" onClick={() => toggle(k)}
            className={"text-[12px] px-2.5 py-1.5 rounded-md border " + (active.has(k) ? "border-[var(--color-accent,#F7931A)] text-foreground" : "border-hairline text-muted hover:text-foreground")}>
            {t(k)}
          </button>
        ))}
      </div>
      {source === "coingecko" && (
        <p className="text-[11px] text-muted mb-2">{t("reducedGranularity")}</p>
      )}
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
```

- [ ] **Step 2: Lint the file**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx eslint src/components/coin-detail/trading-chart.tsx`
Expected: no errors (warnings about exhaustive-deps are suppressed inline).

- [ ] **Step 3: Commit**

```bash
git add src/components/coin-detail/trading-chart.tsx
git commit -m "feat(chart): TradingChart — candles/line, volume, MA/EMA/Bollinger/RSI/MACD, live WS"
```

---

### Task 7: Simple/Pro toggle in ChartPanel

**Files:**
- Modify: `src/components/coin-detail/chart-panel.tsx`

- [ ] **Step 1: Replace the component body**

```tsx
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
          <button type="button" onClick={() => setMode("simple")}
            className={"text-[12px] uppercase tracking-wider px-3.5 py-1.5 rounded-md font-medium transition-all " + (mode === "simple" ? "bg-foreground text-bg" : "text-muted border border-hairline hover:text-foreground")}>
            {t("simple")}
          </button>
          <button type="button" onClick={() => setMode("pro")}
            className={"text-[12px] uppercase tracking-wider px-3.5 py-1.5 rounded-md font-medium transition-all " + (mode === "pro" ? "bg-foreground text-bg" : "text-muted border border-hairline hover:text-foreground")}>
            {t("pro")}
          </button>
        </div>
        {mode === "simple" && (
          <div className="flex flex-wrap items-center gap-1">
            {FRAMES.map((f) => {
              const activeF = timeframe === f.key;
              return (
                <button key={f.key} type="button" onClick={() => setTimeframe(f.key)}
                  className={"num text-[12px] uppercase tracking-wider px-3.5 py-1.5 rounded-md font-medium transition-all " + (activeF ? "bg-foreground text-bg" : "text-muted border border-hairline hover:text-foreground")}>
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
```

- [ ] **Step 2: Lint**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx eslint src/components/coin-detail/chart-panel.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/coin-detail/chart-panel.tsx
git commit -m "feat(chart): Simple/Pro toggle on coin detail chart panel"
```

---

### Task 8: e2e smoke for Pro chart

**Files:**
- Create: `tests/e2e/trading-chart.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";

test("pro trading chart renders candles + timeframe buttons", async ({ page }) => {
  await page.goto("/en/coin/bitcoin");
  await page.getByRole("button", { name: "Pro", exact: true }).click();
  // Timeframe buttons 1S and 1Y are present.
  await expect(page.getByRole("button", { name: "1S", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "1Y", exact: true })).toBeVisible();
  // lightweight-charts renders into a <canvas>.
  await expect(page.locator("canvas").first()).toBeVisible();
});
```

- [ ] **Step 2: Run against a running server**

Run (server must be up at the Playwright baseURL):
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npx playwright test tests/e2e/trading-chart.spec.ts
```
Expected: 1 passed. (If run locally where the server isn't up, defer to server CI.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/trading-chart.spec.ts
git commit -m "test(e2e): pro trading chart — candles + 1S/1Y timeframe buttons"
```

---

### Task 9: Full test sweep

- [ ] **Step 1: Run the whole vitest suite**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx vitest run`
Expected: all prior tests (97) + new ones (Task 1: 5, Task 2: 1, Task 3: 1) pass.

- [ ] **Step 2: Final commit if anything pending**

```bash
git status
```
Expected: clean tree (everything committed in prior tasks).

---

## Notes for the implementer

- **Do not** run `npx tsc --noEmit` or `npm run build` locally — they hang (SWC bug on this machine). Type errors surface on the server build.
- lightweight-charts v5 multi-pane: the 3rd arg to `addSeries(Type, opts, paneIndex)` is the pane index; panes are auto-created. Volume = pane 1, RSI = pane 2, MACD shares the next pane.
- The browser→Binance WS needs no API key and no CORS handling. If the user's network blocks `stream.binance.com`, candles still render statically; only live ticks are lost — acceptable per spec.
- Keep `mode` default = `"simple"` so the existing coin-detail e2e smoke (asserts a canvas + USD price) stays green.
