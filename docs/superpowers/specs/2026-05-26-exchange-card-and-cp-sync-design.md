# Exchange Card Page + CoinPaprika Sync — Slice A Design

**Date:** 2026-05-26
**Slice:** A (foundation: auto-sourced data + public detail card)
**Follow-ups:** Slice B (admin-curated fields + internal ratings); Slice C (SEO structured data + click analytics)
**TZ source:** https://docs.google.com/document/d/1rlVSjUnsrj_hP8zWROpzjS0lXEmaoquwJkAzQqFHscw/mobilebasic

## Goal

Replace the current "click an exchange row → external redirect" flow with "click → internal exchange card → optional outbound link." Bring CoinPaprika data into the catalog so we surface ~90 additional vetted exchanges (volume > $100k/24h) alongside the existing CoinGecko set, and enrich overlapping rows with fields CG does not supply (description, type, fiats, socials, currencies, pairs count).

The card built in this slice is the foundation. Editorial content (KYC requirements, P2P/margin/futures/staking features, languages, min deposit/withdrawal, internal 1-10 ratings, wiki block) is **out of scope** here — those land in Slice B via a separate `ExchangeProfile` table and admin UI. SEO meta + Schema.org + click analytics land in Slice C.

## Scope

### In scope (Slice A)

- CoinPaprika exchanges fetcher (`src/lib/coinpaprika.ts`).
- `syncCoinPaprikaExchanges` orchestrator function and a new worker job, runs hourly after `syncExchanges`.
- Volume filter: import only CP exchanges where `active === true` AND `markets_data_fetched === true` AND `quotes.USD.adjusted_volume_24h > 100000`. Re-evaluated each run, so an exchange that drops below the threshold falls out of the catalog on the next sync.
- Prisma migration adding optional columns to `Exchange`: `description`, `exchangeType`, `currencies`, `pairsCount`, `fiats`, `socials`, `source`. Existing rows backfill `source = 'cg'`; curated entries (`richamster`) backfill `source = 'curated'`.
- Public detail page `src/app/[locale]/exchanges/[id]/page.tsx`. Server-rendered; 404 when `id` does not match a published `Exchange` row.
- `exchanges-table.tsx`: rewire row click from external `<a href={e.url}>` to internal `<Link href="/{locale}/exchanges/{id}">`. The external link survives only inside the detail card's "Visit website" CTA.
- Disclaimer + outbound link with `target="_blank" rel="nofollow sponsored noopener noreferrer"`.
- i18n keys for all new UI strings across the 10 supported locales.

### Out of scope (deferred to Slice B / C)

- KYC indicator, feature checkboxes (P2P / spot / margin / futures / staking / mobile / languages), min deposit, min withdrawal, internal 1-10 ratings.
- Admin moderation UI for editing card content, hiding rows, reordering.
- Wikipedia-style long-form section.
- Trading-pairs sample list ("BTC/USDT, ETH/USDT, SOL/USDT") on the card — the underlying market data is not currently synced.
- SEO `<title>` / `<meta>` per-card optimization, Open Graph tags, Schema.org structured data, GA / Yandex.Metrika click events.

## Data Model

### Migration `20260526180000_exchange_card_foundation`

Adds to `Exchange`:

```prisma
model Exchange {
  // ... existing fields unchanged
  description     String?  @db.Text
  exchangeType    String?  // "CEX" | "DEX" | "HYBRID" | "OTHER"
  currencies      Int?     // distinct coins listed (CP `currencies`)
  pairsCount      Int?     // total trading pairs (derived from CP `markets.length`)
  fiats           String[] // ISO-3 codes, e.g. ["UAH", "USD"]
  socials         Json?    // { twitter?: string, telegram?: string, facebook?: string, github?: string, reddit?: string, youtube?: string }
  source          String   @default("cg") // "cg" | "cp" | "curated"
}
```

Backfill on migration:

- All existing rows: `source = 'cg'`.
- `id = 'richamster'`: `source = 'curated'`.
- Other fields default to null/empty array.

