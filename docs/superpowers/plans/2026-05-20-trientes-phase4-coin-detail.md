# Trientes Phase 4: Coin Detail Page (`/[locale]/coin/[slug]`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Checkbox-tracked steps.

**Goal:** Public per-coin page with price chart (1D/7D/1M/1Y/All using lightweight-charts), English description (sanitized HTML, collapse if >500 chars), supply metrics, project links, and top-10 markets. Click a row in the listing → land on this page. Server-rendered with ISR 1h; chart data fetched lazily via API route.

**Decisions confirmed by user (2026-05-20):**
- Timeframes: 1D / 7D / 1M / 1Y / All
- Markets: top-10 by 24h USD volume, columns name/pair/price/volume
- Description: English HTML, sanitized with `sanitize-html`, collapse if >500 chars
- History caching: Redis only (Postgres `PriceHistory` deferred to Phase 7)
- Watchlist toggle: NOT in this phase (Phase 5)

**Reference spec:** `docs/superpowers/specs/2026-05-19-trientes-cmc-clone-design.md`.
**Working dir:** `/Users/dmitry/Coinmarketcap`. Server: `dv@85.192.25.242`.

**Constraints (carry from prior phases):**
- `npm` at `$HOME/.nvm/versions/node/v22.19.0/bin/` — set PATH in every bash invocation.
- Never `npm run build` or `tsc --noEmit` locally (macOS Tahoe SWC dlopen hang).
- Server lockfile drift: `git stash` before `git pull` on server.
- CoinGecko Free tier ~30 req/min — metadata-sync uses 1.5s spacing.

---

## File structure produced

```
prisma/migrations/<ts>_coin_meta/
src/
├── lib/
│   ├── coingecko.ts                   # +fetchCoinDetail, +fetchMarketChart, +fetchTickers, +parsers
│   ├── sync/orchestrator.ts           # +syncCoinMetadata (single coin), exported helper
│   ├── sync/keys.ts                   # +history key helper
│   ├── sanitize.ts                    # sanitize-html wrapper
│   └── coin-detail.ts                 # readCoinDetail (DB + history via Redis/CG)
├── components/
│   ├── price-chart.tsx                # client, lightweight-charts
│   ├── timeframe-tabs.tsx             # client, 1D..All buttons
│   ├── coin-detail/                   # all server components
│   │   ├── header.tsx
│   │   ├── description.tsx            # uses ExpandableDescription client wrapper
│   │   ├── expandable-description.tsx # client, collapse/expand
│   │   ├── links.tsx
│   │   ├── supply.tsx
│   │   └── markets.tsx
│   └── coin-row.tsx                   # MODIFY: wrap row in <Link href="/[locale]/coin/[slug]">
├── app/
│   ├── api/coins/[id]/history/route.ts   # GET ?timeframe=1d|7d|1m|1y|all
│   └── [locale]/coin/[slug]/page.tsx
worker/index.ts                            # MODIFY: add metadata-sync (daily) job
tests/
├── coin-detail-parse.test.ts          # parseCoinDetail / parseTickers / parseMarketChart
└── (existing tests unchanged)
```

---

## Task 1: Schema — coin metadata fields

**Files:** `prisma/schema.prisma` (modify), new migration.

- [ ] **Step 1: Append fields to `Coin` model** (before the closing brace of `model Coin`):

```prisma
  description    String?     @db.Text
  websiteUrl     String?
  explorerUrl    String?
  whitepaperUrl  String?
  githubUrl      String?
  twitterUrl     String?
  redditUrl      String?
  metadataFetchedAt DateTime?
```

`metadataFetchedAt` lets the worker skip recently-synced coins so a restart doesn't re-pull everything.

- [ ] **Step 2: Generate migration**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" npx prisma migrate dev --name coin_meta
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(db): coin metadata fields (description, links, fetchedAt)"
```

---

## Task 2: CoinGecko detail + market_chart + tickers (TDD)

**Files:** `src/lib/coingecko.ts` (modify), `tests/coin-detail-parse.test.ts` (new).

- [ ] **Step 1: Append types + parsers + fetchers** to `src/lib/coingecko.ts`:

```ts
export type CoinDetail = {
  id: string;
  descriptionEn: string | null;
  websiteUrl: string | null;
  explorerUrl: string | null;
  whitepaperUrl: string | null;
  githubUrl: string | null;
  twitterUrl: string | null;
  redditUrl: string | null;
};

export type ChartPoint = { time: number; value: number }; // unix seconds, price USD

export type TickerRow = {
  exchange: string;
  base: string;
  target: string;
  priceUsd: number;
  volumeUsd: number;
  tradeUrl: string | null;
};

function firstString(arr: unknown): string | null {
  if (!Array.isArray(arr)) return null;
  const first = arr.find((x) => typeof x === "string" && x.length > 0);
  return typeof first === "string" ? first : null;
}

