# Trientes Phase 2: Sync Worker + Listing Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end pipeline from CoinGecko Free API to a public listing page. Worker fetches top-100 Layer-1 coins every 60s and global stats every 5 min, writes both to Redis (90s TTL) + Postgres. The home page `/[locale]/` reads from Redis (DB fallback) and renders a global-stats hero plus a coin table (rank, logo, symbol, name, price USD, %1h/24h/7d, market cap, 24h volume). ISR 60s. No sparkline, no search/sort UI, no SSE, no Binance WS, no per-currency switcher — all deferred to Phase 3+.

**Reference spec:** `docs/superpowers/specs/2026-05-19-trientes-cmc-clone-design.md`.
**Working directory:** `/Users/dmitry/Coinmarketcap` (local). Server: `dv@85.192.25.242`.

**Decisions confirmed by user (2026-05-20):**
- CoinGecko Free tier (no API key). ~30 req/min; 60s cadence with single endpoint fits.
- L1 category verified to work: `GET /coins/markets?category=layer-1&...&price_change_percentage=1h,24h,7d` returns BTC, ETH, etc.
- Admin-added coins (`source=ADMIN_ADDED`) deferred to Phase 5.
- USD-only column for now; formatters built to accept a currency arg for future use.

**Architecture (high level):**
```
CoinGecko Free API ──60s──▶ Worker (price-sync)  ──▶ Redis: snapshot:list:top100 (90s TTL)
                                                  └─▶ Postgres: Coin (upsert) + CoinSnapshot (append)

CoinGecko Free API ──5min─▶ Worker (global-stats-sync) ──▶ Redis: global:stats (300s TTL)
                                                       └─▶ Postgres: GlobalStats (upsert id=1)

Browser ─▶ Next.js /[locale]/ (ISR 60s) ─▶ Redis (snapshot:list:top100 + global:stats)
                                          fallback ─▶ Postgres (Coin JOIN latest CoinSnapshot)
```

---

## File structure produced by this plan

```
/Users/dmitry/Coinmarketcap/
├── prisma/
│   ├── schema.prisma              # +Coin, CoinSnapshot, GlobalStats, CoinSource enum
│   └── migrations/<ts>_coins/
├── src/
│   ├── lib/
│   │   ├── coingecko.ts           # typed client (parseMarketRow, parseGlobal, fetchTop100L1, fetchGlobal)
│   │   ├── format.ts              # formatPrice, formatCompact, formatPercent
│   │   ├── sync/
│   │   │   ├── orchestrator.ts    # pure: takes deps {coingecko, redis, prisma}, runs one tick
│   │   │   └── keys.ts            # Redis key constants
│   │   └── snapshot.ts            # readTop100() — Redis-first with DB fallback
│   ├── components/
│   │   ├── global-stats-hero.tsx
│   │   ├── coin-table.tsx
│   │   └── coin-row.tsx
│   └── app/[locale]/page.tsx      # rewritten to render hero + table
├── tests/
│   ├── format.test.ts
│   ├── coingecko-parse.test.ts
│   └── sync-orchestrator.test.ts
└── worker/
    └── index.ts                   # rewritten: node-cron schedules
```

---

## Task 1: Add `Coin`, `CoinSnapshot`, `GlobalStats` to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`
- New migration: `prisma/migrations/<ts>_coins/`

- [ ] **Step 1: Edit `prisma/schema.prisma`** — append (after existing models):

```prisma
enum CoinSource {
  AUTO_L1
  ADMIN_ADDED
}

model Coin {
  id           String      @id            // CoinGecko id, e.g. "bitcoin"
  symbol       String
  name         String
  slug         String      @unique
  rank         Int
  logoUrl      String?
  source       CoinSource  @default(AUTO_L1)
  isActive     Boolean     @default(true)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  snapshots    CoinSnapshot[]
}

model CoinSnapshot {
  id                String    @id @default(cuid())
  coinId            String
  coin              Coin      @relation(fields: [coinId], references: [id], onDelete: Cascade)
  priceUsd          Decimal   @db.Decimal(24, 10)
  marketCapUsd      Decimal   @db.Decimal(30, 2)
  volume24hUsd      Decimal   @db.Decimal(30, 2)
  pctChange1h       Float?
  pctChange24h      Float?
  pctChange7d       Float?
  circulatingSupply Decimal?  @db.Decimal(30, 2)
  totalSupply       Decimal?  @db.Decimal(30, 2)
  maxSupply         Decimal?  @db.Decimal(30, 2)
  fetchedAt         DateTime  @default(now())

  @@index([coinId, fetchedAt])
}

model GlobalStats {
  id                Int       @id @default(1)
  totalMarketCapUsd Decimal   @db.Decimal(30, 2)
  total24hVolumeUsd Decimal   @db.Decimal(30, 2)
  btcDominancePct   Float
  ethDominancePct   Float
  activeCryptos     Int
  markets           Int
  fetchedAt         DateTime  @default(now())
}
```

