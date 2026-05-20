# Trientes Phase 3: Sparkline + Search/Sort + Currency Switcher

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three improvements to the public listing:
1. **Sparkline** — small 7-day price chart per row (SVG, computed from CoinGecko's `sparkline=true` data)
2. **Search + column sort** — client-side filter by symbol/name, click headers to sort by rank/price/24h%/mcap/volume
3. **Currency switcher** — 8 currencies (USD/EUR/RUB/GBP/JPY/CNY/BTC/ETH) wired to user's `preferredCurrency` (logged in) or a cookie (guest). Conversion via CoinGecko `/exchange_rates`, refreshed every 5 min.

**Reference spec:** `docs/superpowers/specs/2026-05-19-trientes-cmc-clone-design.md`.
**Phase 2 plan (for context):** `docs/superpowers/plans/2026-05-20-trientes-phase2-sync-and-listing.md`.
**Working dir:** `/Users/dmitry/Coinmarketcap`. Server: `dv@85.192.25.242`.

**Out of scope (defer to later phases):**
- SSE live updates / Binance WS (Phase 4 candidate)
- Coin detail page (Phase 4)
- Pagination UI (we only have 99 coins — search + sort is enough)
- Per-coin currency-converted snapshots in DB (we always store USD and convert at render time)

**Conversion math:** CoinGecko `/exchange_rates` returns rates as "1 BTC = value units of currency".
```
priceInCurrency = priceUsd * (rates[currency].value / rates.usd.value)
```
This holds for all currencies including BTC (where rates.btc.value = 1) and ETH.

---

## File structure produced by this plan

```
/Users/dmitry/Coinmarketcap/
├── prisma/migrations/<ts>_sparkline/        # +sparkline7d Json? on CoinSnapshot
├── src/
│   ├── lib/
│   │   ├── coingecko.ts                     # +sparkline_in_7d parsing, +fetchExchangeRates, +ExchangeRates type
│   │   ├── currency.ts                      # convert, formatPriceInCurrency, formatCompactInCurrency, CURRENCIES const
│   │   ├── sync/orchestrator.ts             # +syncExchangeRates, sparkline propagation
│   │   ├── sync/keys.ts                     # +rates key
│   │   ├── snapshot.ts                      # +readExchangeRates, sparkline through
│   │   └── get-currency.ts                  # server: resolve currency from session/cookie
│   ├── components/
│   │   ├── currency-switcher.tsx            # dropdown in navbar (client)
│   │   ├── sparkline.tsx                    # SVG path (server-renderable)
│   │   ├── coin-list-client.tsx             # client: search + sort wrapper around CoinTable
│   │   ├── coin-row.tsx                     # update: sparkline column + currency-aware formatting
│   │   ├── coin-table.tsx                   # update: column headers carry sort state
│   │   └── navbar.tsx                       # +<CurrencySwitcher />
│   ├── app/
│   │   ├── actions/settings.ts              # already validates currency; reused
│   │   ├── actions/currency.ts              # NEW: setCurrency server action (cookie + optional DB)
│   │   └── [locale]/page.tsx                # update: resolve currency, fetch rates, pass to CoinListClient
└── tests/
    ├── coingecko-rates.test.ts              # parseExchangeRates
    └── currency.test.ts                     # conversion + formatting
```

---

## Task 1: Add `sparkline7d` to `CoinSnapshot` schema

**Files:** `prisma/schema.prisma` (modify), new migration.

- [ ] **Step 1:** Add field to `CoinSnapshot` model. After `maxSupply` line, add:
```prisma
  sparkline7d       Json?
```

- [ ] **Step 2:** Generate migration:
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" npx prisma migrate dev --name sparkline
```

- [ ] **Step 3:** Commit:
```bash
git add -A
git commit -m "feat(db): add sparkline7d to CoinSnapshot"
```

---

## Task 2: CoinGecko — sparkline propagation + exchange rates fetcher (TDD)

**Files:** `src/lib/coingecko.ts` (modify), `tests/coingecko-rates.test.ts` (new).

- [ ] **Step 1: Extend `MarketRow` and `parseMarketRow`**

In `src/lib/coingecko.ts`, add `sparkline7d: number[] | null` to the `MarketRow` type and update `parseMarketRow` to extract it:

```ts
// Add to MarketRow type:
//   sparkline7d: number[] | null;

// Inside parseMarketRow, before the return:
const spark = (r.sparkline_in_7d as { price?: unknown } | null)?.price;
const sparkline7d = Array.isArray(spark) && spark.every((n) => typeof n === "number")
  ? (spark as number[])
  : null;

// And include in the returned object: sparkline7d
```

- [ ] **Step 2: Update an existing test in `tests/coingecko-parse.test.ts`**

Add a new `it` case (don't break existing ones):
```ts
it("extracts sparkline_in_7d.price as an array", () => {
  const withSpark = { ...sample, sparkline_in_7d: { price: [1, 2, 3, 4] } };
  expect(parseMarketRow(withSpark).sparkline7d).toEqual([1, 2, 3, 4]);
});

it("returns null sparkline when missing or malformed", () => {
  expect(parseMarketRow(sample).sparkline7d).toBeNull();
  const bad = { ...sample, sparkline_in_7d: { price: ["x", 1] } };
  expect(parseMarketRow(bad).sparkline7d).toBeNull();
});
```

Also extend the "maps a full row" expected output to include `sparkline7d: null`.

- [ ] **Step 3: Update `fetchTop100L1`** — change the `sparkline` query param from `"false"` to `"true"`:
```ts
sparkline: "true",
```

- [ ] **Step 4: Add `fetchExchangeRates`**

Append to `src/lib/coingecko.ts`:
```ts
export type ExchangeRate = { name: string; unit: string; value: number; type: "crypto" | "fiat" };
export type ExchangeRates = Record<string, ExchangeRate>;

export function parseExchangeRates(raw: unknown): ExchangeRates {
  const root = raw as { rates?: Record<string, unknown> };
  const rates = req(root.rates, "rates");
  const out: ExchangeRates = {};
  for (const [code, v] of Object.entries(rates)) {
    const r = v as Record<string, unknown>;
    if (typeof r.value !== "number") continue;
    out[code] = {
      name: String(r.name ?? code),
      unit: String(r.unit ?? code.toUpperCase()),
      value: r.value,
      type: r.type === "fiat" ? "fiat" : "crypto",
    };
  }
  return out;
}

export async function fetchExchangeRates(): Promise<ExchangeRates> {
  const raw = await cgFetch("/exchange_rates", {});
  return parseExchangeRates(raw);
}
```

- [ ] **Step 5: Write tests** — create `tests/coingecko-rates.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseExchangeRates } from "@/lib/coingecko";