export function parseCoinDetail(raw: unknown): CoinDetail {
  const r = raw as Record<string, unknown>;
  const desc = (r.description as Record<string, unknown> | undefined)?.en;
  const links = (r.links as Record<string, unknown> | undefined) ?? {};
  const repos = (links.repos_url as Record<string, unknown> | undefined) ?? {};
  const twitter = links.twitter_screen_name as string | undefined;

  return {
    id: req(r.id as string | undefined, "id"),
    descriptionEn: typeof desc === "string" && desc.length > 0 ? desc : null,
    websiteUrl: firstString(links.homepage),
    explorerUrl: firstString(links.blockchain_site),
    whitepaperUrl: typeof links.whitepaper === "string" && links.whitepaper.length > 0 ? (links.whitepaper as string) : null,
    githubUrl: firstString(repos.github),
    twitterUrl: twitter ? `https://twitter.com/${twitter}` : null,
    redditUrl: typeof links.subreddit_url === "string" && (links.subreddit_url as string).length > 0 ? (links.subreddit_url as string) : null,
  };
}

export function parseMarketChart(raw: unknown): ChartPoint[] {
  const r = raw as { prices?: unknown };
  if (!Array.isArray(r.prices)) throw new Error("coingecko market_chart: missing prices array");
  return r.prices
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number")
    .map(([ts, value]) => ({ time: Math.floor(ts / 1000), value }));
}

export function parseTickers(raw: unknown): TickerRow[] {
  const r = raw as { tickers?: unknown };
  if (!Array.isArray(r.tickers)) return [];
  const out: TickerRow[] = [];
  for (const t of r.tickers) {
    const row = t as Record<string, unknown>;
    const market = row.market as Record<string, unknown> | undefined;
    const cl = row.converted_last as Record<string, unknown> | undefined;
    const cv = row.converted_volume as Record<string, unknown> | undefined;
    if (!market || typeof market.name !== "string") continue;
    if (typeof row.base !== "string" || typeof row.target !== "string") continue;
    const priceUsd = typeof cl?.usd === "number" ? cl.usd : null;
    const volumeUsd = typeof cv?.usd === "number" ? cv.usd : null;
    if (priceUsd === null || volumeUsd === null) continue;
    out.push({
      exchange: market.name,
      base: row.base,
      target: row.target,
      priceUsd,
      volumeUsd,
      tradeUrl: typeof row.trade_url === "string" ? row.trade_url : null,
    });
  }
  return out;
}

export async function fetchCoinDetail(id: string): Promise<CoinDetail> {
  const raw = await cgFetch(`/coins/${encodeURIComponent(id)}`, {
    localization: "false",
    tickers: "false",
    market_data: "false",
    community_data: "false",
    developer_data: "false",
    sparkline: "false",
  });
  return parseCoinDetail(raw);
}

export async function fetchMarketChart(id: string, days: number | "max"): Promise<ChartPoint[]> {
  const raw = await cgFetch(`/coins/${encodeURIComponent(id)}/market_chart`, {
    vs_currency: "usd",
    days: String(days),
  });
  return parseMarketChart(raw);
}

export async function fetchTickers(id: string): Promise<TickerRow[]> {
  const raw = await cgFetch(`/coins/${encodeURIComponent(id)}/tickers`, { page: "1" });
  return parseTickers(raw);
}
```

- [ ] **Step 2: Tests** — create `tests/coin-detail-parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCoinDetail, parseMarketChart, parseTickers } from "@/lib/coingecko";

describe("parseCoinDetail", () => {
  const sample = {
    id: "bitcoin",
    description: { en: "Bitcoin is...", ru: "Биткоин..." },
    links: {
      homepage: ["http://bitcoin.org", "", ""],
      blockchain_site: ["https://mempool.space/", ""],
      whitepaper: "https://bitcoin.org/bitcoin.pdf",
      repos_url: { github: ["https://github.com/bitcoin/bitcoin"], bitbucket: [] },
      twitter_screen_name: "bitcoin",
      subreddit_url: "https://www.reddit.com/r/Bitcoin/",
    },
  };

  it("extracts description, links, twitter", () => {
    expect(parseCoinDetail(sample)).toEqual({
      id: "bitcoin",
      descriptionEn: "Bitcoin is...",
      websiteUrl: "http://bitcoin.org",
      explorerUrl: "https://mempool.space/",
      whitepaperUrl: "https://bitcoin.org/bitcoin.pdf",
      githubUrl: "https://github.com/bitcoin/bitcoin",
      twitterUrl: "https://twitter.com/bitcoin",
      redditUrl: "https://www.reddit.com/r/Bitcoin/",
    });
  });

  it("returns nulls for missing/empty fields", () => {
    const minimal = { id: "x" };
    expect(parseCoinDetail(minimal)).toEqual({
      id: "x",
      descriptionEn: null,
      websiteUrl: null,
      explorerUrl: null,
      whitepaperUrl: null,
      githubUrl: null,
      twitterUrl: null,
      redditUrl: null,
    });
  });

  it("throws on missing id", () => {
    expect(() => parseCoinDetail({})).toThrow();
  });
});