- [ ] **Step 2: Generate + apply migration locally**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" npx prisma migrate dev --name coins
```

Expected: creates `prisma/migrations/<ts>_coins/migration.sql`, applies it, regenerates client.

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "feat(db): Coin, CoinSnapshot, GlobalStats models"
```

---

## Task 2: CoinGecko response parsers (TDD)

**Files:** Create `tests/coingecko-parse.test.ts`, `src/lib/coingecko.ts` (parsers only — fetch in Task 3).

- [ ] **Step 1: Write failing tests**

Create `tests/coingecko-parse.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseMarketRow, parseGlobal } from "@/lib/coingecko";

describe("parseMarketRow", () => {
  const sample = {
    id: "bitcoin",
    symbol: "btc",
    name: "Bitcoin",
    image: "https://example.com/btc.png",
    market_cap_rank: 1,
    current_price: 76684,
    market_cap: 1536247155839,
    total_volume: 29246928093,
    circulating_supply: 20031709,
    total_supply: 20031709,
    max_supply: 21000000,
    price_change_percentage_1h_in_currency: 0.025,
    price_change_percentage_24h_in_currency: -0.466,
    price_change_percentage_7d_in_currency: -4.71,
  };

  it("maps a full row", () => {
    expect(parseMarketRow(sample)).toEqual({
      id: "bitcoin",
      symbol: "BTC",
      name: "Bitcoin",
      logoUrl: "https://example.com/btc.png",
      rank: 1,
      priceUsd: 76684,
      marketCapUsd: 1536247155839,
      volume24hUsd: 29246928093,
      circulatingSupply: 20031709,
      totalSupply: 20031709,
      maxSupply: 21000000,
      pctChange1h: 0.025,
      pctChange24h: -0.466,
      pctChange7d: -4.71,
    });
  });

  it("tolerates missing supplies and percent fields", () => {
    const minimal = {
      id: "x", symbol: "x", name: "X", image: null, market_cap_rank: 50,
      current_price: 1, market_cap: 100, total_volume: 10,
      circulating_supply: null, total_supply: null, max_supply: null,
    };
    const row = parseMarketRow(minimal);
    expect(row.circulatingSupply).toBeNull();
    expect(row.totalSupply).toBeNull();
    expect(row.maxSupply).toBeNull();
    expect(row.pctChange1h).toBeNull();
    expect(row.pctChange24h).toBeNull();
    expect(row.pctChange7d).toBeNull();
    expect(row.logoUrl).toBeNull();
  });

  it("uppercases symbol", () => {
    expect(parseMarketRow({ ...sample, symbol: "eth" }).symbol).toBe("ETH");
  });

  it("throws on missing required fields", () => {
    expect(() => parseMarketRow({})).toThrow();
    expect(() => parseMarketRow({ ...sample, id: undefined })).toThrow();
  });
});

describe("parseGlobal", () => {
  it("extracts the fields we need from /global response", () => {
    const raw = {
      data: {
        active_cryptocurrencies: 12345,
        markets: 789,
        total_market_cap: { usd: 2.5e12 },
        total_volume: { usd: 1.2e11 },
        market_cap_percentage: { btc: 52.3, eth: 16.7 },
      },
    };
    expect(parseGlobal(raw)).toEqual({
      totalMarketCapUsd: 2.5e12,
      total24hVolumeUsd: 1.2e11,
      btcDominancePct: 52.3,
      ethDominancePct: 16.7,
      activeCryptos: 12345,
      markets: 789,
    });
  });

  it("throws on malformed response", () => {
    expect(() => parseGlobal({})).toThrow();
    expect(() => parseGlobal({ data: {} })).toThrow();
  });
});
```

- [ ] **Step 2: Confirm tests fail (module missing)**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test -- tests/coingecko-parse.test.ts
```

- [ ] **Step 3: Implement parsers**

Create `src/lib/coingecko.ts`:
```ts
export type MarketRow = {
  id: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  rank: number;
  priceUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  pctChange1h: number | null;
  pctChange24h: number | null;
  pctChange7d: number | null;
};

export type GlobalSnap = {
  totalMarketCapUsd: number;
  total24hVolumeUsd: number;
  btcDominancePct: number;
  ethDominancePct: number;
  activeCryptos: number;
  markets: number;
};