describe("parseExchangeRates", () => {
  const sample = {
    rates: {
      btc: { name: "Bitcoin", unit: "BTC", value: 1, type: "crypto" },
      usd: { name: "US Dollar", unit: "$", value: 76528.56, type: "fiat" },
      eur: { name: "Euro", unit: "€", value: 65998.61, type: "fiat" },
      eth: { name: "Ether", unit: "ETH", value: 36.34, type: "crypto" },
      garbage: { value: "not a number" },
      missing_value: { name: "X" },
    },
  };

  it("extracts known currencies", () => {
    const out = parseExchangeRates(sample);
    expect(out.usd.value).toBe(76528.56);
    expect(out.btc.value).toBe(1);
    expect(out.eth.type).toBe("crypto");
    expect(out.usd.unit).toBe("$");
  });

  it("skips entries without a numeric value", () => {
    const out = parseExchangeRates(sample);
    expect(out.garbage).toBeUndefined();
    expect(out.missing_value).toBeUndefined();
  });

  it("throws on missing rates root", () => {
    expect(() => parseExchangeRates({})).toThrow();
  });
});
```

- [ ] **Step 6: Run tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: all green (previous 37 + 3 new rates tests + 2 new sparkline tests).

- [ ] **Step 7: Commit**
```bash
git add -A
git commit -m "feat(coingecko): sparkline_in_7d + exchange rates with tests"
```

---

## Task 3: Currency conversion utility (TDD)

**Files:** `src/lib/currency.ts` (new), `tests/currency.test.ts` (new).

- [ ] **Step 1: Write tests** — `tests/currency.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  convert,
  formatPriceInCurrency,
  formatCompactInCurrency,
  CURRENCIES,
  type Currency,
} from "@/lib/currency";
import type { ExchangeRates } from "@/lib/coingecko";

