# Trientes Phase 7: Exchanges Page + Admin-Added Coin Pricing

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox-tracked.

**Goal:** Two features that complete the public-facing surface:
1. **`/[locale]/exchanges`** — top 100 exchanges by trust-score-rank, with logo, name, trust-score badge, country, year founded, 24h USD volume. Worker fetches every 30 min.
2. **Admin-added coin pricing** — close the loose end from Phase 6: admin-added coins (currently in DB with `source=ADMIN_ADDED` but no `CoinSnapshot`) get priced via `/coins/markets?ids=...` on a 30-min schedule and merge into the public listing alongside the L1 top-100.

**Deferred to Phase 8:** SSE/Binance WS live ticks (needs Binance integration), email notifications on request review (needs SMTP provider).

**Reference spec:** `docs/superpowers/specs/2026-05-19-trientes-cmc-clone-design.md` §5, §3.
**Working dir:** `/Users/dmitry/Coinmarketcap`. Server: `dv@85.192.25.242`.

**Carry constraints:**
- `npm` at `$HOME/.nvm/versions/node/v22.19.0/bin/` — set PATH in every bash invocation.
- Never `npm run build` / `tsc --noEmit` locally (macOS Tahoe SWC hang).
- `.claude/` gitignored.
- CoinGecko Free tier ~10k calls/month. Current scheduled cadence: ~7.2k/mo. Phase 7 adds:
  - Exchanges fetch: 1 call / 30 min = 48/day = ~1.4k/mo
  - Admin-added pricing fetch: only when admin-added list non-empty, 1 call / 30 min = ≤48/day = ≤1.4k/mo
  - Total budget after Phase 7: ~9k-10k/mo. Tight but fits.

**Storage choices:**
- Exchanges: store both raw 24h-BTC volume and pre-computed USD (multiplied by BTC↔USD rate at sync time). USD lets the public page render without depending on the rates cache.
- Admin-added pricing: separate Redis key `snapshot:list:admin` so failures here don't corrupt the L1 list. `readTop100` concatenates both at render time (L1 first by rank, admin-added appended).

---

## File structure produced

```
prisma/migrations/<ts>_exchanges/
src/
├── lib/
│   ├── coingecko.ts                       # +Exchange type, parseExchange, fetchExchanges
│   ├── sync/
│   │   ├── orchestrator.ts                # +syncExchanges, +syncAdminAddedPrices
│   │   └── keys.ts                        # +exchanges, adminAddedList keys + TTLs
│   └── snapshot.ts                        # +readExchanges, readTop100 merges admin-added
├── components/
│   └── exchanges-table.tsx                # server component, currency-aware via shared formatters
├── app/[locale]/
│   ├── exchanges/page.tsx                 # new
│   └── ... (navbar gets a link)
worker/index.ts                             # +runExchangesSync, +runAdminAddedSync on cron
tests/
├── coingecko-exchanges.test.ts            # parseExchange
└── sync-orchestrator.test.ts              # +syncExchanges + syncAdminAddedPrices cases (extend)
messages/*.json                             # +exchanges block (10 files), +nav.exchanges link
```

---

## Task 1: Schema — `Exchange` model

**Files:** `prisma/schema.prisma`, new migration.

- [ ] **Step 1:** Append at end of `prisma/schema.prisma`:

```prisma
model Exchange {
  id                  String   @id              // CoinGecko id, e.g. "binance"
  name                String
  logoUrl             String?
  country             String?
  yearEstablished     Int?
  trustScore          Int?
  trustScoreRank      Int?
  volume24hBtc        Float
  volume24hUsd        Float
  url                 String?
  hasTradingIncentive Boolean  @default(false)
  fetchedAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([trustScoreRank])
}
```