describe("parseMarketChart", () => {
  it("converts [ms, price] tuples into {time:sec, value}", () => {
    const raw = {
      prices: [
        [1700000000000, 100],
        [1700003600000, 105],
      ],
    };
    expect(parseMarketChart(raw)).toEqual([
      { time: 1700000000, value: 100 },
      { time: 1700003600, value: 105 },
    ]);
  });
  it("filters malformed entries", () => {
    expect(parseMarketChart({ prices: [[1, 2], ["bad"], null] })).toEqual([{ time: 0, value: 2 }]);
  });
  it("throws on missing prices array", () => {
    expect(() => parseMarketChart({})).toThrow();
  });
});

describe("parseTickers", () => {
  const ok = {
    market: { name: "Binance" },
    base: "BTC",
    target: "USDT",
    converted_last: { usd: 76791 },
    converted_volume: { usd: 788721355 },
    trade_url: "https://www.binance.com/en/trade/BTC_USDT",
  };
  it("extracts well-formed tickers", () => {
    expect(parseTickers({ tickers: [ok] })).toEqual([
      {
        exchange: "Binance",
        base: "BTC",
        target: "USDT",
        priceUsd: 76791,
        volumeUsd: 788721355,
        tradeUrl: "https://www.binance.com/en/trade/BTC_USDT",
      },
    ]);
  });
  it("skips entries without usd price or volume", () => {
    const bad = { ...ok, converted_last: {} };
    expect(parseTickers({ tickers: [bad] })).toEqual([]);
  });
  it("returns [] when tickers missing", () => {
    expect(parseTickers({})).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: all green (56 prior + ~10 new).

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(coingecko): detail/market_chart/tickers parsers and fetchers"
```

---

## Task 3: Sanitization helper

**Files:** `src/lib/sanitize.ts` (new), `package.json`.

- [ ] **Step 1: Install**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
npm install sanitize-html
npm install -D @types/sanitize-html
```

- [ ] **Step 2: Implement**

Create `src/lib/sanitize.ts`:
```ts
import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["a", "b", "i", "em", "strong", "p", "ul", "ol", "li", "br", "code", "blockquote"],
  allowedAttributes: {
    a: ["href", "rel", "target"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }),
  },
};

export function sanitizeDescription(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(util): sanitizeDescription wrapper around sanitize-html"
```

---

## Task 4: Worker — metadata-sync job

**Files:** `worker/index.ts`, `src/lib/sync/orchestrator.ts`.

- [ ] **Step 1: Add `syncCoinMetadata` to orchestrator**

In `src/lib/sync/orchestrator.ts`, append:

```ts
import { fetchCoinDetail, type CoinDetail } from "@/lib/coingecko";

type PrismaCoinMetaUpdate = {
  coin: {
    findMany(args: {
      where: { isActive: boolean; OR?: Array<unknown> };
      orderBy: { rank: "asc" };
      select: { id: true; metadataFetchedAt: true };
    }): Promise<Array<{ id: string; metadataFetchedAt: Date | null }>>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

export async function syncCoinMetadata(deps: {
  fetchCoinDetail: (id: string) => Promise<CoinDetail>;
  prisma: PrismaCoinMetaUpdate;
  // ms between fetches — Free tier ~30 req/min → 2000ms is comfortable
  delayMs?: number;
  // skip coins fetched within this window (default 23h)
  staleMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ updated: number; skipped: number; failed: number }> {
  const delayMs = deps.delayMs ?? 2000;
  const staleMs = deps.staleMs ?? 23 * 60 * 60 * 1000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = Date.now();

  const coins = await deps.prisma.coin.findMany({
    where: { isActive: true },
    orderBy: { rank: "asc" },
    select: { id: true, metadataFetchedAt: true },
  });

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of coins) {
    if (c.metadataFetchedAt && now - c.metadataFetchedAt.getTime() < staleMs) {
      skipped++;
      continue;
    }
    try {
      const d = await deps.fetchCoinDetail(c.id);
      await deps.prisma.coin.update({
        where: { id: c.id },
        data: {
          description: d.descriptionEn,
          websiteUrl: d.websiteUrl,
          explorerUrl: d.explorerUrl,
          whitepaperUrl: d.whitepaperUrl,
          githubUrl: d.githubUrl,
          twitterUrl: d.twitterUrl,
          redditUrl: d.redditUrl,
          metadataFetchedAt: new Date(),
        },
      });
      updated++;
    } catch (err) {
      failed++;
      console.error(`[worker] metadata-sync ${c.id} failed:`, err);
    }
    await sleep(delayMs);
  }

  return { updated, skipped, failed };
}
```

- [ ] **Step 2: Wire into worker**

In `worker/index.ts`:
- Add to imports: `syncCoinMetadata` (from orchestrator), `fetchCoinDetail` (from coingecko)
- Add `runMetadataSync`:

```ts
let metadataSyncRunning = false;
async function runMetadataSync() {
  if (metadataSyncRunning) {
    console.log("[worker] metadata-sync: already running, skipping tick");
    return;
  }
  metadataSyncRunning = true;
  const t0 = Date.now();
  try {
    const { updated, skipped, failed } = await syncCoinMetadata({
      fetchCoinDetail,
      prisma: prisma as never,
    });
    console.log(`[worker] metadata-sync done in ${((Date.now() - t0) / 1000).toFixed(1)}s — updated=${updated} skipped=${skipped} failed=${failed}`);
  } catch (err) {
    console.error("[worker] metadata-sync fatal:", err);
  } finally {
    metadataSyncRunning = false;
  }
}
```

- In `main()`, after `await runRatesSync();`:
```ts
// Kick metadata-sync in the background — don't block startup on a ~3 min loop.
void runMetadataSync();
```

- Add a daily cron (run at 03:30 server time):
```ts
cron.schedule("30 3 * * *", () => void runMetadataSync());
```

- [ ] **Step 3: Local smoke test (small batch)**

Patch a temporary smoke runner to validate the path. Since the full run takes ~3 min, we just verify it starts.

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
brew services start redis 2>/dev/null || true
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" REDIS_URL="redis://127.0.0.1:6379" npm run worker:start &
WORKER_PID=$!
sleep 15
kill $WORKER_PID 2>/dev/null
psql -U dmitry trientes_dev -c "SELECT id, name, LEFT(COALESCE(description,''),40) AS desc_prefix, \"metadataFetchedAt\" FROM \"Coin\" ORDER BY rank LIMIT 5;"
```

Expected: at least the top 1-3 coins have non-null `metadataFetchedAt` and a `desc_prefix`.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(worker): metadata-sync job (CoinGecko /coins/{id} loop, daily)"
```

---

## Task 5: History API route with Redis cache

**Files:** `src/app/api/coins/[id]/history/route.ts` (new), `src/lib/sync/keys.ts` (modify).

- [ ] **Step 1: Add key helper + TTL**

Append to `src/lib/sync/keys.ts`:
```ts
export const HISTORY_KEY = (id: string, timeframe: string) => `coin:history:${id}:${timeframe}`;

export const HISTORY_TTL: Record<string, number> = {
  "1d": 5 * 60,        // 5 min
  "7d": 60 * 60,       // 1 hour
  "1m": 60 * 60,       // 1 hour
  "1y": 6 * 60 * 60,   // 6 hours
  "all": 24 * 60 * 60, // 1 day
};

export const TIMEFRAME_DAYS: Record<string, number | "max"> = {
  "1d": 1,
  "7d": 7,
  "1m": 30,
  "1y": 365,
  "all": "max",
};
```

- [ ] **Step 2: Create route**

```bash
mkdir -p '/Users/dmitry/Coinmarketcap/src/app/api/coins/[id]/history'
```

Create `src/app/api/coins/[id]/history/route.ts`:
```ts
import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchMarketChart } from "@/lib/coingecko";
import { HISTORY_KEY, HISTORY_TTL, TIMEFRAME_DAYS } from "@/lib/sync/keys";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const timeframe = url.searchParams.get("timeframe") ?? "7d";

  if (!(timeframe in TIMEFRAME_DAYS)) {
    return NextResponse.json({ error: "invalid timeframe" }, { status: 400 });
  }
  if (!/^[a-z0-9-]+$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const key = HISTORY_KEY(id, timeframe);

  // Try cache.
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(key);
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { "x-cache": "hit" },
      });
    }
  } catch {
    // ignore — fall through to fetch
  }

  // Fetch from CoinGecko.
  try {
    const points = await fetchMarketChart(id, TIMEFRAME_DAYS[timeframe]);
    try {
      await redis.set(key, JSON.stringify(points), "EX", HISTORY_TTL[timeframe]);
    } catch {
      // best-effort cache write
    }
    return NextResponse.json(points, { headers: { "x-cache": "miss" } });
  } catch (err) {
    return NextResponse.json(
      { error: `fetch_failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 3: Smoke test (with dev server running)** — skip if dev server can't be started locally; verify after deploy via curl against the server.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(api): /api/coins/[id]/history with Redis cache"
```

---

## Task 6: lightweight-charts + PriceChart component

**Files:** `src/components/price-chart.tsx` (new), `package.json`.

- [ ] **Step 1: Install**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
npm install lightweight-charts
```

- [ ] **Step 2: Create the chart component**

`src/components/price-chart.tsx`:
```tsx
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

type Point = { time: number; value: number };

export function PriceChart({ coinId, timeframe }: { coinId: string; timeframe: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const { resolvedTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          Loading…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-red-500">{error}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(ui): PriceChart client component (lightweight-charts)"
```

---

## Task 7: TimeframeTabs + ChartPanel composer

**Files:** `src/components/timeframe-tabs.tsx` (new), `src/components/coin-detail/chart-panel.tsx` (new).

- [ ] **Step 1: TimeframeTabs**

`src/components/timeframe-tabs.tsx`:
```tsx
"use client";

import { Button } from "@/components/ui/button";

const FRAMES: Array<{ key: string; label: string }> = [
  { key: "1d", label: "1D" },
  { key: "7d", label: "7D" },
  { key: "1m", label: "1M" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
];

export function TimeframeTabs({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {FRAMES.map((f) => (
        <Button
          key={f.key}
          variant={value === f.key ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(f.key)}
        >
          {f.label}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: ChartPanel — client wrapper holding the timeframe state**

```bash
mkdir -p /Users/dmitry/Coinmarketcap/src/components/coin-detail
```

`src/components/coin-detail/chart-panel.tsx`:
```tsx
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
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(ui): TimeframeTabs + ChartPanel"
```

---

## Task 8: Detail-page sub-components + page assembly

**Files:** several under `src/components/coin-detail/`, the page itself, and the `coin-row.tsx` Link wrap.

- [ ] **Step 1: ExpandableDescription (client)**

`src/components/coin-detail/expandable-description.tsx`:
```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ExpandableDescription({
  htmlShort,
  htmlFull,
}: {
  htmlShort: string;
  htmlFull: string;
}) {
  const [open, setOpen] = useState(false);
  const html = open ? htmlFull : htmlShort;
  const showToggle = htmlShort !== htmlFull;
  return (
    <div>
      <div
        className="prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {showToggle && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Read more"}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Description (server)**

`src/components/coin-detail/description.tsx`:
```tsx
import { sanitizeDescription } from "@/lib/sanitize";
import { ExpandableDescription } from "./expandable-description";

const PREVIEW_CHARS = 500;

export function Description({ html }: { html: string | null }) {
  if (!html) return null;
  const cleanFull = sanitizeDescription(html);
  // Plain-text length test (rough — fine for choosing between short/full).
  const plain = cleanFull.replace(/<[^>]+>/g, "");
  const cleanShort =
    plain.length > PREVIEW_CHARS
      ? sanitizeDescription(html.slice(0, PREVIEW_CHARS) + "…")
      : cleanFull;
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">About</h2>
      <ExpandableDescription htmlShort={cleanShort} htmlFull={cleanFull} />
    </section>
  );
}
```

- [ ] **Step 3: Header (server)**

`src/components/coin-detail/header.tsx`:
```tsx
import Image from "next/image";
import type { MarketRow, ExchangeRates } from "@/lib/coingecko";
import { formatPriceInCurrency, type Currency } from "@/lib/currency";
import { formatPercent } from "@/lib/format";

export function CoinHeader({
  row,
  currency,
  rates,
}: {
  row: MarketRow;
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const pct = row.pctChange24h;
  const pctCls = pct === null ? "text-muted-foreground" : pct >= 0 ? "text-green-500" : "text-red-500";
  return (
    <header className="flex items-center gap-4">
      {row.logoUrl && (
        <Image src={row.logoUrl} alt="" width={48} height={48} className="rounded-full" unoptimized />
      )}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold">{row.name}</h1>
          <span className="text-muted-foreground uppercase">{row.symbol}</span>
          <span className="ml-2 px-2 py-0.5 text-xs border rounded bg-muted">#{row.rank}</span>
        </div>
      </div>
      <div className="text-right">
        <div className="text-3xl font-semibold tabular-nums">
          {rates ? formatPriceInCurrency(row.priceUsd, currency, rates) : `$${row.priceUsd.toFixed(2)}`}
        </div>
        <div className={`text-sm tabular-nums ${pctCls}`}>{formatPercent(pct)} (24h)</div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Links (server)**

`src/components/coin-detail/links.tsx`:
```tsx
type LinkRow = { label: string; href: string | null };

export function CoinLinks({ coin }: {
  coin: {
    websiteUrl: string | null;
    explorerUrl: string | null;
    whitepaperUrl: string | null;
    githubUrl: string | null;
    twitterUrl: string | null;
    redditUrl: string | null;
  };
}) {
  const items: LinkRow[] = [
    { label: "Website", href: coin.websiteUrl },
    { label: "Explorer", href: coin.explorerUrl },
    { label: "Whitepaper", href: coin.whitepaperUrl },
    { label: "GitHub", href: coin.githubUrl },
    { label: "Twitter", href: coin.twitterUrl },
    { label: "Reddit", href: coin.redditUrl },
  ].filter((x) => x.href);

  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Links</h2>
      <div className="flex flex-wrap gap-2">
        {items.map((l) => (
          <a
            key={l.label}
            href={l.href!}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            {l.label} →
          </a>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: SupplyMetrics (server)**

`src/components/coin-detail/supply.tsx`:
```tsx
import { formatCompactInCurrency, type Currency } from "@/lib/currency";
import type { ExchangeRates, MarketRow } from "@/lib/coingecko";

export function SupplyMetrics({
  row,
  currency,
  rates,
}: {
  row: MarketRow;
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const r = rates ?? {};
  const fmtSupply = (n: number | null) => {
    if (n === null) return "—";
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    return n.toLocaleString("en-US");
  };
  const cards = [
    {
      label: "Market cap",
      value: rates ? formatCompactInCurrency(row.marketCapUsd, currency, r) : `$${(row.marketCapUsd / 1e9).toFixed(2)}B`,
    },
    {
      label: "24h volume",
      value: rates ? formatCompactInCurrency(row.volume24hUsd, currency, r) : `$${(row.volume24hUsd / 1e9).toFixed(2)}B`,
    },
    { label: "Circulating supply", value: `${fmtSupply(row.circulatingSupply)} ${row.symbol}` },
    { label: "Total supply", value: row.totalSupply ? `${fmtSupply(row.totalSupply)} ${row.symbol}` : "—" },
    { label: "Max supply", value: row.maxSupply ? `${fmtSupply(row.maxSupply)} ${row.symbol}` : "—" },
  ];
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Stats</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="text-base font-medium mt-1 tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: MarketsTable (server)**

`src/components/coin-detail/markets.tsx`:
```tsx
import { fetchTickers, type TickerRow } from "@/lib/coingecko";
import { formatPriceInCurrency, formatCompactInCurrency, type Currency } from "@/lib/currency";
import type { ExchangeRates } from "@/lib/coingecko";

export async function MarketsTable({
  coinId,
  currency,
  rates,
}: {
  coinId: string;
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  let tickers: TickerRow[] = [];
  try {
    tickers = await fetchTickers(coinId);
  } catch {
    return null;
  }
  const top = [...tickers].sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, 10);
  if (top.length === 0) return null;
  const r = rates ?? {};
  const fmtP = (n: number) =>
    rates ? formatPriceInCurrency(n, currency, r) : `$${n.toFixed(2)}`;
  const fmtV = (n: number) =>
    rates ? formatCompactInCurrency(n, currency, r) : `$${(n / 1e6).toFixed(2)}M`;
  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Top markets</h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">Exchange</th>
              <th className="px-3 py-2 text-left font-medium">Pair</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-right font-medium">Volume (24h)</th>
            </tr>
          </thead>
          <tbody>
            {top.map((t, i) => (
              <tr key={`${t.exchange}-${t.base}-${t.target}-${i}`} className="border-b">
                <td className="px-3 py-3">
                  {t.tradeUrl ? (
                    <a href={t.tradeUrl} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                      {t.exchange}
                    </a>
                  ) : (
                    t.exchange
                  )}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {t.base}/{t.target}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtP(t.priceUsd)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtV(t.volumeUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 7: The page**

```bash
mkdir -p '/Users/dmitry/Coinmarketcap/src/app/[locale]/coin/[slug]'
```

`src/app/[locale]/coin/[slug]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { readExchangeRates, readTop100 } from "@/lib/snapshot";
import { getCurrency } from "@/lib/get-currency";
import { CoinHeader } from "@/components/coin-detail/header";
import { ChartPanel } from "@/components/coin-detail/chart-panel";
import { Description } from "@/components/coin-detail/description";
import { CoinLinks } from "@/components/coin-detail/links";
import { SupplyMetrics } from "@/components/coin-detail/supply";
import { MarketsTable } from "@/components/coin-detail/markets";
import type { MarketRow } from "@/lib/coingecko";

export const revalidate = 3600;

export default async function CoinDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const coin = await prisma.coin.findUnique({
    where: { slug },
    include: {
      snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 },
    },
  });
  if (!coin || !coin.snapshots[0]) {
    // Fall back to Redis list — covers the case where DB has the coin but no snapshot yet.
    const list = await readTop100();
    const fromRedis = list.find((r) => r.id === slug || r.symbol.toLowerCase() === slug.toLowerCase());
    if (!coin && !fromRedis) notFound();
    if (!fromRedis) notFound();
  }

  // Build a MarketRow from coin + latest snapshot.
  const s = coin?.snapshots[0];
  const row: MarketRow | null = coin && s
    ? {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        logoUrl: coin.logoUrl,
        rank: coin.rank,
        priceUsd: Number(s.priceUsd),
        marketCapUsd: Number(s.marketCapUsd),
        volume24hUsd: Number(s.volume24hUsd),
        circulatingSupply: s.circulatingSupply ? Number(s.circulatingSupply) : null,
        totalSupply: s.totalSupply ? Number(s.totalSupply) : null,
        maxSupply: s.maxSupply ? Number(s.maxSupply) : null,
        pctChange1h: s.pctChange1h,
        pctChange24h: s.pctChange24h,
        pctChange7d: s.pctChange7d,
        sparkline7d: (s.sparkline7d as number[] | null) ?? null,
      }
    : null;

  if (!coin || !row) notFound();

  const [currency, rates] = await Promise.all([getCurrency(), readExchangeRates()]);

  return (
    <main className="container mx-auto px-4 py-8 space-y-8">
      <CoinHeader row={row} currency={currency} rates={rates} />
      <ChartPanel coinId={coin.id} />
      <SupplyMetrics row={row} currency={currency} rates={rates} />
      <Description html={coin.description} />
      <CoinLinks coin={coin} />
      <MarketsTable coinId={coin.id} currency={currency} rates={rates} />
    </main>
  );
}
```

- [ ] **Step 8: Make table rows clickable**

Modify `src/components/coin-row.tsx`. Wrap the row in a `Link`-aware structure by replacing the name cell content with a `<Link>` and turning the entire row into a clickable area using nested links. The simplest pattern: wrap **just the name cell** in `<Link>`. Replace the existing name `<td>` with:

```tsx
<td className="px-3 py-3">
  <Link
    href={`/${locale}/coin/${row.id}`}
    className="flex items-center gap-2 hover:underline"
  >
    {row.logoUrl && (
      <Image
        src={row.logoUrl}
        alt=""
        width={20}
        height={20}
        className="rounded-full"
        unoptimized
      />
    )}
    <span className="font-medium">{row.name}</span>
    <span className="text-xs text-muted-foreground uppercase">{row.symbol}</span>
  </Link>
</td>
```

For this `Link` to know the current locale, pass it as a prop. Update `CoinRow`'s props to include `locale: string`. In `CoinListClient`, accept `locale` and pass through to each `<CoinRow locale={locale} ...>`. In `src/app/[locale]/page.tsx`, pass `locale` to `<CoinListClient ... locale={locale} />`.

Update imports in `coin-row.tsx`:
```tsx
import Link from "next/link";
```

- [ ] **Step 9: Commit**
```bash
git add -A && git commit -m "feat(detail): coin detail page (chart, description, supply, links, markets)"
```

---

## Task 9: Translation strings for new UI

**Files:** all 10 message files.

- [ ] **Step 1: Add a `detail` block to `messages/en.json`**

```json
"detail": {
  "about": "About",
  "stats": "Stats",
  "links": "Links",
  "topMarkets": "Top markets",
  "marketCap": "Market cap",
  "volume24h": "24h volume",
  "circulating": "Circulating supply",
  "total": "Total supply",
  "max": "Max supply",
  "exchange": "Exchange",
  "pair": "Pair",
  "price": "Price",
  "volume": "Volume (24h)",
  "readMore": "Read more",
  "showLess": "Show less",
  "loading": "Loading…",
  "website": "Website",
  "explorer": "Explorer",
  "whitepaper": "Whitepaper",
  "github": "GitHub",
  "twitter": "Twitter",
  "reddit": "Reddit"
}
```

Then translate into all 9 other locales. Translations for "Read more" / "Show less" / "Loading…" are the most user-visible — make them idiomatic; fall back to English elsewhere if uncertain. Required keys (same shape) in every file:

ru: `{"about":"О проекте","stats":"Показатели","links":"Ссылки","topMarkets":"Топ рынков","marketCap":"Капитализация","volume24h":"Объём (24ч)","circulating":"В обращении","total":"Всего","max":"Максимум","exchange":"Биржа","pair":"Пара","price":"Цена","volume":"Объём (24ч)","readMore":"Подробнее","showLess":"Скрыть","loading":"Загрузка…","website":"Сайт","explorer":"Эксплорер","whitepaper":"Whitepaper","github":"GitHub","twitter":"Twitter","reddit":"Reddit"}`

For the remaining 8 (zh-CN, es, ja, ko, de, fr, pt-BR, tr) translate the visible strings; the technical/brand names (GitHub, Twitter, Reddit, Whitepaper) stay English. Choose short native labels for "Read more"/"Show less"/"Loading…".

- [ ] **Step 2: Wire i18n into the actual components**

This pass updates the components written in Task 8 to use `useTranslations("detail")` / `getTranslations("detail")` instead of hardcoded English. Touch these files:
- `description.tsx` — heading "About"
- `links.tsx` — heading "Links" + label dictionary
- `supply.tsx` — section heading "Stats" + 5 card labels
- `markets.tsx` — heading "Top markets" + column labels
- `expandable-description.tsx` — "Read more" / "Show less"
- `price-chart.tsx` — "Loading…"

Use `useTranslations("detail")` in `expandable-description.tsx` and `price-chart.tsx` (both client). Use server-side `getTranslations("detail")` in the server components.

- [ ] **Step 3: Run tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: all green.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(i18n): detail-page strings in 10 locales"
```

---

## Task 10: Deploy + smoke test

**Files:** server-only.

- [ ] **Step 1: Push, pull**
```bash
git push origin main
ssh dv@85.192.25.242 'cd ~/trientes && git stash && git pull && git stash drop 2>/dev/null; true'
```

- [ ] **Step 2: Install, migrate, build**
```bash
ssh dv@85.192.25.242 'cd ~/trientes && npm ci 2>&1 | tail -5'
ssh dv@85.192.25.242 'cd ~/trientes && DATABASE_URL=$(grep ^DATABASE_URL .env | cut -d= -f2-) npx prisma migrate deploy'
ssh dv@85.192.25.242 'cd ~/trientes && npm run build 2>&1 | tail -20'
```

- [ ] **Step 3: Restart PM2 + watch worker for a couple of minutes**
```bash
ssh dv@85.192.25.242 'pm2 restart trientes-web trientes-worker'
sleep 30
ssh dv@85.192.25.242 'pm2 logs trientes-worker --lines 40 --nostream'
```
Expected: see lines from `price-sync`, `global-sync`, `rates-sync`, AND `metadata-sync` (the metadata-sync line should appear within 10s of startup with at least one coin processed).

- [ ] **Step 4: Wait for metadata-sync to populate some coins**

```bash
sleep 60   # gives metadata-sync time to process the first ~30 coins at 2s spacing
ssh dv@85.192.25.242 "PGPASSWORD=\$(cat ~/.trientes-dbpass) psql -h 127.0.0.1 -U trientes trientes -c 'SELECT COUNT(*) FILTER (WHERE \"metadataFetchedAt\" IS NOT NULL) AS done, COUNT(*) AS total FROM \"Coin\";'"
```
Expected: `done` > 20 (about half done by then).

- [ ] **Step 5: Smoke-test the detail page for bitcoin and ethereum**
```bash
curl -s http://85.192.25.242/en/coin/bitcoin | grep -oE 'Bitcoin' | head -1
curl -s http://85.192.25.242/en/coin/bitcoin | grep -oE 'About'
curl -s http://85.192.25.242/en/coin/bitcoin | grep -oE 'Top markets'
curl -s http://85.192.25.242/en/coin/ethereum | grep -oE 'Ethereum' | head -1
```
Expected: all match.

- [ ] **Step 6: History API**
```bash
curl -s 'http://85.192.25.242/api/coins/bitcoin/history?timeframe=7d' | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{len(d)} points, first: {d[0]}, last: {d[-1]}')"
curl -sI 'http://85.192.25.242/api/coins/bitcoin/history?timeframe=7d' | grep -i x-cache
```
Expected: ~168 points (7d hourly), `x-cache: hit` on the second curl.

- [ ] **Step 7: Listing rows are clickable links**
```bash
curl -s http://85.192.25.242/en | grep -oE 'href="/en/coin/[a-z0-9-]+"' | head -3
```
Expected: prints links like `/en/coin/bitcoin`, `/en/coin/ethereum`, `/en/coin/binancecoin`.

- [ ] **Step 8: Health check**
```bash
curl -s http://85.192.25.242/api/health | python3 -m json.tool
```
Expected: `"ok": true`.

- [ ] **Step 9: Local test suite**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
npm test
```
Expected: all green.

- [ ] **Step 10: No commit unless adjustments were needed.**

---

## Done criteria

- [ ] `/en/coin/bitcoin` renders header, chart container, description, links, supply, markets
- [ ] Clicking timeframe tab fetches `/api/coins/bitcoin/history?timeframe=...` and updates the chart
- [ ] `x-cache: hit` returned on the second history request for the same timeframe
- [ ] Worker logs include a `metadata-sync done` line on startup
- [ ] At least 50% of coins have `metadataFetchedAt` set within 5 minutes of worker startup
- [ ] All unit tests pass (~66+)

**Out of scope (Phase 5+):** watchlist toggle on detail page (Phase 5), per-coin currency conversion of chart values (currently chart is always USD — kept simple), SSE for live price tick on detail page (Phase 7).