const rates: ExchangeRates = {
  btc: { name: "Bitcoin", unit: "BTC", value: 1, type: "crypto" },
  eth: { name: "Ether", unit: "ETH", value: 36, type: "crypto" },
  usd: { name: "US Dollar", unit: "$", value: 75000, type: "fiat" },
  eur: { name: "Euro", unit: "€", value: 70000, type: "fiat" },
  rub: { name: "Russian Ruble", unit: "₽", value: 5_400_000, type: "fiat" },
};

describe("convert", () => {
  it("returns USD price as-is", () => {
    expect(convert(100, "USD", rates)).toBe(100);
  });
  it("converts to EUR via rates ratio", () => {
    // 100 USD = (100 / 75000) BTC = 0.001333 BTC; in EUR = 0.001333 * 70000 = 93.33
    expect(convert(100, "EUR", rates)).toBeCloseTo(93.333, 2);
  });
  it("converts to BTC", () => {
    // 1 BTC value=1 in rates; 75000 USD = 1 BTC
    expect(convert(75000, "BTC", rates)).toBeCloseTo(1, 5);
  });
  it("converts to ETH", () => {
    // 75000 USD = 1 BTC = 36 ETH
    expect(convert(75000, "ETH", rates)).toBeCloseTo(36, 5);
  });
  it("returns NaN when target rate missing", () => {
    expect(Number.isNaN(convert(100, "JPY" as Currency, rates))).toBe(true);
  });
});

describe("formatPriceInCurrency", () => {
  it("formats USD with $ prefix and 2 decimals", () => {
    expect(formatPriceInCurrency(1234.56, "USD", rates)).toBe("$1,234.56");
  });
  it("formats EUR with €", () => {
    // 1234.56 USD → ~1152.59 EUR with the test rates
    const out = formatPriceInCurrency(1234.56, "EUR", rates);
    expect(out.startsWith("€")).toBe(true);
  });
  it("formats RUB with ₽ suffix (Cyrillic convention) or prefix — accept prefix for now", () => {
    expect(formatPriceInCurrency(1, "RUB", rates).includes("₽")).toBe(true);
  });
  it("formats BTC with 6 decimals and ₿ prefix", () => {
    // 75000 USD = 1 BTC
    expect(formatPriceInCurrency(75000, "BTC", rates)).toBe("₿1.000000");
  });
  it("formats ETH with 4 decimals and Ξ prefix", () => {
    expect(formatPriceInCurrency(75000, "ETH", rates)).toBe("Ξ36.0000");
  });
  it("uses CN¥ for CNY to disambiguate from JPY ¥", () => {
    const ratesWithCNY = { ...rates, cny: { name: "Yuan", unit: "¥", value: 520_000, type: "fiat" as const } };
    expect(formatPriceInCurrency(1, "CNY", ratesWithCNY).startsWith("CN¥")).toBe(true);
  });
});

describe("formatCompactInCurrency", () => {
  it("uses currency prefix with T/B/M/K suffixes", () => {
    expect(formatCompactInCurrency(1.5e12, "USD", rates)).toBe("$1.50T");
    const eurOut = formatCompactInCurrency(1e9, "EUR", rates);
    expect(eurOut.startsWith("€") && eurOut.endsWith("M")).toBe(true);  // 1B USD * (70k/75k) = ~933M EUR
  });
});

describe("CURRENCIES", () => {
  it("lists exactly 8 currencies", () => {
    expect(CURRENCIES).toEqual(["USD", "EUR", "RUB", "GBP", "JPY", "CNY", "BTC", "ETH"]);
  });
});
```

- [ ] **Step 2: Implement** — create `src/lib/currency.ts`:
```ts
import type { ExchangeRates } from "@/lib/coingecko";

export const CURRENCIES = ["USD", "EUR", "RUB", "GBP", "JPY", "CNY", "BTC", "ETH"] as const;
export type Currency = (typeof CURRENCIES)[number];

const SYMBOLS: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  RUB: "₽",
  GBP: "£",
  JPY: "¥",
  CNY: "CN¥",
  BTC: "₿",
  ETH: "Ξ",
};

// Decimals at-or-above 1; sub-1 prices use formatPrice's adaptive precision.
const DECIMALS: Record<Currency, number> = {
  USD: 2, EUR: 2, RUB: 2, GBP: 2, JPY: 0, CNY: 2,
  BTC: 6, ETH: 4,
};