- [ ] **Step 2:** Generate + apply migration:

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" npx prisma migrate dev --name exchanges
```

(If `migrate dev` is interactive in this env, fall back to `prisma migrate diff` → manually scaffold the migration folder → `migrate deploy`, same pattern as Phase 6 Task 1.)

- [ ] **Step 3:** Commit:
```bash
git add -A && git commit -m "feat(db): Exchange model"
```

---

## Task 2: CoinGecko `parseExchange` + `fetchExchanges` (TDD)

**Files:** `tests/coingecko-exchanges.test.ts`, `src/lib/coingecko.ts` (modify).

- [ ] **Step 1: Write tests**

`tests/coingecko-exchanges.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseExchange } from "@/lib/coingecko";

describe("parseExchange", () => {
  const sample = {
    id: "gdax",
    name: "Coinbase Exchange",
    year_established: 2012,
    country: "United States",
    description: "A leading U.S.-based exchange",
    url: "https://www.coinbase.com/",
    image: "https://example.com/coinbase.png",
    has_trading_incentive: false,
    trust_score: 10,
    trust_score_rank: 1,
    trade_volume_24h_btc: 15509.32,
  };

  it("maps fields and computes USD volume from a btcUsd ratio", () => {
    expect(parseExchange(sample, 76000)).toEqual({
      id: "gdax",
      name: "Coinbase Exchange",
      logoUrl: "https://example.com/coinbase.png",
      country: "United States",
      yearEstablished: 2012,
      trustScore: 10,
      trustScoreRank: 1,
      volume24hBtc: 15509.32,
      volume24hUsd: 15509.32 * 76000,
      url: "https://www.coinbase.com/",
      hasTradingIncentive: false,
    });
  });

  it("handles missing optionals as null", () => {
    const minimal = {
      id: "x",
      name: "X",
      trade_volume_24h_btc: 0,
    };
    expect(parseExchange(minimal, 70000)).toEqual({
      id: "x",
      name: "X",
      logoUrl: null,
      country: null,
      yearEstablished: null,
      trustScore: null,
      trustScoreRank: null,
      volume24hBtc: 0,
      volume24hUsd: 0,
      url: null,
      hasTradingIncentive: false,
    });
  });

  it("throws on missing id or name", () => {
    expect(() => parseExchange({}, 1)).toThrow();
    expect(() => parseExchange({ id: "a" }, 1)).toThrow();
  });
});
```

- [ ] **Step 2: Implement**

Append to `src/lib/coingecko.ts`:
```ts
export type Exchange = {
  id: string;
  name: string;
  logoUrl: string | null;
  country: string | null;
  yearEstablished: number | null;
  trustScore: number | null;
  trustScoreRank: number | null;
  volume24hBtc: number;
  volume24hUsd: number;
  url: string | null;
  hasTradingIncentive: boolean;
};

export function parseExchange(raw: unknown, btcUsd: number): Exchange {
  const r = raw as Record<string, unknown>;
  const id = req(r.id as string | undefined, "id");
  const name = req(r.name as string | undefined, "name");
  const btc = typeof r.trade_volume_24h_btc === "number" ? r.trade_volume_24h_btc : 0;
  return {
    id,
    name,
    logoUrl: typeof r.image === "string" ? r.image : null,
    country: typeof r.country === "string" ? r.country : null,
    yearEstablished: typeof r.year_established === "number" ? r.year_established : null,
    trustScore: typeof r.trust_score === "number" ? r.trust_score : null,
    trustScoreRank: typeof r.trust_score_rank === "number" ? r.trust_score_rank : null,
    volume24hBtc: btc,
    volume24hUsd: btc * btcUsd,
    url: typeof r.url === "string" ? r.url : null,
    hasTradingIncentive: r.has_trading_incentive === true,
  };
}

export async function fetchExchanges(btcUsd: number): Promise<Exchange[]> {
  const raw = await cgFetch("/exchanges", { per_page: "100", page: "1" });
  if (!Array.isArray(raw)) throw new Error("coingecko /exchanges: not an array");
  return raw.map((row) => parseExchange(row, btcUsd));
}
```

- [ ] **Step 3: Run tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: 85 prior + 3 new = 88.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(coingecko): Exchange parser + fetchExchanges with tests"
```

---

## Task 3: Sync orchestrator — `syncExchanges` + `syncAdminAddedPrices`

