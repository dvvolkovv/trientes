# Exchange Card + CoinPaprika Sync (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring CoinPaprika exchanges (~90 new rows, $100k/24h filter) into the catalog, extend the `Exchange` model with description/type/fiats/socials/currencies/pairs, and replace the "row click → external redirect" flow with an internal `/exchanges/[id]` card page.

**Architecture:** Single-table extension (new optional columns on `Exchange`, `source` enum identifies origin). CoinPaprika fetcher + orchestrator sync function called hourly by the existing worker, runs **after** the CoinGecko sync and only **fills nulls** on overlapping rows (CG fields stay authoritative). Server-rendered card at `/{locale}/exchanges/[id]` reads the row directly via Prisma — no Redis caching layer for the detail view in Slice A.

**Tech Stack:** Next.js (App Router), Prisma (Postgres), Vitest (unit tests), node-cron (worker), next-intl (i18n), Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-26-exchange-card-and-cp-sync-design.md`

---

## File Structure

**New files:**

- `prisma/migrations/20260526180000_exchange_card_foundation/migration.sql` — schema migration.
- `src/lib/coinpaprika.ts` — fetcher + zod schema + type mapper + alias map.
- `tests/coinpaprika.test.ts` — unit tests for fetcher parsing and type mapping.
- `src/app/[locale]/exchanges/[id]/page.tsx` — server-rendered card route.
- `src/app/[locale]/exchanges/[id]/not-found.tsx` — localized 404.
- `src/components/exchange-card/header.tsx`
- `src/components/exchange-card/parameters.tsx`
- `src/components/exchange-card/metrics.tsx`
- `src/components/exchange-card/description.tsx`
- `src/components/exchange-card/socials.tsx`
- `src/components/exchange-card/outbound-cta.tsx`

**Modified files:**

- `prisma/schema.prisma` — add 7 fields to `Exchange`.
- `src/lib/sync/orchestrator.ts` — add `syncCoinPaprikaExchanges`.
- `tests/sync-orchestrator.test.ts` — add tests for the new function.
- `worker/index.ts` — register `runCoinPaprikaSync` + cron at `25,55 * * * *`.
- `src/components/exchanges-table.tsx` — swap external `<a>` for internal `<Link>` (desktop + mobile).
- `src/lib/curated-exchanges.ts` — extend `CURATED_EXCHANGES` entries with new optional fields (set to null) so the merged list is type-compatible.
- `src/lib/coingecko.ts` — extend the `Exchange` TypeScript type with new optional fields so callers compile.
- `messages/{en,ru,de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json` — add `exchangeCard.*` namespace.

---

## Task 1: Prisma migration — extend `Exchange`

**Files:**
- Modify: `prisma/schema.prisma` (lines 204–221, model `Exchange`)
- Create: `prisma/migrations/20260526180000_exchange_card_foundation/migration.sql`

- [ ] **Step 1: Edit `prisma/schema.prisma` to add new fields**

Replace the existing `Exchange` model body (lines 204–221) with:

```prisma
model Exchange {
  id                  String              @id // CoinGecko id, e.g. "binance"
  name                String
  logoUrl             String?
  country             String?
  yearEstablished     Int?
  trustScore          Int?
  trustScoreRank      Int?
  volume24hBtc        Float
  volume24hUsd        Float
  url                 String?
  hasTradingIncentive Boolean             @default(false)
  description         String?             @db.Text
  exchangeType        String?             // "CEX" | "DEX" | "HYBRID" | "OTHER"
  currencies          Int?
  pairsCount          Int?
  fiats               String[]            @default([])
  socials             Json?
  source              String              @default("cg") // "cg" | "cp" | "curated"
  fetchedAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  watchedBy           ExchangeWatchlist[]

  @@index([trustScoreRank])
  @@index([source])
}
```

- [ ] **Step 2: Generate migration SQL (do not apply yet)**

Run: `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --script > /tmp/diff.sql` to preview, OR write the migration file directly:

Create `prisma/migrations/20260526180000_exchange_card_foundation/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Exchange"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "exchangeType" TEXT,
  ADD COLUMN "currencies" INTEGER,
  ADD COLUMN "pairsCount" INTEGER,
  ADD COLUMN "fiats" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "socials" JSONB,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'cg';

-- Mark the curated entry distinctly.
UPDATE "Exchange" SET "source" = 'curated' WHERE "id" = 'richamster';

-- CreateIndex
CREATE INDEX "Exchange_source_idx" ON "Exchange"("source");
```

- [ ] **Step 3: Apply migration**

Run: `npx prisma migrate deploy`
Expected: `1 migration found in prisma/migrations` then `Applying migration ...20260526180000_exchange_card_foundation`. Exit 0.

- [ ] **Step 4: Regenerate Prisma Client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`.

- [ ] **Step 5: Verify columns exist + curated backfill**

Run: `psql "$DATABASE_URL" -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Exchange' AND column_name IN ('description','exchangeType','currencies','pairsCount','fiats','socials','source');"`
Expected: all 7 rows returned.

Run: `psql "$DATABASE_URL" -c "SELECT id, source FROM \"Exchange\" WHERE id='richamster';"`
Expected: `richamster | curated`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260526180000_exchange_card_foundation
git commit -m "feat(db): extend Exchange with description, type, fiats, socials, source"
```

---

## Task 2: Extend TypeScript `Exchange` type + curated list

The `Exchange` type in `src/lib/coingecko.ts` is the shape used across the app. The new DB columns need matching fields here so TypeScript compiles after the migration. Curated entries need the same shape.

**Files:**
- Modify: `src/lib/coingecko.ts` (Exchange type definition, ~lines 279–291)
- Modify: `src/lib/curated-exchanges.ts`

- [ ] **Step 1: Find the Exchange type in `src/lib/coingecko.ts`**

Run: `grep -n "^export type Exchange\|export interface Exchange" src/lib/coingecko.ts`
Expected: a line number around 279. Read that block.

- [ ] **Step 2: Extend the type**

Add these optional fields **at the end** of the type definition (keep existing fields intact):

```ts
  description: string | null;
  exchangeType: "CEX" | "DEX" | "HYBRID" | "OTHER" | null;
  currencies: number | null;
  pairsCount: number | null;
  fiats: string[];
  socials: {
    twitter?: string;
    telegram?: string;
    facebook?: string;
    github?: string;
    reddit?: string;
    youtube?: string;
    website?: string;
  } | null;
  source: "cg" | "cp" | "curated";
```

- [ ] **Step 3: Extend the existing `parseExchange()` mapper to emit the new fields**

In the same file, find `parseExchange` (it's the one the existing test in `tests/coingecko-exchanges.test.ts` exercises). Add these fields to the returned object — CoinGecko's response does not contain them, so they're constants:

```ts
    description: null,
    exchangeType: null,
    currencies: null,
    pairsCount: null,
    fiats: [],
    socials: null,
    source: "cg" as const,
```

- [ ] **Step 4: Update curated entries in `src/lib/curated-exchanges.ts`**

Replace the existing `CURATED_EXCHANGES` array contents with:

```ts
export const CURATED_EXCHANGES: Exchange[] = [
  {
    id: "richamster",
    name: "Richamster.com",
    logoUrl: "https://news.richamster.com/img/logo.png",
    country: "Ukraine",
    yearEstablished: null,
    trustScore: 10,
    trustScoreRank: null,
    volume24hBtc: 0,
    volume24hUsd: 0,
    url: "https://richamster.com",
    hasTradingIncentive: false,
    description: null,
    exchangeType: "CEX",
    currencies: null,
    pairsCount: null,
    fiats: [],
    socials: null,
    source: "curated",
  },
];
```

- [ ] **Step 5: Update the existing `coingecko-exchanges` test to expect the new fields**

Edit `tests/coingecko-exchanges.test.ts`. In the "maps fields and computes USD volume from a btcUsd ratio" test, extend the expected object with:

```ts
      description: null,
      exchangeType: null,
      currencies: null,
      pairsCount: null,
      fiats: [],
      socials: null,
      source: "cg",
```

In the "handles missing optionals as null" test, do the same.

- [ ] **Step 6: Run the test to make sure existing parser still passes**

Run: `npx vitest run tests/coingecko-exchanges.test.ts`
Expected: all tests PASS.

- [ ] **Step 7: Type-check the whole repo**

Run: `npx tsc --noEmit`
Expected: no errors. If errors mention missing fields in `CURATED_EXCHANGES` or `parseExchange`, fix them — those are the only places that construct an `Exchange` literal.

- [ ] **Step 8: Commit**

```bash
git add src/lib/coingecko.ts src/lib/curated-exchanges.ts tests/coingecko-exchanges.test.ts
git commit -m "feat(types): extend Exchange type with description/type/fiats/socials/source"
```

---

## Task 3: CoinPaprika fetcher — Zod schema + raw types (TDD)

**Files:**
- Create: `src/lib/coinpaprika.ts`
- Create: `tests/coinpaprika.test.ts`

- [ ] **Step 1: Write failing test for the schema parser**

Create `tests/coinpaprika.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCoinPaprikaExchange, cpTypeToExchangeType } from "@/lib/coinpaprika";