function req<T>(v: T | undefined | null, name: string): T {
  if (v === undefined || v === null) {
    throw new Error(`coingecko: missing required field ${name}`);
  }
  return v;
}

export function parseMarketRow(raw: unknown): MarketRow {
  const r = raw as Record<string, unknown>;
  return {
    id: req(r.id as string | undefined, "id"),
    symbol: String(req(r.symbol as string | undefined, "symbol")).toUpperCase(),
    name: req(r.name as string | undefined, "name"),
    logoUrl: (r.image as string | null) ?? null,
    rank: req(r.market_cap_rank as number | undefined, "market_cap_rank"),
    priceUsd: req(r.current_price as number | undefined, "current_price"),
    marketCapUsd: req(r.market_cap as number | undefined, "market_cap"),
    volume24hUsd: req(r.total_volume as number | undefined, "total_volume"),
    circulatingSupply: (r.circulating_supply as number | null) ?? null,
    totalSupply: (r.total_supply as number | null) ?? null,
    maxSupply: (r.max_supply as number | null) ?? null,
    pctChange1h: (r.price_change_percentage_1h_in_currency as number | null) ?? null,
    pctChange24h: (r.price_change_percentage_24h_in_currency as number | null) ?? null,
    pctChange7d: (r.price_change_percentage_7d_in_currency as number | null) ?? null,
  };
}

export function parseGlobal(raw: unknown): GlobalSnap {
  const root = raw as { data?: Record<string, unknown> };
  const d = req(root.data, "data");
  const totalMc = (d.total_market_cap as Record<string, number> | undefined)?.usd;
  const totalVol = (d.total_volume as Record<string, number> | undefined)?.usd;
  const dom = (d.market_cap_percentage as Record<string, number> | undefined) ?? {};
  return {
    totalMarketCapUsd: req(totalMc, "total_market_cap.usd"),
    total24hVolumeUsd: req(totalVol, "total_volume.usd"),
    btcDominancePct: req(dom.btc, "market_cap_percentage.btc"),
    ethDominancePct: req(dom.eth, "market_cap_percentage.eth"),
    activeCryptos: req(d.active_cryptocurrencies as number | undefined, "active_cryptocurrencies"),
    markets: req(d.markets as number | undefined, "markets"),
  };
}
```

- [ ] **Step 4: Confirm tests pass**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test -- tests/coingecko-parse.test.ts
```
Expected: 6/6 pass. Total suite: 26/26.

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(coingecko): typed parsers for /coins/markets + /global"
```

---

## Task 3: CoinGecko fetch wrappers + L1 verification

**Files:** Modify `src/lib/coingecko.ts` to add fetch functions.

- [ ] **Step 1: Append fetch functions** to `src/lib/coingecko.ts`:

```ts
const CG_BASE = "https://api.coingecko.com/api/v3";

async function cgFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const url = `${CG_BASE}${path}?${qs}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // Next caches fetch by default; we want fresh data on every worker tick.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`coingecko ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchTop100L1(): Promise<MarketRow[]> {
  const raw = await cgFetch("/coins/markets", {
    vs_currency: "usd",
    category: "layer-1",
    order: "market_cap_desc",
    per_page: "100",
    page: "1",
    sparkline: "false",
    price_change_percentage: "1h,24h,7d",
  });
  if (!Array.isArray(raw)) throw new Error("coingecko /coins/markets: not an array");
  return raw.map(parseMarketRow);
}

export async function fetchGlobalSnap(): Promise<GlobalSnap> {
  const raw = await cgFetch("/global", {});
  return parseGlobal(raw);
}
```

- [ ] **Step 2: Verify L1 endpoint live**

Run from local Mac:
```bash
curl -s 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=layer-1&order=market_cap_desc&per_page=5&page=1&price_change_percentage=1h,24h,7d' \
  | python3 -c "import json,sys; rows=json.load(sys.stdin); print(len(rows)); [print(r['market_cap_rank'], r['symbol']) for r in rows]"
```
Expected: prints `5` and lists 5 rows like `1 btc`, `2 eth`, etc. Ranks should be ascending 1, 2, 3, 4, 5.

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "feat(coingecko): fetchTop100L1 + fetchGlobalSnap"
```

---

## Task 4: Number/percent formatters (TDD)

**Files:** Create `tests/format.test.ts`, `src/lib/format.ts`.

- [ ] **Step 1: Write tests**