**Files:** `src/lib/sync/keys.ts`, `src/lib/sync/orchestrator.ts`, extend `tests/sync-orchestrator.test.ts`.

- [ ] **Step 1: Keys + TTL**

In `src/lib/sync/keys.ts`, extend `KEYS` and `TTL`:
```ts
export const KEYS = {
  topList: "snapshot:list:top100",
  adminAddedList: "snapshot:list:admin",
  exchangesList: "snapshot:exchanges:top100",
  coin: (id: string) => `snapshot:coin:${id}`,
  globalStats: "global:stats",
  exchangeRates: "exchange:rates",
} as const;

export const TTL = {
  snapshot: 900,
  globalStats: 2400,
  exchangeRates: 2400,
  exchanges: 3600,         // 1h — list barely moves in scale
  adminAddedList: 3600,    // 1h
} as const;
```

(Keep `HISTORY_KEY`, `HISTORY_TTL`, `TIMEFRAME_DAYS` untouched at the bottom.)

- [ ] **Step 2: Extend orchestrator**

In `src/lib/sync/orchestrator.ts`, add:

```ts
import type { Exchange, MarketRow } from "@/lib/coingecko";

export async function syncExchanges(deps: {
  fetchExchanges: (btcUsd: number) => Promise<Exchange[]>;
  btcUsd: number;
  redis: RedisLike;
  prisma: {
    exchange: {
      upsert(args: {
        where: { id: string };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }): Promise<unknown>;
    };
  };
}): Promise<{ count: number }> {
  const list = await deps.fetchExchanges(deps.btcUsd);
  await deps.redis.set(KEYS.exchangesList, JSON.stringify(list), "EX", TTL.exchanges);

  for (const e of list) {
    await deps.prisma.exchange.upsert({
      where: { id: e.id },
      update: {
        name: e.name,
        logoUrl: e.logoUrl,
        country: e.country,
        yearEstablished: e.yearEstablished,
        trustScore: e.trustScore,
        trustScoreRank: e.trustScoreRank,
        volume24hBtc: e.volume24hBtc,
        volume24hUsd: e.volume24hUsd,
        url: e.url,
        hasTradingIncentive: e.hasTradingIncentive,
      },
      create: {
        id: e.id,
        name: e.name,
        logoUrl: e.logoUrl,
        country: e.country,
        yearEstablished: e.yearEstablished,
        trustScore: e.trustScore,
        trustScoreRank: e.trustScoreRank,
        volume24hBtc: e.volume24hBtc,
        volume24hUsd: e.volume24hUsd,
        url: e.url,
        hasTradingIncentive: e.hasTradingIncentive,
      },
    });
  }
  return { count: list.length };
}

export async function syncAdminAddedPrices(deps: {
  // Returns admin-added coin ids; empty array means "nothing to do".
  listAdminAddedIds: () => Promise<string[]>;
  fetchByIds: (ids: string[]) => Promise<MarketRow[]>;
  redis: RedisLike;
  prisma: PrismaLike;
}): Promise<{ count: number }> {
  const ids = await deps.listAdminAddedIds();
  if (ids.length === 0) {
    // Clear stale snapshot so the public listing doesn't show orphaned admin coins.
    await deps.redis.set(KEYS.adminAddedList, JSON.stringify([]), "EX", TTL.adminAddedList);
    return { count: 0 };
  }

  const rows = await deps.fetchByIds(ids);
  await deps.redis.set(KEYS.adminAddedList, JSON.stringify(rows), "EX", TTL.adminAddedList);

  // Per-coin cache + DB snapshot, same as syncPrices.
  for (const r of rows) {
    await deps.redis.set(KEYS.coin(r.id), JSON.stringify(r), "EX", TTL.snapshot);
    await deps.prisma.coin.upsert({
      where: { id: r.id },
      update: {
        symbol: r.symbol,
        name: r.name,
        logoUrl: r.logoUrl,
        rank: r.rank,
      },
      // ADMIN_ADDED row already exists from approval; this branch is a defensive fallback.
      create: {
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        slug: r.id,
        rank: r.rank,
        logoUrl: r.logoUrl,
        source: "ADMIN_ADDED",
      },
    });
    await deps.prisma.coinSnapshot.create({
      data: {
        coinId: r.id,
        priceUsd: r.priceUsd,
        marketCapUsd: r.marketCapUsd,
        volume24hUsd: r.volume24hUsd,
        pctChange1h: r.pctChange1h,
        pctChange24h: r.pctChange24h,
        pctChange7d: r.pctChange7d,
        circulatingSupply: r.circulatingSupply,
        totalSupply: r.totalSupply,
        maxSupply: r.maxSupply,
        sparkline7d: r.sparkline7d,
      },
    });
  }
  return { count: rows.length };
}
```