export function convert(priceUsd: number, target: Currency, rates: ExchangeRates): number {
  const usdRate = rates.usd?.value;
  const targetRate = rates[target.toLowerCase()]?.value;
  if (!usdRate || !targetRate) return Number.NaN;
  return priceUsd * (targetRate / usdRate);
}

function decimalsForAmount(value: number, target: Currency): number {
  const base = DECIMALS[target];
  if (value >= 1) return base;
  // Sub-1: use up to 6 decimals for fiat-style, keep crypto decimals.
  if (target === "BTC" || target === "ETH") return base;
  return 6;
}

export function formatPriceInCurrency(
  priceUsd: number,
  target: Currency,
  rates: ExchangeRates,
): string {
  const v = convert(priceUsd, target, rates);
  if (Number.isNaN(v)) return "—";
  const decimals = decimalsForAmount(v, target);
  const sym = SYMBOLS[target];
  const num = v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sym}${num}`;
}

export function formatCompactInCurrency(
  amountUsd: number,
  target: Currency,
  rates: ExchangeRates,
): string {
  const v = convert(amountUsd, target, rates);
  if (Number.isNaN(v)) return "—";
  const sym = SYMBOLS[target];
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sym}${(v / 1e3).toFixed(2)}K`;
  return `${sym}${v.toFixed(2)}`;
}
```

- [ ] **Step 3: Run tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test -- tests/currency.test.ts
```
Expected: all pass.

- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "feat(currency): conversion + per-currency formatters with tests"
```

---

## Task 4: Wire sparkline + rates into sync + worker

**Files:** `src/lib/sync/keys.ts`, `src/lib/sync/orchestrator.ts`, `worker/index.ts`, `src/lib/snapshot.ts`.

- [ ] **Step 1: Add rates key + TTL**

In `src/lib/sync/keys.ts`, add:
```ts
export const KEYS = {
  topList: "snapshot:list:top100",
  coin: (id: string) => `snapshot:coin:${id}`,
  globalStats: "global:stats",
  exchangeRates: "exchange:rates",
} as const;

export const TTL = {
  snapshot: 90,
  globalStats: 300,
  exchangeRates: 600,  // 10 min — rates barely move
} as const;
```

- [ ] **Step 2: Update orchestrator**

In `src/lib/sync/orchestrator.ts`:
- The `coinSnapshot.create` data needs `sparkline7d: r.sparkline7d` appended.
- Add a new `syncExchangeRates` function:

```ts
import type { ExchangeRates } from "@/lib/coingecko";

export async function syncExchangeRates(deps: {
  fetchExchangeRates: () => Promise<ExchangeRates>;
  redis: RedisLike;
}): Promise<void> {
  const rates = await deps.fetchExchangeRates();
  await deps.redis.set(KEYS.exchangeRates, JSON.stringify(rates), "EX", TTL.exchangeRates);
}
```

Inside `syncPrices`, add `sparkline7d: r.sparkline7d` to the `data` object passed to `prisma.coinSnapshot.create`.

- [ ] **Step 3: Update tests**

Open `tests/sync-orchestrator.test.ts`:
- In the existing `row` constant, add `sparkline7d: [1, 2, 3]`.
- Add a `syncExchangeRates` test:
```ts
import { syncExchangeRates } from "@/lib/sync/orchestrator";

describe("syncExchangeRates", () => {
  it("writes rates JSON to Redis under exchange:rates", async () => {
    const { redisStore, fakeRedis } = makeFakes();
    await syncExchangeRates({
      fetchExchangeRates: async () => ({
        usd: { name: "US Dollar", unit: "$", value: 75000, type: "fiat" as const },
      }),
      redis: fakeRedis as never,
    });
    expect(redisStore.get(KEYS.exchangeRates)).toBeDefined();
    expect(JSON.parse(redisStore.get(KEYS.exchangeRates)!).usd.value).toBe(75000);
  });
});
```

- [ ] **Step 4: Update worker**

In `worker/index.ts`:
- Import `syncExchangeRates`, `fetchExchangeRates`
- Add `runRatesSync` analogous to `runGlobalSync`
- Call it at startup AND schedule with the same 5-min cron as global-sync (single shared schedule is fine)

```ts
import { syncPrices, syncGlobal, syncExchangeRates } from "../src/lib/sync/orchestrator";
import { fetchTop100L1, fetchGlobalSnap, fetchExchangeRates } from "../src/lib/coingecko";