Create `tests/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatPrice, formatCompact, formatPercent } from "@/lib/format";

describe("formatPrice", () => {
  it("uses 2 decimals for >= 1", () => {
    expect(formatPrice(76684)).toBe("$76,684.00");
    expect(formatPrice(2108.55)).toBe("$2,108.55");
    expect(formatPrice(1.05)).toBe("$1.05");
  });
  it("uses up to 6 decimals for < 1", () => {
    expect(formatPrice(0.04321)).toBe("$0.043210");
    expect(formatPrice(0.00001234)).toBe("$0.000012");
  });
  it("shows 0 cleanly", () => {
    expect(formatPrice(0)).toBe("$0.00");
  });
});

describe("formatCompact", () => {
  it("uses B/M/K suffixes", () => {
    expect(formatCompact(1_536_247_155_839)).toBe("$1.54T");
    expect(formatCompact(254_473_187_733)).toBe("$254.47B");
    expect(formatCompact(29_246_928_093)).toBe("$29.25B");
    expect(formatCompact(1_500_000)).toBe("$1.50M");
    expect(formatCompact(1_500)).toBe("$1.50K");
    expect(formatCompact(999)).toBe("$999.00");
  });
});

describe("formatPercent", () => {
  it("adds sign and 2 decimals", () => {
    expect(formatPercent(2.345)).toBe("+2.35%");
    expect(formatPercent(-1.234)).toBe("-1.23%");
    expect(formatPercent(0)).toBe("+0.00%");
  });
  it("returns em dash for null", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });
});
```

- [ ] **Step 2: Confirm tests fail**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test -- tests/format.test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/format.ts`:
```ts
export function formatPrice(value: number): string {
  if (value >= 1) {
    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (value === 0) return "$0.00";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  })}`;
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
```