- [ ] **Step 3: Extend tests** — `tests/sync-orchestrator.test.ts`

Add after the existing `describe` blocks:

```ts
import { syncExchanges, syncAdminAddedPrices } from "@/lib/sync/orchestrator";
import type { Exchange } from "@/lib/coingecko";

describe("syncExchanges", () => {
  const ex: Exchange = {
    id: "gdax",
    name: "Coinbase Exchange",
    logoUrl: "https://example.com/c.png",
    country: "United States",
    yearEstablished: 2012,
    trustScore: 10,
    trustScoreRank: 1,
    volume24hBtc: 15000,
    volume24hUsd: 15000 * 76000,
    url: "https://coinbase.com/",
    hasTradingIncentive: false,
  };

  it("writes Redis snapshot and upserts each exchange", async () => {
    const redisStore = new Map<string, string>();
    const fakeRedis = { set: vi.fn(async (k: string, v: string) => { redisStore.set(k, v); return "OK"; }) };
    const upserts: string[] = [];
    const fakePrisma = {
      exchange: {
        upsert: vi.fn(async ({ where }: any) => { upserts.push(where.id); return {}; }),
      },
    };
    const result = await syncExchanges({
      fetchExchanges: async () => [ex, { ...ex, id: "binance", trustScoreRank: 2 }],
      btcUsd: 76000,
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    expect(result).toEqual({ count: 2 });
    expect(upserts).toEqual(["gdax", "binance"]);
    expect(JSON.parse(redisStore.get("snapshot:exchanges:top100")!)).toHaveLength(2);
  });
});

describe("syncAdminAddedPrices", () => {
  const row: MarketRow = {
    id: "myadmin", symbol: "ADM", name: "Admin Coin", logoUrl: null,
    rank: 9999, priceUsd: 1, marketCapUsd: 100, volume24hUsd: 10,
    circulatingSupply: null, totalSupply: null, maxSupply: null,
    pctChange1h: null, pctChange24h: null, pctChange7d: null,
    sparkline7d: null,
  };

  it("writes empty list and skips fetch when no admin ids", async () => {
    const redisStore = new Map<string, string>();
    const fakeRedis = { set: vi.fn(async (k: string, v: string) => { redisStore.set(k, v); return "OK"; }) };
    const fetchByIds = vi.fn(async () => []);
    const fakePrisma = makeFakes().fakePrisma;
    const result = await syncAdminAddedPrices({
      listAdminAddedIds: async () => [],
      fetchByIds: fetchByIds as never,
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    expect(result).toEqual({ count: 0 });
    expect(fetchByIds).not.toHaveBeenCalled();
    expect(redisStore.get("snapshot:list:admin")).toBe("[]");
  });

  it("fetches and persists when admin ids exist", async () => {
    const { redisStore, fakeRedis, fakePrisma, createdSnapshots, upsertedCoins } = makeFakes();
    const fetchByIds = vi.fn(async (ids: string[]) => ids.map((id) => ({ ...row, id })));
    const result = await syncAdminAddedPrices({
      listAdminAddedIds: async () => ["coinx"],
      fetchByIds: fetchByIds as never,
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    expect(result).toEqual({ count: 1 });
    expect(fetchByIds).toHaveBeenCalledWith(["coinx"]);
    expect(JSON.parse(redisStore.get("snapshot:list:admin")!)).toHaveLength(1);
    expect(upsertedCoins).toEqual([{ id: "coinx", rank: 9999 }]);
    expect(createdSnapshots).toEqual([{ coinId: "coinx", priceUsd: 1 }]);
  });
});
```