async function runRatesSync() {
  const t0 = Date.now();
  try {
    await syncExchangeRates({ fetchExchangeRates, redis: redis as never });
    console.log(`[worker] rates-sync ok in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[worker] rates-sync failed:`, err);
  }
}

// In main(), after runGlobalSync():
await runRatesSync();

// Schedule alongside global-sync:
cron.schedule("*/5 * * * *", () => {
  void runGlobalSync();
  void runRatesSync();
});
```

- [ ] **Step 5: Update snapshot reader**

In `src/lib/snapshot.ts`, add `readExchangeRates`:
```ts
import type { ExchangeRates } from "@/lib/coingecko";

export async function readExchangeRates(): Promise<ExchangeRates | null> {
  const cached = await redisGet(KEYS.exchangeRates);
  if (!cached) return null;
  try {
    return JSON.parse(cached) as ExchangeRates;
  } catch {
    return null;
  }
}
```

(No DB fallback — if Redis doesn't have rates, conversion silently degrades to USD-only display. The home page handles this gracefully via the `Number.isNaN` check in `convert`.)

- [ ] **Step 6: Smoke test the worker locally**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
brew services start redis 2>/dev/null || true
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" REDIS_URL="redis://127.0.0.1:6379" npm run worker:start &
WORKER_PID=$!
sleep 6
kill $WORKER_PID 2>/dev/null
redis-cli get exchange:rates | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('rates:', sorted([c for c in d.keys() if c in ['usd','eur','rub','gbp','jpy','cny','btc','eth']]))"
redis-cli get snapshot:list:top100 | python3 -c "import json,sys; rows=json.loads(sys.stdin.read()); s=rows[0].get('sparkline7d'); print(f'sparkline points on first coin: {len(s) if s else 0}')"
```
Expected:
- Log line `[worker] rates-sync ok in ...ms`
- Rates list includes all 8 currency codes
- Sparkline first coin has ~168 points

- [ ] **Step 7: Commit**
```bash
git add -A
git commit -m "feat(sync): exchange rates job + sparkline propagation"
```

---

## Task 5: Server-side currency resolver + setCurrency action

**Files:** `src/lib/get-currency.ts` (new), `src/app/actions/currency.ts` (new).

- [ ] **Step 1: Resolver**

Create `src/lib/get-currency.ts`:
```ts
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CURRENCIES, type Currency } from "@/lib/currency";

const COOKIE = "trientes_currency";

function isValid(v: string | undefined | null): v is Currency {
  return !!v && (CURRENCIES as readonly string[]).includes(v);
}

export async function getCurrency(): Promise<Currency> {
  // Logged-in: use user preference if valid
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferredCurrency: true },
    });
    if (u && isValid(u.preferredCurrency)) return u.preferredCurrency;
  }
  // Guest: cookie
  const c = (await cookies()).get(COOKIE)?.value;
  if (isValid(c)) return c;
  return "USD";
}

export const CURRENCY_COOKIE = COOKIE;
```

- [ ] **Step 2: Server action**

Create `src/app/actions/currency.ts`:
```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CURRENCIES, type Currency } from "@/lib/currency";
import { CURRENCY_COOKIE } from "@/lib/get-currency";

export async function setCurrency(value: string) {
  if (!(CURRENCIES as readonly string[]).includes(value)) return { ok: false };
  const currency = value as Currency;

  // Always set cookie (works for guests + logged-in)
  const jar = await cookies();
  jar.set(CURRENCY_COOKIE, currency, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  // If logged in, also persist on user
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { preferredCurrency: currency },
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "feat(currency): server-side resolver + setCurrency action"
```

---

## Task 6: Sparkline component

**Files:** `src/components/sparkline.tsx` (new).

- [ ] **Step 1: Implement**

```tsx
export function Sparkline({
  points,
  width = 80,
  height = 24,
}: {
  points: number[] | null | undefined;
  width?: number;
  height?: number;
}) {
  if (!points || points.length < 2) {
    return <div style={{ width, height }} className="opacity-30" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const stepX = width / (points.length - 1);
  const d = points
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const isUp = points[points.length - 1] >= points[0];
  const stroke = isUp ? "#22c55e" : "#ef4444"; // green-500 / red-500

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="overflow-visible"
    >
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add -A
git commit -m "feat(ui): Sparkline SVG component"
```