- [ ] **Step 4: Run all tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: 30/30 (20 existing + 6 coingecko + 4 prep there's no exactly 30; the real total = 20 + 6 + 11 = ~37 with format tests, accept whatever number comes out — must be >= old count plus new).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(format): price/compact/percent formatters with tests"
```

---

## Task 5: Sync orchestrator (TDD with injected deps)

**Files:** Create `src/lib/sync/keys.ts`, `tests/sync-orchestrator.test.ts`, `src/lib/sync/orchestrator.ts`.

- [ ] **Step 1: Redis key constants**

Create `src/lib/sync/keys.ts`:
```ts
export const KEYS = {
  topList: "snapshot:list:top100",
  coin: (id: string) => `snapshot:coin:${id}`,
  globalStats: "global:stats",
} as const;

export const TTL = {
  snapshot: 90,      // seconds — must outlast the 60s sync interval
  globalStats: 300,  // 5 min
} as const;
```

- [ ] **Step 2: Write failing tests**

Create `tests/sync-orchestrator.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { syncPrices, syncGlobal } from "@/lib/sync/orchestrator";
import { KEYS } from "@/lib/sync/keys";
import type { MarketRow, GlobalSnap } from "@/lib/coingecko";

function makeFakes() {
  const redisStore = new Map<string, string>();
  const fakeRedis = {
    set: vi.fn(async (k: string, v: string, _mode: string, _ttl: number) => {
      redisStore.set(k, v);
      return "OK";
    }),
  };
  const upsertedCoins: Array<{ id: string; rank: number }> = [];
  const createdSnapshots: Array<{ coinId: string; priceUsd: number }> = [];
  const fakePrisma = {
    coin: {
      upsert: vi.fn(async ({ where, update, create }: any) => {
        upsertedCoins.push({ id: where.id, rank: create.rank });
        return { id: where.id, ...create, ...update };
      }),
    },
    coinSnapshot: {
      create: vi.fn(async ({ data }: any) => {
        createdSnapshots.push({ coinId: data.coinId, priceUsd: data.priceUsd });
        return { id: "s1", ...data };
      }),
    },
    globalStats: {
      upsert: vi.fn(async ({ create }: any) => create),
    },
  };
  return { redisStore, fakeRedis, fakePrisma, upsertedCoins, createdSnapshots };
}

const row: MarketRow = {
  id: "bitcoin",
  symbol: "BTC",
  name: "Bitcoin",
  logoUrl: "https://example.com/btc.png",
  rank: 1,
  priceUsd: 76684,
  marketCapUsd: 1.5e12,
  volume24hUsd: 2.9e10,
  circulatingSupply: 2e7,
  totalSupply: 2e7,
  maxSupply: 2.1e7,
  pctChange1h: 0.02,
  pctChange24h: -0.46,
  pctChange7d: -4.71,
};

describe("syncPrices", () => {
  it("writes list snapshot to Redis", async () => {
    const { redisStore, fakeRedis, fakePrisma } = makeFakes();
    await syncPrices({
      fetchTop100L1: async () => [row],
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    const stored = redisStore.get(KEYS.topList);
    expect(stored).toBeDefined();
    expect(JSON.parse(stored!)).toHaveLength(1);
    expect(JSON.parse(stored!)[0].id).toBe("bitcoin");
  });

  it("upserts Coin and creates CoinSnapshot per row", async () => {
    const { fakeRedis, fakePrisma, upsertedCoins, createdSnapshots } = makeFakes();
    await syncPrices({
      fetchTop100L1: async () => [row, { ...row, id: "ethereum", symbol: "ETH", rank: 2, priceUsd: 2108 }],
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    expect(upsertedCoins).toEqual([
      { id: "bitcoin", rank: 1 },
      { id: "ethereum", rank: 2 },
    ]);
    expect(createdSnapshots.map((s) => s.coinId)).toEqual(["bitcoin", "ethereum"]);
  });

  it("returns the count", async () => {
    const { fakeRedis, fakePrisma } = makeFakes();
    const result = await syncPrices({
      fetchTop100L1: async () => [row, { ...row, id: "ethereum" }],
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    expect(result).toEqual({ count: 2 });
  });

  it("propagates fetch errors", async () => {
    const { fakeRedis, fakePrisma } = makeFakes();
    await expect(
      syncPrices({
        fetchTop100L1: async () => { throw new Error("network"); },
        redis: fakeRedis as never,
        prisma: fakePrisma as never,
      }),
    ).rejects.toThrow("network");
  });
});

describe("syncGlobal", () => {
  const snap: GlobalSnap = {
    totalMarketCapUsd: 2.5e12,
    total24hVolumeUsd: 1.2e11,
    btcDominancePct: 52.3,
    ethDominancePct: 16.7,
    activeCryptos: 12345,
    markets: 789,
  };

  it("writes Redis + upserts GlobalStats", async () => {
    const { redisStore, fakeRedis, fakePrisma } = makeFakes();
    await syncGlobal({
      fetchGlobalSnap: async () => snap,
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    expect(JSON.parse(redisStore.get(KEYS.globalStats)!)).toMatchObject({
      btcDominancePct: 52.3,
    });
    expect(fakePrisma.globalStats.upsert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Confirm tests fail**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test -- tests/sync-orchestrator.test.ts
```

- [ ] **Step 4: Implement orchestrator**

Create `src/lib/sync/orchestrator.ts`:
```ts
import type { MarketRow, GlobalSnap } from "@/lib/coingecko";
import { KEYS, TTL } from "./keys";

// Minimal interfaces — we only use what we need so tests can pass fakes.
type RedisLike = {
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
};

type PrismaLike = {
  coin: {
    upsert(args: {
      where: { id: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
  };
  coinSnapshot: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  globalStats: {
    upsert(args: {
      where: { id: number };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

export async function syncPrices(deps: {
  fetchTop100L1: () => Promise<MarketRow[]>;
  redis: RedisLike;
  prisma: PrismaLike;
}): Promise<{ count: number }> {
  const rows = await deps.fetchTop100L1();

  // Write Redis snapshot first — fast cache for readers.
  const listJson = JSON.stringify(rows);
  await deps.redis.set(KEYS.topList, listJson, "EX", TTL.snapshot);

  // Per-coin snapshot (used by future detail pages).
  for (const r of rows) {
    await deps.redis.set(KEYS.coin(r.id), JSON.stringify(r), "EX", TTL.snapshot);
  }

  // Durable writes.
  for (const r of rows) {
    const slug = r.id; // CoinGecko id is already a slug.
    await deps.prisma.coin.upsert({
      where: { id: r.id },
      update: {
        symbol: r.symbol,
        name: r.name,
        logoUrl: r.logoUrl,
        rank: r.rank,
      },
      create: {
        id: r.id,
        symbol: r.symbol,
        name: r.name,
        slug,
        rank: r.rank,
        logoUrl: r.logoUrl,
        source: "AUTO_L1",
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
      },
    });
  }

  return { count: rows.length };
}

export async function syncGlobal(deps: {
  fetchGlobalSnap: () => Promise<GlobalSnap>;
  redis: RedisLike;
  prisma: PrismaLike;
}): Promise<void> {
  const snap = await deps.fetchGlobalSnap();
  await deps.redis.set(KEYS.globalStats, JSON.stringify(snap), "EX", TTL.globalStats);
  await deps.prisma.globalStats.upsert({
    where: { id: 1 },
    update: { ...snap },
    create: { id: 1, ...snap },
  });
}
```

- [ ] **Step 5: Confirm tests pass**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: all old + new tests green.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(sync): orchestrator for prices + global stats with tests"
```

---

## Task 6: Worker — node-cron schedules

**Files:**
- Modify: `worker/index.ts`
- Modify: `package.json` (add node-cron)

- [ ] **Step 1: Install node-cron**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
npm install node-cron
npm install -D @types/node-cron
```

- [ ] **Step 2: Rewrite `worker/index.ts`**

```ts
import { config } from "dotenv";
config({ path: ".env.local" });

import cron from "node-cron";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { fetchTop100L1, fetchGlobalSnap } from "../src/lib/coingecko";
import { syncPrices, syncGlobal } from "../src/lib/sync/orchestrator";

async function runPriceSync() {
  const t0 = Date.now();
  try {
    const { count } = await syncPrices({
      fetchTop100L1,
      redis: redis as never,
      prisma: prisma as never,
    });
    console.log(`[worker] price-sync ok: ${count} coins in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[worker] price-sync failed:`, err);
  }
}

async function runGlobalSync() {
  const t0 = Date.now();
  try {
    await syncGlobal({
      fetchGlobalSnap,
      redis: redis as never,
      prisma: prisma as never,
    });
    console.log(`[worker] global-sync ok in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[worker] global-sync failed:`, err);
  }
}

async function main() {
  console.log("[worker] starting…");
  await prisma.$queryRaw`SELECT 1`;
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
  await redis.ping();
  console.log("[worker] connections ok.");

  // Run once at startup so Redis has data immediately.
  await runPriceSync();
  await runGlobalSync();

  // 60s for prices, 5 min for global stats.
  cron.schedule("*/60 * * * * *", () => void runPriceSync());
  cron.schedule("*/5 * * * *", () => void runGlobalSync());

  const shutdown = async (sig: string) => {
    console.log(`[worker] received ${sig}, shutting down`);
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Smoke test (local — needs local Redis running)**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
brew services start redis 2>/dev/null || true
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" REDIS_URL="redis://127.0.0.1:6379" timeout 10 npm run worker:start 2>&1
```

Expected output includes:
- `[worker] starting…`
- `[worker] connections ok.`
- `[worker] price-sync ok: 100 coins in ...ms`
- `[worker] global-sync ok in ...ms`

Then kill via timeout. If CoinGecko rate-limits (HTTP 429), retry once after a minute — the live verification in Task 3 already confirmed the endpoint works.

- [ ] **Step 4: Verify Redis was populated**
```bash
redis-cli get snapshot:list:top100 | python3 -c "import json,sys; rows=json.loads(sys.stdin.read()); print(f'{len(rows)} coins, top: {rows[0][\"symbol\"]} ${rows[0][\"priceUsd\"]:.2f}')"
redis-cli get global:stats | python3 -m json.tool
```
Expected: `100 coins, top: BTC $...` and global stats JSON.

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(worker): node-cron schedules for price-sync + global-sync"
```

---

## Task 7: Snapshot reader — Redis first, DB fallback

**Files:** Create `src/lib/snapshot.ts`.

- [ ] **Step 1: Implement**

```ts
import type { MarketRow, GlobalSnap } from "@/lib/coingecko";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { KEYS } from "@/lib/sync/keys";

async function redisGet(key: string): Promise<string | null> {
  if (redis.status === "wait" || redis.status === "end") {
    try {
      await redis.connect();
    } catch {
      return null;
    }
  }
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function readTop100(): Promise<MarketRow[]> {
  const cached = await redisGet(KEYS.topList);
  if (cached) {
    try {
      return JSON.parse(cached) as MarketRow[];
    } catch {
      // fall through to DB
    }
  }

  // DB fallback: latest snapshot per coin, ordered by rank.
  const coins = await prisma.coin.findMany({
    where: { isActive: true, source: "AUTO_L1" },
    orderBy: { rank: "asc" },
    take: 100,
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
      };
    });
}

export async function readGlobalStats(): Promise<GlobalSnap | null> {
  const cached = await redisGet(KEYS.globalStats);
  if (cached) {
    try {
      return JSON.parse(cached) as GlobalSnap;
    } catch {
      // fall through
    }
  }
  const row = await prisma.globalStats.findUnique({ where: { id: 1 } });
  if (!row) return null;
  return {
    totalMarketCapUsd: Number(row.totalMarketCapUsd),
    total24hVolumeUsd: Number(row.total24hVolumeUsd),
    btcDominancePct: row.btcDominancePct,
    ethDominancePct: row.ethDominancePct,
    activeCryptos: row.activeCryptos,
    markets: row.markets,
  };
}
```

- [ ] **Step 2: Commit**
```bash
git add -A
git commit -m "feat(snapshot): Redis-first reader with Postgres fallback"
```

---

## Task 8: Global stats hero + coin table components

**Files:**
- Create: `src/components/global-stats-hero.tsx`, `src/components/coin-row.tsx`, `src/components/coin-table.tsx`

- [ ] **Step 1: Add a translations block for new strings**

Edit `messages/en.json` — add a new top-level `listing` block:
```json
"listing": {
  "rank": "#",
  "name": "Name",
  "price": "Price",
  "change1h": "1h %",
  "change24h": "24h %",
  "change7d": "7d %",
  "marketCap": "Market cap",
  "volume24h": "Volume (24h)",
  "loadingFallback": "Fetching latest data…",
  "globalMarketCap": "Total market cap",
  "globalVolume": "24h trading vol",
  "btcDominance": "BTC dominance",
  "ethDominance": "ETH dominance"
}
```

Do the same for all 9 other locales. Use these translations (keep keys identical):

`ru`: `{"rank":"#","name":"Название","price":"Цена","change1h":"1ч %","change24h":"24ч %","change7d":"7д %","marketCap":"Капитализация","volume24h":"Объём (24ч)","loadingFallback":"Загружаем данные…","globalMarketCap":"Общая капитализация","globalVolume":"Объём за 24ч","btcDominance":"Доминация BTC","ethDominance":"Доминация ETH"}`

For the remaining 8 (`zh-CN`, `es`, `ja`, `ko`, `de`, `fr`, `pt-BR`, `tr`) translate the labels into the target language using a sensible short rendering. If unsure, English is acceptable as a fallback — but every locale's JSON MUST have all the keys (next-intl errors on missing keys in production).

- [ ] **Step 2: Create `src/components/global-stats-hero.tsx`**
```tsx
import { useTranslations } from "next-intl";
import type { GlobalSnap } from "@/lib/coingecko";
import { formatCompact, formatPercent } from "@/lib/format";

export function GlobalStatsHero({ stats }: { stats: GlobalSnap | null }) {
  const t = useTranslations("listing");
  if (!stats) return null;
  const cards = [
    { label: t("globalMarketCap"), value: formatCompact(stats.totalMarketCapUsd) },
    { label: t("globalVolume"), value: formatCompact(stats.total24hVolumeUsd) },
    { label: t("btcDominance"), value: `${stats.btcDominancePct.toFixed(1)}%` },
    { label: t("ethDominance"), value: `${stats.ethDominancePct.toFixed(1)}%` },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      {cards.map((c) => (
        <div key={c.label} className="border rounded-lg p-4">
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div className="text-2xl font-semibold mt-1">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/coin-row.tsx`**

```tsx
import Image from "next/image";
import type { MarketRow } from "@/lib/coingecko";
import { formatPrice, formatCompact, formatPercent } from "@/lib/format";

function pctClass(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  return v >= 0 ? "text-green-500" : "text-red-500";
}

export function CoinRow({ row }: { row: MarketRow }) {
  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="px-3 py-3 text-sm text-muted-foreground tabular-nums">{row.rank}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
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
        </div>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{formatPrice(row.priceUsd)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange1h)}`}>{formatPercent(row.pctChange1h)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange24h)}`}>{formatPercent(row.pctChange24h)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange7d)}`}>{formatPercent(row.pctChange7d)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{formatCompact(row.marketCapUsd)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{formatCompact(row.volume24hUsd)}</td>
    </tr>
  );
}
```

- [ ] **Step 4: Add `coin-images.coingecko.com` to `next.config.ts` image domains**

Edit `next.config.ts`:
```ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "coin-images.coingecko.com" },
      { protocol: "https", hostname: "assets.coingecko.com" },
    ],
  },
};

export default withNextIntl(nextConfig);
```

(Since the `<Image>` above passes `unoptimized`, this is belt-and-suspenders — but adding the domains is the right pattern for the future.)

- [ ] **Step 5: Create `src/components/coin-table.tsx`**

```tsx
import { useTranslations } from "next-intl";
import type { MarketRow } from "@/lib/coingecko";
import { CoinRow } from "./coin-row";

export function CoinTable({ rows }: { rows: MarketRow[] }) {
  const t = useTranslations("listing");
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 text-left font-medium">{t("rank")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("name")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("price")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("change1h")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("change24h")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("change7d")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("marketCap")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("volume24h")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CoinRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(ui): GlobalStatsHero + CoinTable + CoinRow components"
```

---

## Task 9: Rewrite home page to use snapshot reader

**Files:** Modify `src/app/[locale]/page.tsx`.

- [ ] **Step 1: Replace home page**

Replace `src/app/[locale]/page.tsx` with:
```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { readTop100, readGlobalStats } from "@/lib/snapshot";
import { GlobalStatsHero } from "@/components/global-stats-hero";
import { CoinTable } from "@/components/coin-table";

export const revalidate = 60; // ISR: regenerate every 60 seconds.

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  const tl = await getTranslations("listing");

  const [rows, stats] = await Promise.all([readTop100(), readGlobalStats()]);

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-4xl font-bold">{t("appName")}</h1>
        <p className="text-muted-foreground mt-1">{t("tagline")}</p>
      </header>
      <GlobalStatsHero stats={stats} />
      {rows.length > 0 ? (
        <CoinTable rows={rows} />
      ) : (
        <p className="text-muted-foreground">{tl("loadingFallback")}</p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add -A
git commit -m "feat(home): top-100 L1 table + global stats hero (ISR 60s)"
```

---

## Task 10: Deploy to server + final smoke test

**Files:** Server-side only (no new repo files).

- [ ] **Step 1: Push and pull on the server**

```bash
git push origin main
ssh dv@85.192.25.242 'cd ~/trientes && git stash && git pull && git stash drop 2>/dev/null; true'
```

- [ ] **Step 2: Install new deps, apply migration, rebuild**

```bash
ssh dv@85.192.25.242 'cd ~/trientes && npm ci 2>&1 | tail -5'
ssh dv@85.192.25.242 'cd ~/trientes && DATABASE_URL=$(grep ^DATABASE_URL .env | cut -d= -f2-) npx prisma migrate deploy'
ssh dv@85.192.25.242 'cd ~/trientes && npm run build 2>&1 | tail -15'
```
Expected: migrate applies `coins` migration; build succeeds.

- [ ] **Step 3: Restart PM2 processes**

```bash
ssh dv@85.192.25.242 'pm2 restart trientes-web trientes-worker && pm2 status'
```

- [ ] **Step 4: Verify worker is actually fetching**

Wait ~5 seconds, then:
```bash
ssh dv@85.192.25.242 'pm2 logs trientes-worker --lines 20 --nostream'
```
Expected lines:
- `[worker] connections ok.`
- `[worker] price-sync ok: 100 coins in ...ms`
- `[worker] global-sync ok in ...ms`

If price-sync fails with a 429 (rate limit), wait 60s and retry: `ssh dv@85.192.25.242 'pm2 logs trientes-worker --lines 30 --nostream'`.

- [ ] **Step 5: Verify Redis has data on the server**

```bash
ssh dv@85.192.25.242 "redis-cli get snapshot:list:top100 | python3 -c 'import json,sys; r=json.loads(sys.stdin.read()); print(f\"{len(r)} coins, top 3: \", [c[\"symbol\"] for c in r[:3]])'"
ssh dv@85.192.25.242 "redis-cli get global:stats"
```
Expected: 100 coins, top 3 contains BTC, ETH; global stats JSON not empty.

- [ ] **Step 6: Verify the listing page renders coins**

```bash
curl -s http://85.192.25.242/en | grep -oE '(Bitcoin|Ethereum)' | sort -u
```
Expected: prints `Bitcoin` and `Ethereum` (matched in the rendered HTML).

Health check still passes:
```bash
curl -s http://85.192.25.242/api/health | python3 -m json.tool
```
Expected: `"ok": true`.

- [ ] **Step 7: Sanity-check the unit test suite still passes locally**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
npm test
```
Expected: all tests pass.

- [ ] **Step 8: Commit if any post-deploy tweaks were needed**

If no further changes, no commit needed. Otherwise:
```bash
git add -A && git commit -m "chore: Phase 2 deploy adjustments" && git push origin main
```

---

## Phase 2 done-criteria

After Task 10:

- [ ] `pm2 status` on the server shows both `trientes-web` and `trientes-worker` online
- [ ] `redis-cli get snapshot:list:top100` on the server returns a 100-element JSON array
- [ ] `http://85.192.25.242/en` renders the top-100 table with global stats hero
- [ ] All locales still render (`/en`, `/ru`, etc.) — quick spot check with curl
- [ ] All unit tests pass locally (no regressions)

**Out of scope (Phase 3+):**
- Sparkline rendering, search/sort, pagination UI — Phase 3
- Coin detail page with chart — Phase 4
- Watchlist + coin requests — Phase 5
- Admin panel — Phase 6
- Exchanges listing — Phase 7
- Per-currency switcher (USD/EUR/RUB/etc.) — Phase 7
- SSE live updates, Binance WS — Phase 7
- TLS + DNS for trientes.org — Phase 8