### Id namespace + dedup

- CG ids stay primary (e.g. `binance`, `gdax`).
- CP-only exchanges are imported with their CP id verbatim as the Prisma `id` (e.g. `xeggex`, `cryptomus`). Both CG and CP use slug-like kebab-case, so collisions inside the CP-only set are extremely unlikely; we never need to namespace them.
- Overlap detection runs in two passes:
  1. **Id match:** if `cp.id ∈ Exchange.id` set → update the existing row, only filling **null** fields. CG-sourced fields (`name`, `logoUrl`, `country`, `yearEstablished`, `trustScore`, `trustScoreRank`, `volume24hBtc`, `volume24hUsd`, `url`) are never overwritten when `source = 'cg'`.
  2. **Manual alias:** a hardcoded map `CP_TO_CG_ALIAS` in `src/lib/coinpaprika.ts` covers the well-known cases where ids diverge:

     ```ts
     const CP_TO_CG_ALIAS: Record<string, string> = {
       'coinbase': 'gdax',         // CG calls Coinbase Exchange "gdax"
       // additional entries added as we discover them
     };
     ```

     If `CP_TO_CG_ALIAS[cp.id]` exists → treat as overlap with that CG id; CP row is **not** imported separately.
- If neither id-match nor alias matches, the CP row is inserted as a new `Exchange` with `source = 'cp'`.

### `Exchange.source` semantics

| Value      | Meaning                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------- |
| `cg`       | Row originated from CoinGecko sync. CG-sourced fields are authoritative.                  |
| `cp`       | Row originated from CoinPaprika sync. CP fields are authoritative.                        |
| `curated`  | Row originated from `src/lib/curated-exchanges.ts`. Curated fields are authoritative.    |

CP sync fills nulls for `source='cg'` and `source='curated'` rows, but never overwrites their authoritative fields.

## CoinPaprika Integration

### Fetcher — `src/lib/coinpaprika.ts`

```ts
export type CoinPaprikaExchange = {
  id: string;
  name: string;
  type: string[];                      // ["cex"] | ["dex"] | ["spot"] | ["perpetuals"] | ["other"]
  description: string | null;
  active: boolean;
  markets_data_fetched: boolean;
  adjusted_rank: number | null;
  currencies: number | null;
  fiats: { name: string; symbol: string }[];
  quotes: { USD?: { adjusted_volume_24h?: number } };
  links: { twitter?: string[]; telegram?: string[]; facebook?: string[]; github?: string[]; reddit?: string[]; youtube?: string[]; website?: string[] };
  last_updated: string;
};

export async function fetchCoinPaprikaExchanges(): Promise<CoinPaprikaExchange[]>;
export async function fetchCoinPaprikaExchange(id: string): Promise<CoinPaprikaExchangeDetail>; // for pairsCount via markets[]
```

- Endpoint: `GET https://api.coinpaprika.com/v1/exchanges` returns the full list (~1100 rows, ~800 KB).
- `pairsCount` requires `GET https://api.coinpaprika.com/v1/exchanges/{id}` (per-exchange). Fetched only for exchanges that pass the volume filter (~90 calls/sync); throttled to 1 req/sec.
- No API key required; rate limits documented as 20k req/month on free tier — 90 req/hour stays well under.

### Sync function — `src/lib/sync/orchestrator.ts`

```ts
export async function syncCoinPaprikaExchanges(deps: {
  fetchAll: () => Promise<CoinPaprikaExchange[]>;
  fetchOne: (id: string) => Promise<CoinPaprikaExchangeDetail>;
  prisma: { exchange: { findUnique; update; create; upsert } };
  minVolumeUsd: number; // default 100_000
}): Promise<{ created: number; enriched: number; skipped: number }>;
```