---

## Task 7: Currency switcher in navbar

**Files:** `src/components/currency-switcher.tsx` (new), `src/components/navbar.tsx` (modify).

- [ ] **Step 1: Switcher component**

Create `src/components/currency-switcher.tsx`:
```tsx
"use client";

import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CURRENCIES, type Currency } from "@/lib/currency";
import { setCurrency } from "@/app/actions/currency";

export function CurrencySwitcher({ current }: { current: Currency }) {
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending} aria-label="Currency">
          {current}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {CURRENCIES.map((c) => (
          <DropdownMenuItem
            key={c}
            onClick={() => start(() => setCurrency(c).then(() => undefined))}
          >
            {c}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Wire into navbar**

Edit `src/components/navbar.tsx`. Add imports:
```tsx
import { CurrencySwitcher } from "./currency-switcher";
import { getCurrency } from "@/lib/get-currency";
```

In the `Navbar()` function body, after `getTranslations`:
```tsx
const currency = await getCurrency();
```

In JSX, place `<CurrencySwitcher current={currency} />` next to `<ThemeToggle />`:
```tsx
<LocaleSwitcher />
<CurrencySwitcher current={currency} />
<ThemeToggle />
```

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "feat(ui): CurrencySwitcher in navbar with server-action persistence"
```

---

## Task 8: Update CoinRow + CoinTable; extract search/sort client component

**Files:** `src/components/coin-row.tsx`, `src/components/coin-table.tsx`, `src/components/coin-list-client.tsx` (new).

- [ ] **Step 1: Rewrite `src/components/coin-row.tsx`**

```tsx
import Image from "next/image";
import type { MarketRow, ExchangeRates } from "@/lib/coingecko";
import { formatPercent } from "@/lib/format";
import { formatPriceInCurrency, formatCompactInCurrency, type Currency } from "@/lib/currency";
import { Sparkline } from "./sparkline";

function pctClass(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  return v >= 0 ? "text-green-500" : "text-red-500";
}

export function CoinRow({
  row,
  currency,
  rates,
}: {
  row: MarketRow;
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const ratesOrEmpty = rates ?? {};
  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="px-3 py-3 text-sm text-muted-foreground tabular-nums">{row.rank}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          {row.logoUrl && (
            <Image src={row.logoUrl} alt="" width={20} height={20} className="rounded-full" unoptimized />
          )}
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-muted-foreground uppercase">{row.symbol}</span>
        </div>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {rates ? formatPriceInCurrency(row.priceUsd, currency, ratesOrEmpty) : `$${row.priceUsd.toFixed(2)}`}
      </td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange1h)}`}>{formatPercent(row.pctChange1h)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange24h)}`}>{formatPercent(row.pctChange24h)}</td>
      <td className={`px-3 py-3 text-right tabular-nums ${pctClass(row.pctChange7d)}`}>{formatPercent(row.pctChange7d)}</td>
      <td className="px-3 py-3 text-right tabular-nums">
        {rates ? formatCompactInCurrency(row.marketCapUsd, currency, ratesOrEmpty) : `$${(row.marketCapUsd / 1e9).toFixed(2)}B`}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {rates ? formatCompactInCurrency(row.volume24hUsd, currency, ratesOrEmpty) : `$${(row.volume24hUsd / 1e9).toFixed(2)}B`}
      </td>
      <td className="px-3 py-3">
        <Sparkline points={row.sparkline7d} />
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: Add a `sparkline` translation key in 10 message files**

In each of `messages/{en,ru,zh-CN,es,ja,ko,de,fr,pt-BR,tr}.json`, add `"sparkline7d": "7d"` (or the localized short label) inside the `listing` block. Translations:
- en: `"sparkline7d": "7d chart"`
- ru: `"sparkline7d": "График 7д"`
- zh-CN: `"sparkline7d": "7天图"`
- es: `"sparkline7d": "Gráfico 7d"`
- ja: `"sparkline7d": "7日チャート"`
- ko: `"sparkline7d": "7일 차트"`
- de: `"sparkline7d": "7T-Verlauf"`
- fr: `"sparkline7d": "Graph. 7j"`
- pt-BR: `"sparkline7d": "Gráfico 7d"`
- tr: `"sparkline7d": "7g grafik"`

Also add a `search` placeholder string:
- en: `"search": "Search by name or symbol…"`
- ru: `"search": "Поиск по названию или символу…"`
- zh-CN: `"search": "按名称或符号搜索…"`
- es: `"search": "Buscar por nombre o símbolo…"`
- ja: `"search": "名前/シンボルで検索…"`
- ko: `"search": "이름/심볼로 검색…"`
- de: `"search": "Nach Name oder Symbol suchen…"`
- fr: `"search": "Recherche par nom ou symbole…"`
- pt-BR: `"search": "Buscar por nome ou símbolo…"`
- tr: `"search": "İsim veya sembolle ara…"`

- [ ] **Step 3: Create client wrapper** — `src/components/coin-list-client.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { MarketRow, ExchangeRates } from "@/lib/coingecko";
import { Input } from "@/components/ui/input";
import { CoinRow } from "./coin-row";
import type { Currency } from "@/lib/currency";