- [ ] **Step 4: Add a `fetchMarketsByIds` to coingecko.ts**

Append to `src/lib/coingecko.ts`:
```ts
export async function fetchMarketsByIds(ids: string[]): Promise<MarketRow[]> {
  if (ids.length === 0) return [];
  const raw = await cgFetch("/coins/markets", {
    vs_currency: "usd",
    ids: ids.join(","),
    order: "market_cap_desc",
    per_page: String(Math.min(ids.length, 250)),
    page: "1",
    sparkline: "true",
    price_change_percentage: "1h,24h,7d",
  });
  if (!Array.isArray(raw)) throw new Error("coingecko /coins/markets ids: not an array");
  return (raw as unknown[])
    .filter((r) => typeof (r as { market_cap_rank?: unknown }).market_cap_rank === "number")
    .map(parseMarketRow);
}
```

- [ ] **Step 5: Run tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: 88 prior + 3 new = 91 passing.

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(sync): exchanges + admin-added pricing orchestrators with tests"
```

---

## Task 4: Worker — schedule new jobs

**Files:** `worker/index.ts`.

- [ ] **Step 1: Update imports + add runners**

In `worker/index.ts`:
- Add imports:
```ts
import { fetchExchanges, fetchMarketsByIds } from "../src/lib/coingecko";
import { syncExchanges, syncAdminAddedPrices } from "../src/lib/sync/orchestrator";
```

- Add runners (after `runMetadataSync`):
```ts
async function runExchangesSync() {
  const t0 = Date.now();
  try {
    // Need BTC/USD to compute USD volumes. Read rates cache.
    const ratesRaw = await redis.get("exchange:rates");
    if (!ratesRaw) {
      console.warn("[worker] exchanges-sync: rates cache empty, skipping tick");
      return;
    }
    const rates = JSON.parse(ratesRaw) as Record<string, { value: number }>;
    const btcUsd = rates.usd?.value;
    if (!btcUsd) {
      console.warn("[worker] exchanges-sync: usd rate missing");
      return;
    }
    const { count } = await syncExchanges({
      fetchExchanges,
      btcUsd,
      redis: redis as never,
      prisma: prisma as never,
    });
    console.log(`[worker] exchanges-sync ok: ${count} in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error("[worker] exchanges-sync failed:", err);
  }
}

async function runAdminAddedSync() {
  const t0 = Date.now();
  try {
    const { count } = await syncAdminAddedPrices({
      listAdminAddedIds: async () => {
        const rows = await prisma.coin.findMany({
          where: { source: "ADMIN_ADDED", isActive: true },
          select: { id: true },
        });
        return rows.map((r) => r.id);
      },
      fetchByIds: fetchMarketsByIds,
      redis: redis as never,
      prisma: prisma as never,
    });
    console.log(`[worker] admin-added-sync ok: ${count} in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error("[worker] admin-added-sync failed:", err);
  }
}
```

- In `main()`, after the existing startup runs and before the cron schedules, add:
```ts
await runExchangesSync();
await runAdminAddedSync();
```

- Update the 30-min cron to also call the two new runners. Replace the existing `cron.schedule("*/30 * * * *", ...)` with:
```ts
cron.schedule("*/30 * * * *", () => {
  void runGlobalSync();
  void runRatesSync();
  void runExchangesSync();
  void runAdminAddedSync();
});
```

- [ ] **Step 2: Local smoke**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
brew services start redis 2>/dev/null || true
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" REDIS_URL="redis://127.0.0.1:6379" npm run worker:start &
WORKER_PID=$!
sleep 8
kill $WORKER_PID 2>/dev/null
redis-cli get snapshot:exchanges:top100 | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(f'{len(d)} exchanges, first: {d[0][\"name\"]} (rank {d[0][\"trustScoreRank\"]}, vol \${d[0][\"volume24hUsd\"]:,.0f})')"
redis-cli get snapshot:list:admin | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(f'admin-added: {len(d)}')"
```
Expected: ~100 exchanges in Redis, top trust-score-rank 1. Admin-added is 0 unless you've added one via the admin panel.

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(worker): exchanges-sync + admin-added-sync runners and cron"
```

---

## Task 5: Snapshot reader — `readExchanges` + merge admin-added into `readTop100`

**Files:** `src/lib/snapshot.ts`.

- [ ] **Step 1: Add `readExchanges`**

```ts
import type { Exchange } from "@/lib/coingecko";

export async function readExchanges(): Promise<Exchange[]> {
  const cached = await redisGet(KEYS.exchangesList);
  if (cached) {
    try {
      return JSON.parse(cached) as Exchange[];
    } catch {
      // fall through
    }
  }
  // DB fallback
  const rows = await prisma.exchange.findMany({
    orderBy: { trustScoreRank: "asc" },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    logoUrl: r.logoUrl,
    country: r.country,
    yearEstablished: r.yearEstablished,
    trustScore: r.trustScore,
    trustScoreRank: r.trustScoreRank,
    volume24hBtc: r.volume24hBtc,
    volume24hUsd: r.volume24hUsd,
    url: r.url,
    hasTradingIncentive: r.hasTradingIncentive,
  }));
}
```

- [ ] **Step 2: Update `readTop100` to merge admin-added**

Replace the existing function:
```ts
export async function readTop100(): Promise<MarketRow[]> {
  const [l1Cached, adminCached] = await Promise.all([
    redisGet(KEYS.topList),
    redisGet(KEYS.adminAddedList),
  ]);

  let l1: MarketRow[] = [];
  if (l1Cached) {
    try {
      l1 = JSON.parse(l1Cached) as MarketRow[];
    } catch {
      l1 = [];
    }
  }
  let admin: MarketRow[] = [];
  if (adminCached) {
    try {
      admin = JSON.parse(adminCached) as MarketRow[];
    } catch {
      admin = [];
    }
  }
  if (l1.length > 0 || admin.length > 0) {
    return [...l1, ...admin];
  }

  // DB fallback: latest snapshot per active coin, ordered by rank.
  const coins = await prisma.coin.findMany({
    where: { isActive: true },
    orderBy: { rank: "asc" },
    take: 200,
    include: {
      snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 },
    },
  });

  return coins
    .filter((c) => c.snapshots[0])
    .map((c) => {
      const s = c.snapshots[0];
      return {
        id: c.id,
        symbol: c.symbol,
        name: c.name,
        logoUrl: c.logoUrl,
        rank: c.rank,
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
      };
    });
}
```

(Now reads L1 from Redis OR fallback to DB which spans all `isActive` coins regardless of source. So admin-added appears as long as it has a snapshot somewhere.)

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(snapshot): readExchanges + merge admin-added into readTop100"
```