describe("parseCoinPaprikaExchange", () => {
  const sample = {
    id: "richamster",
    name: "Richamster",
    type: ["cex"],
    description: "Short description.",
    active: true,
    markets_data_fetched: true,
    adjusted_rank: 217,
    currencies: 24,
    fiats: [{ name: "Ukrainian Hryvnia", symbol: "UAH" }],
    quotes: { USD: { adjusted_volume_24h: 77211.14 } },
    links: { twitter: ["https://twitter.com/Richamster_com"], website: ["https://richamster.com"] },
    last_updated: "2026-05-26T19:27:34Z",
  };

  it("parses a well-formed CoinPaprika exchange", () => {
    const out = parseCoinPaprikaExchange(sample);
    expect(out).toEqual({
      id: "richamster",
      name: "Richamster",
      type: ["cex"],
      description: "Short description.",
      active: true,
      markets_data_fetched: true,
      adjusted_rank: 217,
      currencies: 24,
      fiats: [{ name: "Ukrainian Hryvnia", symbol: "UAH" }],
      volume24hUsd: 77211.14,
      links: { twitter: ["https://twitter.com/Richamster_com"], website: ["https://richamster.com"] },
    });
  });

  it("returns null on malformed payload (missing id)", () => {
    expect(parseCoinPaprikaExchange({ name: "X" })).toBeNull();
  });

  it("defaults missing volume to 0", () => {
    const v = parseCoinPaprikaExchange({ ...sample, quotes: {} });
    expect(v?.volume24hUsd).toBe(0);
  });
});

