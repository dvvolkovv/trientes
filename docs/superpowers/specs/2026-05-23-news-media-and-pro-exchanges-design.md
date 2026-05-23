# Design — News-card media + PRO per-coin exchange listings

Date: 2026-05-23
Status: approved-by-default (clarifying questions declined; user delegated the
concept and explicitly asked to ship to trientes.org)

## Goals

1. **News banner media** — every card in the home-page Newsflow banner shows a
   visual (article thumbnail), with a branded fallback when a feed carries none.
2. **PRO per-coin exchanges** — on the coin detail page, only surface exchanges
   where the coin is actually listed: filter the Pro chart's exchange selector
   to listed venues, and present a "Top 20 exchanges" listings table built from
   real CoinGecko ticker data.

Out of scope: video in news cards (the four RSS feeds carry images only — no
video — and scraping article pages for `og:video` is fragile/slow); adding new
kline adapters beyond the existing five.

---

## Feature 1 — News-card media

### Data
- Extend `NewsItem` (`src/lib/news.ts`) with `imageUrl: string | null`.
- Configure `rss-parser` with `customFields.item` for `media:content`,
  `media:thumbnail`, `enclosure`.
- New pure helper `extractImage(item): string | null` — first valid http(s)
  image URL, in priority order:
  1. `media:thumbnail` / `media:content` (`url`, when `type`/`medium` is image-ish)
  2. `enclosure` with `type` starting `image/`
  3. first `<img src>` found in `content`/`content:encoded`
  Returns `null` when none qualify (e.g. CoinDesk). Unit-tested.
- `parseFeed` populates `imageUrl` via `extractImage`.
- **Backward compat:** old `news:latest` cache entries predate `imageUrl`
  (`undefined` → treated as no image). After deploy, delete the Redis key once so
  the next `readNews()` re-fetches with images; the worker refreshes every 30 min
  regardless.

### UI (`src/components/news-rail.tsx`)
- Card gains a 16:9 media area at the top:
  - With image: `next/image` (`unoptimized`, matching `coin-row.tsx`), `object-cover`.
  - Without image: branded placeholder — a gradient tinted by the theme color,
    the source name centered, subtle "T" mark. Deterministic per item.
- Theme tag moves to an overlay chip on the media (top-left); relative time stays
  in the body. Headline + source row unchanged below.
- Grid/҂hairline framing and `group-hover` behavior unchanged.

### Testing
- `extractImage` unit tests: media:content, media:thumbnail, enclosure(image),
  enclosure(non-image → null), content `<img>`, none → null.

---

## Feature 2 — PRO per-coin exchange listings

"PRO" = the Pro mode on the coin-detail chart panel
(`chart-panel.tsx` → `trading-chart.tsx`). The chart can only draw candles from
the 5 venues with kline adapters (`src/lib/exchanges.ts`: binance, bybit, kucoin,
cryptocom, kraken). CoinGecko `/coins/{id}/tickers` knows every venue the coin
lists on. We use each source for what it can do.

### Data
- New cached read `readTickers(coinId)` in `src/lib/snapshot.ts` — Redis
  `tickers:{coinId}`, TTL ~15 min, live `fetchTickers` fallback on cold cache.
  Bounds CoinGecko calls (free tier).
- Two new pure helpers (in `src/lib/coingecko.ts` or a small `src/lib/listings.ts`),
  both unit-tested:
  - `topExchangesByVolume(tickers, limit=20)` — aggregate `TickerRow[]` per
    exchange name: sum `volumeUsd`, keep the highest-volume pair as the
    representative (base/target, price, tradeUrl). Sort desc by summed volume,
    take top `limit`. Returns distinct exchanges.
  - `listedAdapterExchanges(tickers): Set<ExchangeId>` — normalize ticker
    `exchange` names to our adapter ids ("Binance"→binance, "Bybit"→bybit,
    "KuCoin"→kucoin, "Crypto.com Exchange"/"Crypto.com"→cryptocom,
    "Kraken"→kraken); return the subset present.

### Page wiring (`coin/[slug]/page.tsx`)
- Fetch tickers once via `readTickers(coin.id)` in the existing `Promise.all`.
- Compute `topExchangesByVolume(tickers, 20)` and `listedAdapterExchanges(tickers)`.
- Pass `availableExchanges` (the listed adapter set) down through `ChartPanel`
  → `TradingChart`.
- Replace the current `MarketsTable` (which fetched its own top-10 markets) with
  an upgraded listings table fed the shared top-20 distinct exchanges.

### Chart selector (`trading-chart.tsx`)
- New prop `availableExchanges: ExchangeId[]` (the listed adapter ids).
- Render only those buttons instead of the full hardcoded `EXCHANGES`.
- Default `exchange` state to the first available; if a coin has no listed
  adapter venue, hide the selector and let the existing CoinGecko OHLC fallback
  drive the chart (already the route's tier-3 behavior).

### Listings table (upgrade `markets.tsx`)
- Accept `exchanges: TopExchange[]` as a prop (no internal fetch).
- Heading "Top 20 exchanges" (reuse existing `detail` i18n keys: exchange / pair
  / price / volume). Show distinct exchanges, only where listed (tickers are
  listings by definition), with trade links. Desktop table + mobile cards
  pattern unchanged.

### Testing
- `topExchangesByVolume`: aggregation, dedupe-by-exchange, ordering, limit cap.
- `listedAdapterExchanges`: name normalization incl. "Crypto.com Exchange",
  unknown venue ignored, empty input.

---

## Rollout
- TDD the pure helpers; full `vitest` suite green; `eslint` clean; `npm run build`.
- Deploy on the prod server: `pm2 restart trientes-web`; delete `news:latest`
  Redis key once so images appear immediately.
- Verify live on https://trientes.org via headless browser: banner cards show
  media; a coin detail page shows only listed exchanges in the Pro selector and a
  top-20 listings table.

## Risks
- CoinGecko free-tier limits on `/coins/{id}/tickers`: mitigated by Redis cache
  + page `revalidate=3600`.
- Some ticker exchange names won't map to an adapter (fine — those still appear
  in the top-20 table, just not as a chart source).
- External image hosts vary; `unoptimized` next/image avoids a domain allowlist.
  Broken images fall back to the placeholder via `onError`.