---

## Task 6: `/[locale]/exchanges` page + components

**Files:** `src/components/exchanges-table.tsx`, `src/app/[locale]/exchanges/page.tsx`.

- [ ] **Step 1: Table component (server)**

`src/components/exchanges-table.tsx`:
```tsx
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { Exchange, ExchangeRates } from "@/lib/coingecko";
import { formatCompactInCurrency, type Currency } from "@/lib/currency";

function trustBadgeCls(score: number | null): string {
  if (score === null) return "bg-muted text-muted-foreground";
  if (score >= 9) return "bg-green-500/15 text-green-700 dark:text-green-400";
  if (score >= 7) return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
  return "bg-red-500/15 text-red-700 dark:text-red-400";
}

export async function ExchangesTable({
  rows,
  currency,
  rates,
}: {
  rows: Exchange[];
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const t = await getTranslations("exchanges");
  const r = rates ?? {};
  const fmtV = (n: number) =>
    rates ? formatCompactInCurrency(n, currency, r) : `$${(n / 1e9).toFixed(2)}B`;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 text-left font-medium">{t("rank")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("name")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("trust")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("country")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("founded")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("volume24h")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-b hover:bg-muted/30">
              <td className="px-3 py-3 tabular-nums text-muted-foreground">{e.trustScoreRank ?? "—"}</td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  {e.logoUrl && (
                    <Image src={e.logoUrl} alt="" width={20} height={20} className="rounded" unoptimized />
                  )}
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:underline">
                      {e.name}
                    </a>
                  ) : (
                    <span className="font-medium">{e.name}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3">
                <span className={`px-2 py-0.5 text-xs rounded ${trustBadgeCls(e.trustScore)}`}>
                  {e.trustScore ?? "—"}/10
                </span>
              </td>
              <td className="px-3 py-3 text-muted-foreground">{e.country ?? "—"}</td>
              <td className="px-3 py-3 tabular-nums text-muted-foreground">{e.yearEstablished ?? "—"}</td>
              <td className="px-3 py-3 tabular-nums text-right">{fmtV(e.volume24hUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Page**

`src/app/[locale]/exchanges/page.tsx`:
```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { readExchanges, readExchangeRates } from "@/lib/snapshot";
import { getCurrency } from "@/lib/get-currency";
import { ExchangesTable } from "@/components/exchanges-table";