describe("cpTypeToExchangeType", () => {
  it("maps cex to CEX", () => {
    expect(cpTypeToExchangeType(["cex"])).toBe("CEX");
  });
  it("maps dex to DEX", () => {
    expect(cpTypeToExchangeType(["dex"])).toBe("DEX");
  });
  it("maps both cex and dex to HYBRID", () => {
    expect(cpTypeToExchangeType(["cex", "dex"])).toBe("HYBRID");
  });
  it("maps spot to CEX", () => {
    expect(cpTypeToExchangeType(["spot"])).toBe("CEX");
  });
  it("maps perpetuals to CEX", () => {
    expect(cpTypeToExchangeType(["perpetuals"])).toBe("CEX");
  });
  it("maps other to OTHER", () => {
    expect(cpTypeToExchangeType(["other"])).toBe("OTHER");
  });
  it("returns null for empty array", () => {
    expect(cpTypeToExchangeType([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/coinpaprika.test.ts`
Expected: FAIL — `Cannot find module '@/lib/coinpaprika'`.

- [ ] **Step 3: Create `src/lib/coinpaprika.ts` with the schema + parsers**

```ts
import { z } from "zod";

/**
 * Normalized shape we use internally after parsing CoinPaprika's response.
 */
export type CoinPaprikaExchange = {
  id: string;
  name: string;
  type: string[];
  description: string | null;
  active: boolean;
  markets_data_fetched: boolean;
  adjusted_rank: number | null;
  currencies: number | null;
  fiats: { name: string; symbol: string }[];
  volume24hUsd: number;
  links: {
    twitter?: string[];
    telegram?: string[];
    facebook?: string[];
    github?: string[];
    reddit?: string[];
    youtube?: string[];
    website?: string[];
  };
};

const linksSchema = z.object({
  twitter: z.array(z.string()).optional(),
  telegram: z.array(z.string()).optional(),
  facebook: z.array(z.string()).optional(),
  github: z.array(z.string()).optional(),
  reddit: z.array(z.string()).optional(),
  youtube: z.array(z.string()).optional(),
  website: z.array(z.string()).optional(),
}).optional().default({});

const coinPaprikaExchangeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.array(z.string()).default([]),
  description: z.string().nullable().optional(),
  active: z.boolean().optional().default(false),
  markets_data_fetched: z.boolean().optional().default(false),
  adjusted_rank: z.number().nullable().optional(),
  currencies: z.number().nullable().optional(),
  fiats: z.array(z.object({ name: z.string(), symbol: z.string() })).optional().default([]),
  quotes: z.object({
    USD: z.object({ adjusted_volume_24h: z.number().nullable().optional() }).optional(),
  }).optional().default({}),
  links: linksSchema,
});

export function parseCoinPaprikaExchange(raw: unknown): CoinPaprikaExchange | null {
  const r = coinPaprikaExchangeSchema.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    description: d.description?.trim() || null,
    active: d.active,
    markets_data_fetched: d.markets_data_fetched,
    adjusted_rank: d.adjusted_rank ?? null,
    currencies: d.currencies ?? null,
    fiats: d.fiats,
    volume24hUsd: d.quotes?.USD?.adjusted_volume_24h ?? 0,
    links: d.links,
  };
}

export function cpTypeToExchangeType(type: string[]): "CEX" | "DEX" | "HYBRID" | "OTHER" | null {
  if (type.length === 0) return null;
  const hasCex = type.some((t) => t === "cex" || t === "spot" || t === "perpetuals");
  const hasDex = type.includes("dex");
  if (hasCex && hasDex) return "HYBRID";
  if (hasCex) return "CEX";
  if (hasDex) return "DEX";
  return "OTHER";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/coinpaprika.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coinpaprika.ts tests/coinpaprika.test.ts
git commit -m "feat(coinpaprika): zod schema + parser for exchange list rows"
```

---

## Task 4: CoinPaprika HTTP fetchers + alias map

**Files:**
- Modify: `src/lib/coinpaprika.ts` (append fetchers + alias map)
- Modify: `tests/coinpaprika.test.ts` (alias map test)

- [ ] **Step 1: Write failing test for the alias resolver**

Append to `tests/coinpaprika.test.ts`:

```ts
import { resolveCpId, CP_TO_CG_ALIAS } from "@/lib/coinpaprika";

describe("resolveCpId", () => {
  it("returns the alias target when present", () => {
    expect(resolveCpId("coinbase")).toBe("gdax");
  });
  it("returns the input id when no alias is set", () => {
    expect(resolveCpId("xeggex")).toBe("xeggex");
  });
  it("CP_TO_CG_ALIAS contains the coinbase→gdax mapping", () => {
    expect(CP_TO_CG_ALIAS.coinbase).toBe("gdax");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/coinpaprika.test.ts`
Expected: FAIL — exported names not found.

- [ ] **Step 3: Append fetchers + alias map to `src/lib/coinpaprika.ts`**

Add these exports to the bottom of the file:

```ts
/**
 * Known cases where CoinGecko and CoinPaprika use different slugs for the same exchange.
 * Add new entries here as overlap is discovered (CG list is the canonical id space).
 */
export const CP_TO_CG_ALIAS: Record<string, string> = {
  coinbase: "gdax",
};

export function resolveCpId(cpId: string): string {
  return CP_TO_CG_ALIAS[cpId] ?? cpId;
}

const CP_BASE = "https://api.coinpaprika.com/v1";

export async function fetchCoinPaprikaExchanges(): Promise<CoinPaprikaExchange[]> {
  const res = await fetch(`${CP_BASE}/exchanges`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`CoinPaprika /exchanges failed: ${res.status}`);
  const json = (await res.json()) as unknown[];
  if (!Array.isArray(json)) throw new Error("CoinPaprika /exchanges: expected array");
  const out: CoinPaprikaExchange[] = [];
  for (const row of json) {
    const parsed = parseCoinPaprikaExchange(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

export type CoinPaprikaExchangeDetail = CoinPaprikaExchange & { pairsCount: number };

/**
 * Detail call — only used for exchanges that survive the volume filter,
 * so we can derive pairsCount from markets[].length.
 */
export async function fetchCoinPaprikaExchangeDetail(id: string): Promise<CoinPaprikaExchangeDetail | null> {
  const res = await fetch(`${CP_BASE}/exchanges/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { markets?: unknown[] } & Record<string, unknown>;
  const base = parseCoinPaprikaExchange(json);
  if (!base) return null;
  const pairsCount = Array.isArray(json.markets) ? json.markets.length : 0;
  return { ...base, pairsCount };
}
```

- [ ] **Step 4: Run test to verify alias tests pass**

Run: `npx vitest run tests/coinpaprika.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Smoke-check the live fetcher (no mocks — hits real API once)**

Run:
```bash
node -e "(async () => { const { fetchCoinPaprikaExchanges } = await import('./src/lib/coinpaprika.ts'); const list = await fetchCoinPaprikaExchanges(); console.log('count:', list.length); console.log('richamster?', list.find(e => e.id === 'richamster')); })()" 2>&1 | head -10
```
This will fail because Node can't import `.ts` directly; instead run via tsx:
```bash
npx tsx -e "import('./src/lib/coinpaprika.ts').then(async m => { const list = await m.fetchCoinPaprikaExchanges(); console.log('count:', list.length); console.log('richamster?', JSON.stringify(list.find(e => e.id === 'richamster'))); })"
```
Expected: `count: ~1100` and a Richamster object printed. (If CoinPaprika is rate-limiting, this might fail — re-run in a minute.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/coinpaprika.ts tests/coinpaprika.test.ts
git commit -m "feat(coinpaprika): list + detail HTTP fetchers and CP→CG alias map"
```

---

## Task 5: `syncCoinPaprikaExchanges` in orchestrator (TDD)

**Files:**
- Modify: `src/lib/sync/orchestrator.ts` (append new function)
- Modify: `tests/sync-orchestrator.test.ts` (append new describe block)

- [ ] **Step 1: Write failing tests in `tests/sync-orchestrator.test.ts`**

At the bottom of the existing file, before any closing brackets, append:

```ts
import { syncCoinPaprikaExchanges } from "@/lib/sync/orchestrator";
import type { CoinPaprikaExchange, CoinPaprikaExchangeDetail } from "@/lib/coinpaprika";

describe("syncCoinPaprikaExchanges", () => {
  const cpRichamster: CoinPaprikaExchange = {
    id: "richamster",
    name: "Richamster",
    type: ["cex"],
    description: "A team of crypto enthusiasts.",
    active: true,
    markets_data_fetched: true,
    adjusted_rank: 217,
    currencies: 24,
    fiats: [{ name: "Ukrainian Hryvnia", symbol: "UAH" }],
    volume24hUsd: 200_000,
    links: { twitter: ["https://twitter.com/Richamster_com"], website: ["https://richamster.com"] },
  };

  const cpNew: CoinPaprikaExchange = {
    id: "xeggex",
    name: "XeggeX",
    type: ["cex"],
    description: null,
    active: true,
    markets_data_fetched: true,
    adjusted_rank: 3,
    currencies: 50,
    fiats: [],
    volume24hUsd: 5_000_000,
    links: { website: ["https://xeggex.com"] },
  };

  it("creates a new row for CP-only exchange and enriches existing one only on nulls", async () => {
    // Existing DB rows: richamster has nulls for new fields; binance is a CG row, fully populated.
    const existing: Record<string, any> = {
      richamster: {
        id: "richamster", name: "Richamster.com", description: null, exchangeType: null,
        currencies: null, pairsCount: null, fiats: [], socials: null, source: "curated",
      },
    };
    const updates: any[] = [];
    const creates: any[] = [];
    const fakePrisma = {
      exchange: {
        findUnique: vi.fn(async ({ where }: any) => existing[where.id] ?? null),
        update: vi.fn(async ({ where, data }: any) => { updates.push({ id: where.id, data }); return {}; }),
        create: vi.fn(async ({ data }: any) => { creates.push(data); return {}; }),
      },
    };
    const result = await syncCoinPaprikaExchanges({
      fetchAll: async () => [cpRichamster, cpNew],
      fetchDetail: async (id) => ({ ...(id === "xeggex" ? cpNew : cpRichamster), pairsCount: 120 }),
      prisma: fakePrisma as never,
      minVolumeUsd: 100_000,
      btcUsd: 50_000,
    });

    expect(result.enriched).toBe(1);
    expect(result.created).toBe(1);

    // Richamster: only nulls were filled. description, exchangeType, currencies, pairsCount, fiats, socials.
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("richamster");
    expect(updates[0].data.description).toBe("A team of crypto enthusiasts.");
    expect(updates[0].data.exchangeType).toBe("CEX");
    expect(updates[0].data.currencies).toBe(24);
    expect(updates[0].data.pairsCount).toBe(120);
    expect(updates[0].data.fiats).toEqual(["UAH"]);
    expect(updates[0].data.socials).toEqual({ twitter: "https://twitter.com/Richamster_com", website: "https://richamster.com" });
    // Source on a curated row must NOT be overwritten.
    expect(updates[0].data.source).toBeUndefined();
    // Authoritative CG-like fields are not in the update payload.
    expect(updates[0].data.name).toBeUndefined();
    expect(updates[0].data.url).toBeUndefined();

    // New row for xeggex.
    expect(creates).toHaveLength(1);
    expect(creates[0].id).toBe("xeggex");
    expect(creates[0].source).toBe("cp");
    expect(creates[0].name).toBe("XeggeX");
    expect(creates[0].url).toBe("https://xeggex.com");
    expect(creates[0].volume24hUsd).toBe(5_000_000);
    expect(creates[0].volume24hBtc).toBe(100); // 5_000_000 / 50_000
    expect(creates[0].pairsCount).toBe(120);
    expect(creates[0].logoUrl).toBe("https://static.coinpaprika.com/exchange/xeggex/logo.png");
  });

  it("skips rows under the volume threshold", async () => {
    const fakePrisma = {
      exchange: {
        findUnique: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
    };
    const result = await syncCoinPaprikaExchanges({
      fetchAll: async () => [{ ...cpNew, volume24hUsd: 5_000 }],
      fetchDetail: async () => null,
      prisma: fakePrisma as never,
      minVolumeUsd: 100_000,
      btcUsd: 50_000,
    });
    expect(result).toEqual({ created: 0, enriched: 0, skipped: 1 });
    expect(fakePrisma.exchange.findUnique).not.toHaveBeenCalled();
  });

  it("honors CP_TO_CG_ALIAS for known divergent ids", async () => {
    const existing: Record<string, any> = {
      gdax: { id: "gdax", name: "Coinbase Exchange", description: null, exchangeType: null, currencies: null, pairsCount: null, fiats: [], socials: null, source: "cg" },
    };
    const updates: any[] = [];
    const fakePrisma = {
      exchange: {
        findUnique: vi.fn(async ({ where }: any) => existing[where.id] ?? null),
        update: vi.fn(async ({ where, data }: any) => { updates.push({ id: where.id, data }); return {}; }),
        create: vi.fn(),
      },
    };
    await syncCoinPaprikaExchanges({
      fetchAll: async () => [{ ...cpNew, id: "coinbase", name: "Coinbase" }],
      fetchDetail: async () => ({ ...cpNew, id: "coinbase", name: "Coinbase", pairsCount: 200 }),
      prisma: fakePrisma as never,
      minVolumeUsd: 100_000,
      btcUsd: 50_000,
    });
    // Should have updated gdax, not created coinbase.
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("gdax");
    expect(fakePrisma.exchange.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sync-orchestrator.test.ts`
Expected: FAIL — `syncCoinPaprikaExchanges` not exported.

- [ ] **Step 3: Append `syncCoinPaprikaExchanges` to `src/lib/sync/orchestrator.ts`**

Add this **at the bottom** of `orchestrator.ts`, importing what's needed:

```ts
import { cpTypeToExchangeType, resolveCpId, type CoinPaprikaExchange, type CoinPaprikaExchangeDetail } from "@/lib/coinpaprika";

type CpExchangeUpdate = {
  description?: string | null;
  exchangeType?: string | null;
  currencies?: number | null;
  pairsCount?: number | null;
  fiats?: string[];
  socials?: Record<string, string> | null;
};

type CpExchangeCreate = CpExchangeUpdate & {
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
  source: "cp";
};

function pickFirst(arr: string[] | undefined): string | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const v = arr[0];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function socialsFromLinks(links: CoinPaprikaExchange["links"]): Record<string, string> | null {
  const out: Record<string, string> = {};
  const tw = pickFirst(links.twitter); if (tw) out.twitter = tw;
  const tg = pickFirst(links.telegram); if (tg) out.telegram = tg;
  const fb = pickFirst(links.facebook); if (fb) out.facebook = fb;
  const gh = pickFirst(links.github); if (gh) out.github = gh;
  const rd = pickFirst(links.reddit); if (rd) out.reddit = rd;
  const yt = pickFirst(links.youtube); if (yt) out.youtube = yt;
  const ws = pickFirst(links.website); if (ws) out.website = ws;
  return Object.keys(out).length > 0 ? out : null;
}

export async function syncCoinPaprikaExchanges(deps: {
  fetchAll: () => Promise<CoinPaprikaExchange[]>;
  fetchDetail: (id: string) => Promise<CoinPaprikaExchangeDetail | null>;
  prisma: {
    exchange: {
      findUnique(args: { where: { id: string } }): Promise<{ id: string; description: string | null; exchangeType: string | null; currencies: number | null; pairsCount: number | null; fiats: string[]; socials: unknown; source: string } | null>;
      update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
  };
  minVolumeUsd: number;
  btcUsd: number;
}): Promise<{ created: number; enriched: number; skipped: number }> {
  const all = await deps.fetchAll();
  let created = 0, enriched = 0, skipped = 0;

  for (const cp of all) {
    if (!cp.active || !cp.markets_data_fetched || cp.volume24hUsd <= deps.minVolumeUsd) {
      skipped++;
      continue;
    }
    const targetId = resolveCpId(cp.id);
    const existing = await deps.prisma.exchange.findUnique({ where: { id: targetId } });
    const detail = await deps.fetchDetail(cp.id);
    const pairsCount = detail?.pairsCount ?? null;
    const fiats = cp.fiats.map((f) => f.symbol).filter((s): s is string => typeof s === "string" && s.length > 0);
    const socials = socialsFromLinks(cp.links);
    const exchangeType = cpTypeToExchangeType(cp.type);

    if (existing) {
      const data: Record<string, unknown> = {};
      if (existing.description === null && cp.description) data.description = cp.description;
      if (existing.exchangeType === null && exchangeType) data.exchangeType = exchangeType;
      if (existing.currencies === null && cp.currencies !== null) data.currencies = cp.currencies;
      if (existing.pairsCount === null && pairsCount !== null) data.pairsCount = pairsCount;
      if ((!existing.fiats || existing.fiats.length === 0) && fiats.length > 0) data.fiats = fiats;
      if (!existing.socials && socials) data.socials = socials;
      if (Object.keys(data).length > 0) {
        await deps.prisma.exchange.update({ where: { id: targetId }, data });
        enriched++;
      } else {
        skipped++;
      }
    } else {
      const websiteUrl = pickFirst(cp.links.website) ?? null;
      const create: Record<string, unknown> = {
        id: cp.id,
        name: cp.name,
        logoUrl: `https://static.coinpaprika.com/exchange/${cp.id}/logo.png`,
        country: null,
        yearEstablished: null,
        trustScore: null,
        trustScoreRank: cp.adjusted_rank ?? null,
        volume24hUsd: cp.volume24hUsd,
        volume24hBtc: deps.btcUsd > 0 ? cp.volume24hUsd / deps.btcUsd : 0,
        url: websiteUrl,
        hasTradingIncentive: false,
        description: cp.description,
        exchangeType,
        currencies: cp.currencies,
        pairsCount,
        fiats,
        socials,
        source: "cp",
      };
      await deps.prisma.exchange.create({ data: create });
      created++;
    }
  }

  return { created, enriched, skipped };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sync-orchestrator.test.ts`
Expected: all tests PASS (including the existing `syncExchanges` test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/orchestrator.ts tests/sync-orchestrator.test.ts
git commit -m "feat(sync): syncCoinPaprikaExchanges fills nulls on overlap, creates CP-only rows"
```

---

## Task 6: Wire the worker job

**Files:**
- Modify: `worker/index.ts`

- [ ] **Step 1: Add import + run function**

Open `worker/index.ts`. Near the top, alongside the existing `syncExchanges` import (around line 9), extend the import:

```ts
import { syncPrices, syncGlobal, syncExchangeRates, syncCoinMetadata, syncExchanges, syncAdminAddedPrices, syncNews, syncFearGreed, syncMarkets, syncCoinPaprikaExchanges } from "../src/lib/sync/orchestrator";
import { fetchCoinPaprikaExchanges, fetchCoinPaprikaExchangeDetail } from "../src/lib/coinpaprika";
```

After `runExchangesSync` (around line 103+), add:

```ts
async function runCoinPaprikaSync() {
  const t0 = Date.now();
  try {
    // Resolve current BTC/USD from a recent prices snapshot via Redis. Falls back to 0
    // (skip volume24hBtc computation) if no value is available — never throw.
    const btcCached = await (redis as never as { get: (k: string) => Promise<string | null> }).get("price:bitcoin:usd");
    const btcUsd = btcCached ? Number(btcCached) : 0;
    const result = await syncCoinPaprikaExchanges({
      fetchAll: fetchCoinPaprikaExchanges,
      fetchDetail: fetchCoinPaprikaExchangeDetail,
      prisma: prisma as never,
      minVolumeUsd: 100_000,
      btcUsd,
    });
    console.log(`[worker] coinpaprika-sync ok: +${result.created} new, ~${result.enriched} enriched, ${result.skipped} skipped in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[worker] coinpaprika-sync failed:`, err);
  }
}
```

- [ ] **Step 2: Check what Redis key actually holds BTC USD price**

Run: `grep -nE "bitcoin.*usd|btcUsd|price:bitcoin" src/lib/sync/orchestrator.ts src/lib/sync/keys.ts | head -10`
Look for the key name. If it's not `price:bitcoin:usd`, adjust the string in `runCoinPaprikaSync` accordingly. If no such key exists at all, replace the `redis.get` with a direct `prisma.coinSnapshot.findFirst({ where: { coinId: 'bitcoin' }, orderBy: { fetchedAt: 'desc' } })` and read `priceUsd`. The exact source doesn't matter — what matters is the runtime BTC/USD value.

- [ ] **Step 3: Schedule cron + initial run**

Find the cron block near the bottom of `worker/index.ts` (around `cron.schedule("5,35 * * * *", ...)` for exchanges). Add a new schedule right after:

```ts
  cron.schedule("25,55 * * * *", () => {
    void runCoinPaprikaSync();
  });
```

Also add `void runCoinPaprikaSync();` to the startup-time invocation block (where `await runExchangesSync();` is called near line 175).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add worker/index.ts
git commit -m "feat(worker): hourly CoinPaprika exchanges sync (offset cron at :25/:55)"
```

---

## Task 7: i18n keys

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/ru.json`
- Modify: `messages/{de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json`

- [ ] **Step 1: Add `exchangeCard` namespace to `messages/en.json`**

Find the top-level `"exchanges": { ... }` block and add a sibling `"exchangeCard"`:

```json
"exchangeCard": {
  "back": "← Back to exchanges",
  "parameters": {
    "title": "Parameters",
    "type": "Type",
    "country": "Country",
    "yearEstablished": "Founded",
    "kyc": "KYC required",
    "fiats": "Fiat currencies",
    "currencies": "Listed coins",
    "pairs": "Trading pairs"
  },
  "metrics": {
    "title": "Trading metrics",
    "volume24h": "24h volume",
    "trustScore": "Trust score"
  },
  "description": {
    "title": "About"
  },
  "socials": {
    "title": "Links"
  },
  "outbound": {
    "disclaimer": "You are about to leave our site. Please independently verify trading conditions, fees and risks on the exchange's own website.",
    "cta": "Visit {name}"
  },
  "notFound": {
    "title": "Exchange not found",
    "back": "Back to the exchanges list"
  },
  "noData": "—"
}
```

- [ ] **Step 2: Add the same namespace (with translated values) to `messages/ru.json`**

```json
"exchangeCard": {
  "back": "← Назад к биржам",
  "parameters": {
    "title": "Параметры",
    "type": "Тип",
    "country": "Страна",
    "yearEstablished": "Год основания",
    "kyc": "KYC обязателен",
    "fiats": "Фиатные валюты",
    "currencies": "Монет на бирже",
    "pairs": "Торговых пар"
  },
  "metrics": {
    "title": "Торговые метрики",
    "volume24h": "Объём 24ч",
    "trustScore": "Trust score"
  },
  "description": {
    "title": "О бирже"
  },
  "socials": {
    "title": "Ссылки"
  },
  "outbound": {
    "disclaimer": "Вы покидаете наш сайт. Самостоятельно проверьте условия, комиссии и риски на сайте биржи.",
    "cta": "Перейти на {name}"
  },
  "notFound": {
    "title": "Биржа не найдена",
    "back": "К списку бирж"
  },
  "noData": "—"
}
```

- [ ] **Step 3: Repeat for the other 8 locales**

For each of `de, es, fr, ja, ko, pt-BR, tr, zh-CN`: add a sibling `exchangeCard` namespace with the same structure. For now, **mirror the English values** — the existing translation workflow in this repo accepts English placeholders for new keys and translates them in a later batch. (Check `git log -- messages/` for the pattern used in prior slices.)

- [ ] **Step 4: Verify all 10 files parse as JSON**

Run: `for f in messages/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done`
Expected: all 10 print "ok".

- [ ] **Step 5: Commit**

```bash
git add messages/
git commit -m "i18n(exchangeCard): add namespace across all locales"
```

---

## Task 8: Exchange card components

Six small server components. Each takes a typed prop and renders one section, with a clear "nothing to render" branch.

**Files:**
- Create: `src/components/exchange-card/header.tsx`
- Create: `src/components/exchange-card/parameters.tsx`
- Create: `src/components/exchange-card/metrics.tsx`
- Create: `src/components/exchange-card/description.tsx`
- Create: `src/components/exchange-card/socials.tsx`
- Create: `src/components/exchange-card/outbound-cta.tsx`

- [ ] **Step 1: Create `header.tsx`**

```tsx
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { Exchange } from "@/lib/coingecko";

function trustBadgeCls(score: number | null): string {
  if (score === null) return "bg-card-alt text-muted";
  if (score >= 9) return "bg-up/15 text-up";
  if (score >= 7) return "bg-accent/15 text-accent";
  return "bg-down/15 text-down";
}

export async function ExchangeCardHeader({ exchange }: { exchange: Exchange }) {
  const t = await getTranslations("exchangeCard");
  return (
    <header className="flex items-start gap-5">
      {exchange.logoUrl && (
        <Image src={exchange.logoUrl} alt="" width={72} height={72} className="rounded-xl flex-shrink-0" unoptimized />
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-[28px] font-semibold leading-tight">{exchange.name}</h1>
        <div className="flex flex-wrap gap-2 mt-2 items-center">
          {exchange.exchangeType && (
            <span className="text-[10px] uppercase tracking-[0.18em] bg-card-alt px-2 py-1 rounded-sm">
              {exchange.exchangeType}
            </span>
          )}
          {exchange.country && (
            <span className="text-[13px] text-muted">{exchange.country}</span>
          )}
          {exchange.yearEstablished && (
            <span className="num text-[13px] text-muted">· {exchange.yearEstablished}</span>
          )}
          <span className={`num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium ${trustBadgeCls(exchange.trustScore)}`}>
            {exchange.trustScore ?? t("noData")}/10
          </span>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Create `parameters.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import type { Exchange } from "@/lib/coingecko";

export async function ExchangeCardParameters({ exchange }: { exchange: Exchange }) {
  const t = await getTranslations("exchangeCard");
  const rows: { label: string; value: string | null }[] = [
    { label: t("parameters.type"), value: exchange.exchangeType },
    { label: t("parameters.country"), value: exchange.country },
    { label: t("parameters.yearEstablished"), value: exchange.yearEstablished?.toString() ?? null },
    { label: t("parameters.kyc"), value: null },
    { label: t("parameters.fiats"), value: exchange.fiats.length > 0 ? exchange.fiats.join(", ") : null },
    { label: t("parameters.currencies"), value: exchange.currencies?.toString() ?? null },
    { label: t("parameters.pairs"), value: exchange.pairsCount?.toString() ?? null },
  ];
  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">{t("parameters.title")}</h2>
      <dl className="bg-card border border-hairline rounded-[16px] divide-y divide-hairline">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between px-4 py-3 text-[14px]">
            <dt className="text-muted">{r.label}</dt>
            <dd className="font-medium">{r.value ?? t("noData")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 3: Create `metrics.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import type { Exchange } from "@/lib/coingecko";

function fmtUsd(n: number): string {
  if (n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

export async function ExchangeCardMetrics({ exchange }: { exchange: Exchange }) {
  const t = await getTranslations("exchangeCard");
  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">{t("metrics.title")}</h2>
      <div className="bg-card border border-hairline rounded-[16px] p-5 grid grid-cols-2 gap-5">
        <div>
          <div className="text-muted text-[11px] uppercase tracking-[0.18em] mb-1">{t("metrics.volume24h")}</div>
          <div className="num text-[20px] font-semibold">{fmtUsd(exchange.volume24hUsd)}</div>
          {exchange.volume24hBtc > 0 && (
            <div className="num text-[12px] text-muted mt-1">{exchange.volume24hBtc.toFixed(2)} BTC</div>
          )}
        </div>
        <div>
          <div className="text-muted text-[11px] uppercase tracking-[0.18em] mb-1">{t("metrics.trustScore")}</div>
          <div className="num text-[20px] font-semibold">{exchange.trustScore ?? t("noData")}/10</div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `description.tsx`**

```tsx
import { getTranslations } from "next-intl/server";

export async function ExchangeCardDescription({ description }: { description: string | null }) {
  if (!description) return null;
  const t = await getTranslations("exchangeCard");
  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">{t("description.title")}</h2>
      <div className="bg-card border border-hairline rounded-[16px] p-5 text-[14px] leading-relaxed whitespace-pre-line">
        {description}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Create `socials.tsx`**

```tsx
import { getTranslations } from "next-intl/server";

const KEYS = ["website", "twitter", "telegram", "facebook", "github", "reddit", "youtube"] as const;

export async function ExchangeCardSocials({ socials }: { socials: Record<string, string> | null }) {
  if (!socials) return null;
  const present = KEYS.filter((k) => typeof socials[k] === "string" && socials[k]);
  if (present.length === 0) return null;
  const t = await getTranslations("exchangeCard");
  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">{t("socials.title")}</h2>
      <ul className="flex flex-wrap gap-2">
        {present.map((k) => (
          <li key={k}>
            <a
              href={socials[k]}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="inline-flex items-center gap-2 bg-card border border-hairline rounded-md px-3 py-2 text-[13px] hover:bg-bg-tint"
            >
              <span className="capitalize">{k}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: Create `outbound-cta.tsx`**

```tsx
import { getTranslations } from "next-intl/server";

export async function ExchangeOutboundCta({ name, url }: { name: string; url: string | null }) {
  if (!url) return null;
  const t = await getTranslations("exchangeCard");
  return (
    <section className="bg-card border border-hairline rounded-[16px] p-5">
      <p className="text-[13px] text-muted mb-3">{t("outbound.disclaimer")}</p>
      <a
        href={url}
        target="_blank"
        rel="nofollow sponsored noopener noreferrer"
        className="inline-flex items-center justify-center w-full bg-foreground text-bg font-semibold rounded-md px-4 py-3 text-[14px] hover:opacity-90"
      >
        {t("outbound.cta", { name })}
      </a>
    </section>
  );
}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/exchange-card/
git commit -m "feat(exchange-card): header/params/metrics/description/socials/outbound components"
```

---

## Task 9: Detail page route

**Files:**
- Create: `src/app/[locale]/exchanges/[id]/page.tsx`
- Create: `src/app/[locale]/exchanges/[id]/not-found.tsx`

- [ ] **Step 1: Create `not-found.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function NotFound({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "exchangeCard.notFound" });
  return (
    <main className="max-w-2xl mx-auto px-5 py-16 text-center">
      <h1 className="text-[24px] font-semibold mb-4">{t("title")}</h1>
      <Link href={`/${locale}/exchanges`} className="text-accent hover:underline">{t("back")}</Link>
    </main>
  );
}
```

- [ ] **Step 2: Create `page.tsx`**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { ExchangeCardHeader } from "@/components/exchange-card/header";
import { ExchangeCardParameters } from "@/components/exchange-card/parameters";
import { ExchangeCardMetrics } from "@/components/exchange-card/metrics";
import { ExchangeCardDescription } from "@/components/exchange-card/description";
import { ExchangeCardSocials } from "@/components/exchange-card/socials";
import { ExchangeOutboundCta } from "@/components/exchange-card/outbound-cta";
import type { Exchange } from "@/lib/coingecko";

export default async function ExchangeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const row = await prisma.exchange.findUnique({ where: { id } });
  if (!row) notFound();

  const t = await getTranslations("exchangeCard");

  // Map DB row to the Exchange TS type (socials JSON → typed object).
  const exchange: Exchange = {
    id: row.id,
    name: row.name,
    logoUrl: row.logoUrl,
    country: row.country,
    yearEstablished: row.yearEstablished,
    trustScore: row.trustScore,
    trustScoreRank: row.trustScoreRank,
    volume24hBtc: row.volume24hBtc,
    volume24hUsd: row.volume24hUsd,
    url: row.url,
    hasTradingIncentive: row.hasTradingIncentive,
    description: row.description,
    exchangeType: (row.exchangeType as Exchange["exchangeType"]) ?? null,
    currencies: row.currencies,
    pairsCount: row.pairsCount,
    fiats: row.fiats,
    socials: (row.socials as Exchange["socials"]) ?? null,
    source: (row.source as Exchange["source"]) ?? "cg",
  };

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 space-y-6">
      <Link href={`/${locale}/exchanges`} className="text-accent text-[13px] hover:underline inline-block">
        {t("back")}
      </Link>
      <ExchangeCardHeader exchange={exchange} />
      <ExchangeCardMetrics exchange={exchange} />
      <ExchangeCardParameters exchange={exchange} />
      <ExchangeCardDescription description={exchange.description} />
      <ExchangeCardSocials socials={exchange.socials} />
      <ExchangeOutboundCta name={exchange.name} url={exchange.url} />
    </main>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/exchanges/[id]
git commit -m "feat(exchanges): public /exchanges/[id] detail card"
```

---

## Task 10: Rewire list rows to internal links

**Files:**
- Modify: `src/components/exchanges-table.tsx`

- [ ] **Step 1: Add Link import**

Add at the top of `exchanges-table.tsx`:

```ts
import Link from "next/link";
```

- [ ] **Step 2: Replace the desktop row name cell**

Find the block at lines 79–91 (the `{e.url ? <a ...> : <span ...>}` for desktop). Replace it with:

```tsx
                    <Link
                      href={`/${locale}/exchanges/${e.id}`}
                      className="font-medium text-[15px] hover:underline"
                    >
                      {e.name}
                    </Link>
```

(No more external `<a>`. `e.url` lives on the detail page now.)

- [ ] **Step 3: Replace the mobile row name cell**

Find lines 124–135 (mobile version of the same construct). Replace with:

```tsx
                <Link
                  href={`/${locale}/exchanges/${e.id}`}
                  className="font-medium hover:underline block truncate"
                >
                  {e.name}
                </Link>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/exchanges-table.tsx
git commit -m "feat(exchanges): list rows link to internal card, not external site"
```

---

## Task 11: Build, deploy, manual smoke

**Files:** none (deployment).

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests PASS. Pay attention to any that touch `Exchange` shape.

- [ ] **Step 2: Build**

Run: `npm run build 2>&1 | tail -25`
Expected: build completes, no type errors, all locales generate.

- [ ] **Step 3: Restart web + worker**

Run: `pm2 restart trientes-web trientes-worker && pm2 save`
Expected: both come up `online`. The worker will trigger `runCoinPaprikaSync` at startup (per the boot block in Task 6 Step 3), then again at `:25` / `:55`.

- [ ] **Step 4: Trigger an explicit CP sync to populate data immediately**

Run:
```bash
npx tsx -e "
import('./worker/index.ts');
" &
sleep 5
# OR call the orchestrator function directly:
npx tsx -e "
import('./src/lib/sync/orchestrator.ts').then(async ({ syncCoinPaprikaExchanges }) => {
  const { fetchCoinPaprikaExchanges, fetchCoinPaprikaExchangeDetail } = await import('./src/lib/coinpaprika.ts');
  const { prisma } = await import('./src/lib/prisma.ts');
  const r = await syncCoinPaprikaExchanges({
    fetchAll: fetchCoinPaprikaExchanges,
    fetchDetail: fetchCoinPaprikaExchangeDetail,
    prisma,
    minVolumeUsd: 100_000,
    btcUsd: 50_000,
  });
  console.log(r);
  await prisma.\$disconnect();
});
"
```
Expected: a JSON-like result `{ created: 80–95, enriched: 5–20, skipped: 900+ }`. Tail `pm2 logs trientes-worker --lines 50` to see the periodic runs.

- [ ] **Step 5: Bust the Redis exchanges cache so the list reflects new fields immediately**

Run: `redis-cli DEL snapshot:exchanges:top100`
Expected: `(integer) 1` (or 0 if already absent).

- [ ] **Step 6: Manual smoke in browser**

Open:
- `https://trientes.org/en/exchanges` — list should still load; clicking any row should navigate to `/en/exchanges/{id}`, not jump to an external site.
- `https://trientes.org/en/exchanges/richamster` — header (logo + name "Richamster.com" + CEX badge), description from CP, parameters showing UAH + 24 currencies, socials with Twitter + Website, "Visit Richamster.com" CTA.
- `https://trientes.org/en/exchanges/xeggex` — new CP-only row, should render.
- `https://trientes.org/en/exchanges/binance` — existing CG row; CG fields intact, CP enrichment visible (description maybe, currencies/pairs filled).
- `https://trientes.org/en/exchanges/does-not-exist` — localized 404 page.

- [ ] **Step 7: Push**

```bash
git push origin main
```

- [ ] **Step 8: Final smoke and report**

Run: `curl -s 'https://trientes.org/api/health' | head` — confirm `{"ok":true,...}`.

Tail worker logs briefly: `pm2 logs trientes-worker --lines 30 --nostream` — confirm no `[worker] coinpaprika-sync failed:` errors.

Generate a Russian audio summary of what shipped, attach via `📎 attach: …`, and stop.