type SortKey = "rank" | "price" | "pctChange24h" | "marketCap" | "volume";
type SortDir = "asc" | "desc";

const SORT_FIELDS: Record<SortKey, (r: MarketRow) => number> = {
  rank: (r) => r.rank,
  price: (r) => r.priceUsd,
  pctChange24h: (r) => r.pctChange24h ?? 0,
  marketCap: (r) => r.marketCapUsd,
  volume: (r) => r.volume24hUsd,
};

function SortHeader({
  label,
  field,
  currentKey,
  currentDir,
  onSort,
  align = "right",
}: {
  label: string;
  field: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = currentKey === field;
  const arrow = isActive ? (currentDir === "asc" ? " ▲" : " ▼") : "";
  return (
    <th
      className={`px-3 py-2 text-${align} font-medium cursor-pointer select-none hover:text-foreground`}
      onClick={() => onSort(field)}
    >
      {label}
      <span className="text-xs">{arrow}</span>
    </th>
  );
}

export function CoinListClient({
  rows,
  currency,
  rates,
}: {
  rows: MarketRow[];
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const t = useTranslations("listing");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "rank" ? "asc" : "desc");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q),
        )
      : rows;
    const fn = SORT_FIELDS[sortKey];
    const sorted = [...base].sort((a, b) => fn(a) - fn(b));
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [rows, query, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      <Input
        placeholder={t("search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className="border-b">
              <SortHeader label={t("rank")} field="rank" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="left" />
              <th className="px-3 py-2 text-left font-medium">{t("name")}</th>
              <SortHeader label={t("price")} field="price" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <th className="px-3 py-2 text-right font-medium">{t("change1h")}</th>
              <SortHeader label={t("change24h")} field="pctChange24h" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <th className="px-3 py-2 text-right font-medium">{t("change7d")}</th>
              <SortHeader label={t("marketCap")} field="marketCap" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <SortHeader label={t("volume24h")} field="volume" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
              <th className="px-3 py-2 text-left font-medium">{t("sparkline7d")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <CoinRow key={row.id} row={row} currency={currency} rates={rates} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Delete the now-unused `src/components/coin-table.tsx`**

```bash
git rm /Users/dmitry/Coinmarketcap/src/components/coin-table.tsx
```

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(ui): client list wrapper with search + sort + sparkline column"
```

---

## Task 9: Update home page to pass currency + rates

**Files:** `src/app/[locale]/page.tsx` (modify).

- [ ] **Step 1: Rewrite**

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { readTop100, readGlobalStats, readExchangeRates } from "@/lib/snapshot";
import { GlobalStatsHero } from "@/components/global-stats-hero";
import { CoinListClient } from "@/components/coin-list-client";
import { getCurrency } from "@/lib/get-currency";

export const revalidate = 60;

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  const tl = await getTranslations("listing");

  const [rows, stats, rates, currency] = await Promise.all([
    readTop100(),
    readGlobalStats(),
    readExchangeRates(),
    getCurrency(),
  ]);

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-4xl font-bold">{t("appName")}</h1>
        <p className="text-muted-foreground mt-1">{t("tagline")}</p>
      </header>
      <GlobalStatsHero stats={stats} currency={currency} rates={rates} />
      {rows.length > 0 ? (
        <CoinListClient rows={rows} currency={currency} rates={rates} />
      ) : (
        <p className="text-muted-foreground">{tl("loadingFallback")}</p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Update `GlobalStatsHero` to accept + use currency**

In `src/components/global-stats-hero.tsx`:
```tsx
import { useTranslations } from "next-intl";
import type { GlobalSnap, ExchangeRates } from "@/lib/coingecko";
import { formatCompactInCurrency, type Currency } from "@/lib/currency";

export function GlobalStatsHero({
  stats,
  currency,
  rates,
}: {
  stats: GlobalSnap | null;
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const t = useTranslations("listing");
  if (!stats) return null;
  const r = rates ?? {};
  const fmt = (n: number) => (rates ? formatCompactInCurrency(n, currency, r) : `$${(n / 1e9).toFixed(2)}B`);
  const cards = [
    { label: t("globalMarketCap"), value: fmt(stats.totalMarketCapUsd) },
    { label: t("globalVolume"), value: fmt(stats.total24hVolumeUsd) },
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

- [ ] **Step 3: Run all tests locally**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: all green.

- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "feat(home): currency + rates wired through hero and list"
```

---

## Task 10: Deploy + smoke test

**Files:** server-only.

- [ ] **Step 1: Push and pull**
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

- [ ] **Step 3: Restart PM2**
```bash
ssh dv@85.192.25.242 'pm2 restart trientes-web trientes-worker'
sleep 8
ssh dv@85.192.25.242 'pm2 logs trientes-worker --lines 25 --nostream'
```
Expected log lines:
- `[worker] price-sync ok: 99 coins`
- `[worker] global-sync ok`
- `[worker] rates-sync ok`

- [ ] **Step 4: Verify Redis has rates + sparklines**
```bash
ssh dv@85.192.25.242 "redis-cli get exchange:rates | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(\"rates currencies:\", sorted([c for c in [\"usd\",\"eur\",\"rub\",\"gbp\",\"jpy\",\"cny\",\"btc\",\"eth\"] if c in d]))'"
ssh dv@85.192.25.242 "redis-cli get snapshot:list:top100 | python3 -c 'import json,sys; rows=json.loads(sys.stdin.read()); s=rows[0].get(\"sparkline7d\"); print(f\"first coin sparkline length: {len(s) if s else 0}\")'"
```
Expected: 8 currencies present; sparkline ~168 points.

- [ ] **Step 5: Visual checks on the page**

```bash
# Sparkline SVG present?
curl -s http://85.192.25.242/en | grep -oE '<svg[^>]*>' | head -3
# Currency switcher renders USD initially?
curl -s http://85.192.25.242/en | grep -oE 'aria-label="Currency"' | head -1
# Search placeholder present?
curl -s http://85.192.25.242/en | grep -oE 'Search by name'
```
Expected: at least one `<svg>` tag, the `aria-label="Currency"` button, and search placeholder text.

- [ ] **Step 6: Currency switching end-to-end (with cookie)**

```bash
# Set cookie manually and request the page in EUR mode
curl -sb 'trientes_currency=EUR' http://85.192.25.242/en | grep -oE '€[0-9,]+\.[0-9]+' | head -3
```
Expected: prices prefixed with `€` appear.

- [ ] **Step 7: Health check**
```bash
curl -s http://85.192.25.242/api/health | python3 -m json.tool
```
Expected: `"ok": true`.

- [ ] **Step 8: Local test suite**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: all green.

---

## Done criteria

- [ ] Worker logs show all 3 jobs ticking: `price-sync`, `global-sync`, `rates-sync`
- [ ] Redis has `exchange:rates` with 8 currencies + first coin's sparkline has ~168 points
- [ ] Page at `/en` renders sparkline SVGs and currency switcher button
- [ ] Search input filters the table
- [ ] Clicking column header changes sort order
- [ ] Setting cookie `trientes_currency=EUR` produces € prices in HTML
- [ ] Logged-in user's currency preference persists across sessions (manual check)
- [ ] All unit tests pass

**Out of scope (Phase 4+):** coin detail page with full chart, SSE live updates, Binance WS, watchlist, coin requests, admin panel.