export const revalidate = 600;

export default async function ExchangesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("exchanges");

  const [rows, rates, currency] = await Promise.all([
    readExchanges(),
    readExchangeRates(),
    getCurrency(),
  ]);

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </header>
      {rows.length > 0 ? (
        <ExchangesTable rows={rows} currency={currency} rates={rates} />
      ) : (
        <p className="text-muted-foreground">{t("empty")}</p>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Make Image domain coverage**

Verify `next.config.ts` already allows `coin-images.coingecko.com` (it does from Phase 2). Exchange logos come from the same CDN — no change needed.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(exchanges): /[locale]/exchanges page + ExchangesTable"
```

---

## Task 7: Navbar — link to Exchanges

**Files:** `src/components/navbar.tsx`.

- [ ] **Step 1: Add a `<Link>` between `appName` and the existing watchlist/request links**

Edit the navbar JSX. After the existing logo `<Link>` and before the `<nav>` block (or inside it), add:

```tsx
<Link href={`/${locale}/exchanges`}>{t("exchanges")}</Link>
```

(Insert it inside the `<nav className="flex items-center gap-3 text-sm">` block so it inherits the layout. It should be placed before `watchlist`/`request` since it's a public page.)

- [ ] **Step 2: Commit**
```bash
git add -A && git commit -m "feat(nav): Exchanges link in navbar"
```

---

## Task 8: i18n — exchanges block + nav label

**Files:** all 10 `messages/*.json`.

- [ ] **Step 1: Add `exchanges` block to `messages/en.json`**

```json
"exchanges": {
  "title": "Exchanges",
  "subtitle": "Top crypto exchanges ranked by trust score.",
  "rank": "#",
  "name": "Exchange",
  "trust": "Trust",
  "country": "Country",
  "founded": "Founded",
  "volume24h": "Volume (24h)",
  "empty": "No exchanges data yet."
}
```

Also add `"exchanges": "Exchanges"` inside the existing `common` block.

- [ ] **Step 2: Add same blocks + key to 9 other locales**

Use these translations for the visible labels (English fallback acceptable for any uncertain key — JSON shape MUST be identical across all 10):

| Locale | common.exchanges | exchanges.title | exchanges.subtitle |
|--------|------------------|-----------------|--------------------|
| ru | Биржи | Биржи | Топ криптобирж по trust score. |
| zh-CN | 交易所 | 交易所 | 按信任评分排名的顶级加密交易所。 |
| es | Exchanges | Exchanges | Principales exchanges por trust score. |
| ja | 取引所 | 取引所 | トラストスコアによる主要取引所。 |
| ko | 거래소 | 거래소 | 신뢰 점수 기준 주요 거래소. |
| de | Börsen | Börsen | Top-Krypto-Börsen nach Trust-Score. |
| fr | Plateformes | Plateformes | Principales plateformes par trust score. |
| pt-BR | Exchanges | Exchanges | Principais exchanges por trust score. |
| tr | Borsalar | Borsalar | Trust score'a göre en iyi borsalar. |

Column labels (rank/name/trust/country/founded/volume24h):
- ru: # / Биржа / Доверие / Страна / Основана / Объём (24ч)
- zh-CN: # / 交易所 / 信任 / 国家 / 成立 / 成交量 (24h)
- es: # / Exchange / Confianza / País / Fundado / Volumen (24h)
- ja: # / 取引所 / 信頼度 / 国 / 設立 / 出来高 (24h)
- ko: # / 거래소 / 신뢰도 / 국가 / 설립 / 거래량 (24h)
- de: # / Börse / Vertrauen / Land / Gegründet / Volumen (24h)
- fr: # / Plateforme / Confiance / Pays / Fondée / Volume (24h)
- pt-BR: # / Exchange / Confiança / País / Fundada / Volume (24h)
- tr: # / Borsa / Güven / Ülke / Kuruluş / Hacim (24s)

Empty state in each: English fallback "No exchanges data yet." OR a native translation if quick to pick.

- [ ] **Step 3: Run tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(i18n): exchanges strings + nav link in 10 locales"
```

---

## Task 9: Deploy + smoke

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
ssh dv@85.192.25.242 'cd ~/trientes && npm run build 2>&1 | tail -15'
```

- [ ] **Step 3: Restart everything (worker needs new code too)**
```bash
ssh dv@85.192.25.242 'pm2 restart trientes-web trientes-worker && pm2 status'
sleep 12
ssh dv@85.192.25.242 'pm2 logs trientes-worker --lines 30 --nostream'
```
Expected: see `[worker] exchanges-sync ok: ~100 in ...ms` line + `[worker] admin-added-sync ok: 0 in ...ms` (0 since no admin-added coins yet).

- [ ] **Step 4: Verify Redis**
```bash
ssh dv@85.192.25.242 "redis-cli get snapshot:exchanges:top100 | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); top=d[0]; print(f\"{len(d)} exchanges, top: {top[\\\"name\\\"]} (rank {top[\\\"trustScoreRank\\\"]}, vol ~\${top[\\\"volume24hUsd\\\"]/1e9:.1f}B)\")'"
ssh dv@85.192.25.242 "redis-cli get snapshot:list:admin"
```
Expected: ~100 exchanges; admin list empty (`[]`).

- [ ] **Step 5: Page smoke**
```bash
echo "=== /en/exchanges ==="
curl -s http://85.192.25.242/en/exchanges | grep -oE '(Binance|Coinbase|Kraken|Exchanges)' | sort -u
echo
echo "=== nav link present ==="
curl -s http://85.192.25.242/en | grep -oE 'href="/en/exchanges"' | head -1
echo
echo "=== other locales still 200 ==="
for L in en ru zh-CN ja de; do printf "%-6s %s\n" "$L" "$(curl -s -o /dev/null -w "%{http_code}" "http://85.192.25.242/$L/exchanges")"; done
```
Expected: exchange names render, nav link visible, all locales return 200 on `/exchanges`.

- [ ] **Step 6: Listing page still works**
```bash
curl -s http://85.192.25.242/en | grep -oE 'Bitcoin' | head -1
curl -s http://85.192.25.242/api/health | python3 -c "import json,sys; d=json.load(sys.stdin); print('health ok:', d['ok'])"
```

- [ ] **Step 7: Optional manual test — add an admin coin and verify it appears**

(Skipped in automation. The user can do this via `/en/admin/coins` after logging in.)

- [ ] **Step 8: Local tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
npm test
```
Expected: 91/91.

## Done criteria

- [ ] Migration `exchanges` applied
- [ ] Worker logs show `exchanges-sync ok: ~100` + `admin-added-sync ok` on startup
- [ ] `/en/exchanges` renders top exchanges (Binance, Coinbase, Kraken visible)
- [ ] Navbar has Exchanges link, visible in all locales
- [ ] All 91 unit tests pass

**Out of scope (Phase 8):** SSE + Binance WS, email notifications, audit log, CoinSnapshot cleanup job, TLS/DNS.