Logic:
1. Fetch full list.
2. Filter: `active && markets_data_fetched && quotes.USD.adjusted_volume_24h > minVolumeUsd`.
3. For each survivor:
   - Resolve target id via `CP_TO_CG_ALIAS[cp.id] ?? cp.id`.
   - `findUnique({ id: target })`:
     - **Found:** `update` with `data` containing only fields where the existing row is null (`description`, `exchangeType`, `currencies`, `pairsCount`, `fiats`, `socials`). Increment `enriched` counter.
     - **Missing:** fetch detail for `pairsCount`, then `create` with `source = 'cp'`, all CP fields populated, and best-effort `name`, `logoUrl` (built from the CP CDN convention `https://static.coinpaprika.com/exchange/{id}/logo.png`), `country` (null — CP's list endpoint does not expose it), `url` (`links.website[0]`), `volume24hUsd` (from CP quote), `volume24hBtc` (computed from `volume24hUsd / btcUsd` — orchestrator passes `btcUsd`). Increment `created` counter.

4. Returns counts for logging.

### Type mapping

CP `type` array → `Exchange.exchangeType`:
- contains `"cex"` or `"spot"` or `"perpetuals"` → `"CEX"`
- contains `"dex"` → `"DEX"`
- contains `"cex"` and `"dex"` → `"HYBRID"`
- otherwise → `"OTHER"`

### Worker schedule

New job in `src/worker/index.ts`, runs **hourly at :15** (offset from CG which runs at :00 to spread API load):

```
cron: "15 * * * *"
```

## Detail Page — `/{locale}/exchanges/[id]`

### Route

`src/app/[locale]/exchanges/[id]/page.tsx` — async server component, `params: { locale, id }`.

```ts
const exchange = await prisma.exchange.findUnique({ where: { id: params.id } });
if (!exchange) notFound();
```

### Layout (top to bottom)

1. **Hero / header**
   - 64×64 logo (fallback initial when null), exchange name as `<h1>`, `exchangeType` badge, country flag + name, year established.
   - Trust score badge (existing component) when `trustScore != null`.
   - 24h volume in user's currency (reusing existing `formatCurrency` + `useFx`).
   - Secondary CTA: outbound "Visit website" button (disabled when `url == null`).

2. **Parameters table** — two columns, rows hidden when value missing:
   - Type (`exchangeType`)
   - Country
   - Year established
   - KYC required — **Slice A: rendered as "—"** (no data yet); component reads from a future `ExchangeProfile.kyc` field, falling back to "—".
   - Fiats: chips with ISO codes.
   - Currencies count.
   - Pairs count.

3. **Volume metrics card**
   - Volume 24h USD (large), volume 24h BTC (small).
   - Trust score (1-10) with badge.

4. **Description block**
   - Renders `description` as plain text, wrapped in a styled card.
   - Hidden entirely when `description == null`.
   - Slice A: text from CoinPaprika `description` field. Often short and sometimes promotional — acceptable for now; Slice B's admin UI overrides this.

5. **Socials row**
   - Icons for twitter / telegram / facebook / github / reddit / youtube, each rendered when the corresponding key exists in `socials`. Reuse existing `SocialIcon` if present, otherwise inline `<a>` with icon + screen-reader label.

6. **Outbound CTA section**
   - Disclaimer text (i18n): "Вы покидаете наш сайт. Самостоятельно проверьте условия, комиссии и риски на сайте биржи."
   - Primary button "Перейти на сайт {exchange.name}" → `<a href={exchange.url} target="_blank" rel="nofollow sponsored noopener noreferrer">`.
   - Hidden when `url == null`.

7. **Placeholder for Slice B**
   - Empty `<section>` reserved with comment, no UI yet. Keeps the Slice B PR diff smaller.

### Component split

- `src/components/exchange-card/header.tsx`
- `src/components/exchange-card/parameters.tsx`
- `src/components/exchange-card/metrics.tsx`
- `src/components/exchange-card/description.tsx`
- `src/components/exchange-card/socials.tsx`
- `src/components/exchange-card/outbound-cta.tsx`

All are pure server components (no interactivity in Slice A).

## List Page Update — `exchanges-table.tsx`

- Desktop row (`<a href={e.url} target="_blank" ...>`) → `<Link href={\`/${locale}/exchanges/${e.id}\`}>` (no `target="_blank"`, internal navigation).
- Mobile row — same treatment.
- The external `e.url` is no longer referenced in the list at all; it lives only on the detail page.

## i18n

New namespace `exchangeCard.*` added to all 10 locale files (`en, ru, de, es, fr, ja, ko, pt-BR, tr, zh-CN`):

```
exchangeCard:
  parameters:
    title: "Parameters"
    type: "Type"
    country: "Country"
    yearEstablished: "Year established"
    kyc: "KYC required"
    fiats: "Fiat currencies"
    currencies: "Listed coins"
    pairs: "Trading pairs"
  metrics:
    title: "Trading metrics"
    volume24h: "24h volume"
    trustScore: "Trust score"
  description:
    title: "About"
  socials:
    title: "Social"
  outbound:
    disclaimer: "..."
    cta: "Visit {name}"
  notFound: "Exchange not found"
  noData: "—"
```

## Error Handling

- **CP fetch failure:** sync logs error, returns `{ created: 0, enriched: 0, skipped: 0 }`. Existing rows untouched, worker schedule retries next hour. Mirrors `syncExchanges` resilience pattern.
- **CP per-exchange detail failure (in `fetchOne`):** caller proceeds with `pairsCount = null` rather than aborting the whole sync.
- **Bad data:** non-string `description`, non-array `fiats`, etc. — validated with a small zod schema (`CoinPaprikaExchangeSchema`) at the boundary; invalid rows skipped with a single log line.
- **Detail page:** `notFound()` for unknown id → standard Next 404 page.
- **List → card → 404 transient race:** between sync runs an exchange could appear in the cached list but be gone from DB. Acceptable for a 1-hour TTL; revisit if user reports issues.

## Testing

Unit tests (Vitest):

- `src/lib/coinpaprika.spec.ts` — fetcher returns parsed array; zod schema rejects malformed payloads.
- `src/lib/sync/orchestrator.spec.ts` — extended with `syncCoinPaprikaExchanges`:
  - Skips rows under volume threshold.
  - Creates new row for CP-only id.
  - Enriches existing CG row by filling only nulls, never overwrites CG-sourced fields.
  - Honors `CP_TO_CG_ALIAS` mapping.
  - Computes `volume24hBtc` from USD volume + btcUsd.
- `src/app/[locale]/exchanges/[id]/page.spec.tsx` — renders all sections when data present; hides sections with null data; `notFound` on unknown id.

No e2e in this slice — manual smoke (open `/exchanges/richamster`, `/exchanges/xeggex`, `/exchanges/binance`) is sufficient.

## Deployment

Per `project_trientes_deploy_from_server`:

1. `npx prisma migrate deploy` (against live DB).
2. `npm run build`.
3. `pm2 restart trientes-web trientes-worker` (worker touched because `src/lib/coinpaprika.ts` and orchestrator change).
4. Drop `snapshot:exchanges:top100` from Redis so the new fields land in cached payloads quickly.
5. Trigger one-off sync run from the worker (or wait for the next `:15`).
6. `pm2 save`, push to origin/main.

## Open Questions / Notes for Later

- **Logo fallback for CP-only rows:** `https://static.coinpaprika.com/exchange/{id}/logo.png` URLs work in spot-checks but are not guaranteed. If broken images surface, add an `onError` fallback in `header.tsx`.
- **`country` for CP-only rows:** CP exposes it via the `/v1/exchanges/{id}` detail call sometimes, sometimes not. Acceptable to ship with null and let Slice B's admin UI fill it.
- **Curated `RichAmster` description override:** Slice A picks up CP's short description automatically. Once Slice B ships, admin can replace it with the longer text from the owner's submission.
- **Trust score for CP-only rows:** stays null in Slice A — `confidence_score` from CP is on a 0-100 scale and is mostly zero, so it's not a useful drop-in for our 1-10 `trustScore`. Slice B's admin UI can set it manually.
