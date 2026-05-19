# Trientes — CoinMarketCap-style L1 listing on trientes.org

**Status:** Design approved (2026-05-19)
**Author:** dvvolkovv@gmail.com
**Target domain:** https://trientes.org
**Server:** 85.192.25.242 (Ubuntu 26.04, 7.8GB RAM, 118GB disk)

---

## 1. Scope and goals

A CoinMarketCap-style web product showing the **top 100 Layer-1 cryptocurrencies** plus an admin-curated extension list, on the domain `trientes.org`. Users can sign in via OAuth, keep a watchlist, and submit requests to add coins; admins review requests and curate the list.

### Feature scope (full CMC parity — option C from brainstorm)

- Listing page with rank, logo, price, %1h/24h/7d, market cap, volume, supply, 7d sparkline
- Per-coin detail page with multi-timeframe price chart, description, links, supply metrics, markets
- Global statistics (total market cap, BTC/ETH dominance, fear & greed)
- Exchanges listing by volume
- Personal watchlist (signed-in users)
- Coin request workflow (user submits → admin approves/rejects)
- Admin panel: direct coin add, request review, user role management
- 10 languages, 8 display currencies, light/dark themes

### Layer-1 detection (option A from brainstorm)

Top-100 is fetched automatically from CoinGecko's `layer-1` category. The admin panel exists **only to add coins that the auto-filter misses** or that admins want to feature. Total listing = `100 auto-fetched L1` + `N admin-added` (no upper bound on N).

---

## 2. Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Web framework | Next.js 15 (App Router, TypeScript) | SSR/ISR for SEO, RSC for performance, API routes co-located |
| DB | PostgreSQL 16 | Standard, Prisma-friendly, easy backup |
| ORM | Prisma | Type-safe, migrations |
| Cache | Redis 7 | Hot price snapshots, sessions optional |
| Auth | Auth.js v5 (NextAuth) | OAuth providers, Prisma adapter, server-side sessions |
| OAuth providers | Google, GitHub, Telegram Login Widget | Per user (option C) |
| i18n | next-intl | Path-based locale routing, SSR-friendly |
| UI | TailwindCSS + shadcn/ui | Light/dark out of the box, fast iteration |
| Charts | lightweight-charts (TradingView) | Performant on historical data |
| Cron | node-cron in dedicated worker process | Decoupled from web process |
| Process mgr | PM2 | Standard on existing AEZA boxes |
| Reverse proxy | Nginx + Let's Encrypt (certbot) | — |

### Data sources (option D — hybrid)

| Source | Used for | Rate strategy |
|--------|----------|---------------|
| CoinGecko Free API | top-100 L1 list, coin metadata, descriptions, historical OHLC, exchanges, global stats | ~30 req/min limit → aggressive Redis caching, 60s refresh cadence |
| Binance Public API/WS | Optional fast price refresh for top-20 coins by volume | WebSocket, no auth needed |

CoinGecko endpoints used:
- `GET /coins/markets?category=layer-1&vs_currency=usd&...&sparkline=true&price_change_percentage=1h,24h,7d` — main listing
- `GET /coins/{id}` — coin detail (description, links, etc.)
- `GET /coins/{id}/market_chart` — historical chart (1D/7D/1M/1Y/All)
- `GET /coins/{id}/tickers` — markets where the coin trades
- `GET /exchanges` — exchanges listing
- `GET /global` — global market stats
- `GET /search` — admin coin search

---

## 3. Architecture & data flow

```
CoinGecko Free API ──┐
                     │  every 60s →
Binance WS (opt.) ───┤  worker fetches top-100 L1 + admin-added + global stats
                     ▼
            ┌─────────────────────────────┐
            │  Price Sync Worker (cron)   │  → Redis  (snapshot:coin:{id}, TTL 90s)
            └─────────────────────────────┘  → Postgres (CoinSnapshot, PriceHistory)
                     │
                     ▼
            ┌─────────────────────────────┐
            │  Next.js (web) — port 3000  │
            │  • RSC + ISR (60s)          │
            │  • API routes               │
            │  • SSE/WS live updates      │
            └─────────────────────────────┘
                     │
                     ▼ HTTPS / WSS
              Browser
```

### Caching tiers

1. **Redis (90s TTL)** — `snapshot:coin:{id}` JSON; `snapshot:list:top100` array; `global:stats`. Read by all API routes and RSC.
2. **ISR (60s)** — `/[locale]`, `/[locale]/coin/[slug]`, `/[locale]/exchanges`. Statically regenerated.
3. **Postgres** — durable history (`CoinSnapshot`, `PriceHistory`).

### Refresh cadences

| Job | Cadence | What |
|-----|---------|------|
| `price-sync` | 60s | CoinGecko `/coins/markets` for top-100 + admin-added; updates Redis snapshot + Postgres `CoinSnapshot` |
| `global-stats-sync` | 5 min | CoinGecko `/global` + fear&greed API |
| `history-snapshot` | 1 hour | Append OHLC candle for each coin to `PriceHistory` |
| `exchanges-sync` | 15 min | CoinGecko `/exchanges` top 100 |
| `cleanup` | daily | Drop `CoinSnapshot` older than 30 days |

### Live updates in the browser

Open page → ISR-rendered HTML → client subscribes to SSE `/api/stream/prices` → server flushes Redis snapshot when the worker writes (or every 10s heartbeat). No client polls CoinGecko directly.

---

## 4. Data model (Prisma)

```prisma
model User {
  id                String   @id @default(cuid())
  email             String?  @unique
  name              String?
  image             String?
  role              Role     @default(USER)
  preferredLocale   String   @default("en")
  preferredCurrency String   @default("USD")
  preferredTheme    String   @default("system")
  createdAt         DateTime @default(now())
  accounts          Account[]
  sessions          Session[]
  watchlist         Watchlist[]
  coinRequests      CoinRequest[]
}

model Coin {
  id                    String   @id          // CoinGecko id (e.g. "bitcoin")
  symbol                String
  name                  String
  slug                  String   @unique
  rank                  Int
  logoUrl               String?
  source                CoinSource
  addedByAdminId        String?
  approvedFromRequestId String?  @unique
  description           String?  @db.Text     // JSON blob: { en, ru, ... }
  websiteUrl            String?
  explorerUrl           String?
  whitepaperUrl         String?
  githubUrl             String?
  twitterUrl            String?
  redditUrl             String?
  isActive              Boolean  @default(true)
  createdAt             DateTime @default(now())
  snapshots             CoinSnapshot[]
}

model CoinSnapshot {
  id                String   @id @default(cuid())
  coinId            String
  coin              Coin     @relation(fields: [coinId], references: [id])
  priceUsd          Decimal  @db.Decimal(24, 10)
  pricesJson        Json                              // { eur, rub, gbp, jpy, cny, btc, eth }
  marketCapUsd      Decimal  @db.Decimal(30, 2)
  volume24hUsd      Decimal  @db.Decimal(30, 2)
  pctChange1h       Float?
  pctChange24h      Float?
  pctChange7d       Float?
  circulatingSupply Decimal? @db.Decimal(30, 2)
  totalSupply       Decimal? @db.Decimal(30, 2)
  maxSupply         Decimal? @db.Decimal(30, 2)
  sparkline7d       Json?
  fetchedAt         DateTime @default(now())
  @@index([coinId, fetchedAt])
}

model PriceHistory {
  coinId     String
  date       DateTime @db.Date
  openUsd    Decimal  @db.Decimal(24, 10)
  highUsd    Decimal  @db.Decimal(24, 10)
  lowUsd     Decimal  @db.Decimal(24, 10)
  closeUsd   Decimal  @db.Decimal(24, 10)
  volumeUsd  Decimal  @db.Decimal(30, 2)
  @@id([coinId, date])
}

model CoinRequest {
  id           String        @id @default(cuid())
  userId       String
  user         User          @relation(fields: [userId], references: [id])
  symbol       String
  name         String
  coingeckoId  String?
  reason       String        @db.Text
  status       RequestStatus @default(PENDING)
  reviewedAt   DateTime?
  reviewedById String?
  rejectReason String?
  createdAt    DateTime      @default(now())
}

model Watchlist {
  userId  String
  coinId  String
  addedAt DateTime @default(now())
  @@id([userId, coinId])
}

model GlobalStats {
  id                Int      @id @default(1)
  totalMarketCapUsd Decimal  @db.Decimal(30, 2)
  total24hVolumeUsd Decimal  @db.Decimal(30, 2)
  btcDominancePct   Float
  ethDominancePct   Float
  activeCryptos     Int
  markets           Int
  fearGreedIndex    Int?
  fearGreedLabel    String?
  fetchedAt         DateTime @default(now())
}

// NextAuth tables (Account, Session, VerificationToken) — generated by Prisma adapter

enum Role          { USER ADMIN }
enum CoinSource    { AUTO_L1 ADMIN_ADDED }
enum RequestStatus { PENDING APPROVED REJECTED }
```

---

## 5. Page map

All pages are nested under `/[locale]/` where locale ∈ {en, ru, zh-CN, es, ja, ko, de, fr, pt-BR, tr}.

| Route | Auth | Description |
|-------|------|-------------|
| `/` | public | Top-100 L1 + admin-added. Search, sort, pagination. Global stats hero above the table. |
| `/coin/[slug]` | public | Price chart (1D/7D/1M/1Y/All), description, links, supply metrics, markets, watchlist toggle. |
| `/exchanges` | public | Exchanges by volume. |
| `/watchlist` | USER | Same UI as `/`, filtered to user's watchlist. |
| `/request` | USER | Submit coin-add request; list own requests with status. |
| `/admin/coins` | ADMIN | Add/edit/disable admin-added coins. |
| `/admin/requests` | ADMIN | Approve/reject pending requests. |
| `/admin/users` | ADMIN | Manage roles. |
| `/login` | guest | OAuth buttons (Google/GitHub/Telegram). |
| `/settings` | USER | Preferred locale/currency/theme, delete account. |

---

## 6. Auth & roles

**Provider strategy:** Auth.js v5 with Prisma adapter, **database** session strategy (not JWT) so we can invalidate sessions server-side.

**Bootstrap admins (options A + C):**
1. `ADMIN_WHITELIST` env var — comma-separated entries like `email:foo@bar.com,telegram:12345,github:octocat`. On first login, if a user's identity matches, role is set to `ADMIN` automatically.
2. CLI fallback — `npm run grant-admin -- --email foo@bar.com` for ad-hoc promotions.

**Middleware** (`auth.config.ts`): protects `/admin/*` (403 if not ADMIN), `/watchlist` and `/request` (redirect to `/login` for guests).

**Telegram Login** uses the Telegram Login Widget; the server-side handler validates the HMAC signature with `TELEGRAM_BOT_TOKEN`. Email is not provided by Telegram — `User.email` may be NULL for Telegram-only accounts; identity uniqueness is enforced by Auth.js's `Account` row (`provider="telegram"`, `providerAccountId=<telegram numeric id>`).

**Permission matrix:**

| Action | Guest | USER | ADMIN |
|--------|-------|------|-------|
| Browse listings, coin pages, exchanges | ✅ | ✅ | ✅ |
| Watchlist | ❌ | ✅ | ✅ |
| Submit coin request | ❌ | ✅ | ✅ |
| Approve/reject requests | ❌ | ❌ | ✅ |
| Add coin directly | ❌ | ❌ | ✅ |
| Manage admin roles | ❌ | ❌ | ✅ |

---

## 7. Coin request workflow

```
USER on /request:
  Form (symbol, name, coingeckoId?, reason) → CoinRequest{status: PENDING}
  Lists own requests with statuses inline.

ADMIN on /admin/requests:
  Sees pending list. Click APPROVE:
    → modal opens, pre-filled.
    → if coingeckoId is set, /api/admin/coingecko-lookup fetches:
        name, symbol, logo, description (multi-language), links.
    → otherwise inline search uses CoinGecko /search.
    → admin reviews/edits, SAVE creates Coin{source: ADMIN_ADDED, approvedFromRequestId},
      flips CoinRequest.status = APPROVED.
    → next price-sync cycle (≤60s) pulls a price → coin appears in listings.

  Click REJECT:
    → reason dialog → CoinRequest.status = REJECTED, rejectReason saved.
    → user sees the reason in their own /request list.

Notifications: in-app only. A badge on the navbar shows unread status updates
(seen=false flag on request) and clears on visit to /request.
```

`/admin/coins` lets admins add coins directly (same modal, no request linkage), disable any admin-added coin (`isActive=false`), and re-enable. AUTO_L1 coins are managed by the worker — admins cannot disable them (would race with the sync).

---

## 8. i18n

**Locales:** en, ru, zh-CN, es, ja, ko, de, fr, pt-BR, tr.

**Routing:** `/[locale]/...` path prefix; middleware redirects `/` based on `Accept-Language`, defaulting to `en`.

**Translation files:** `messages/{locale}.json`, grouped by namespace (`common`, `coin`, `admin`, `request`, ...). UI labels only — coin descriptions come from CoinGecko's per-language fields.

**SEO:** `<html lang>` set per page; `<link rel="alternate" hreflang>` tags for the 10 alternates on every page.

---

## 9. Display currencies

USD, EUR, RUB, GBP, JPY, CNY, BTC, ETH.

CoinGecko `/coins/markets` accepts `vs_currency` for one fiat per call. To get all 8 in one fetch, the worker calls the endpoint **once per currency** every 60s (8 calls / minute, comfortably within CoinGecko Free tier limits) and stores prices as `pricesJson` per snapshot. Browser renders the currency the user picked in `/settings` (or per-session in localStorage for guests).

---

## 10. Deployment

**Target:** `dv@85.192.25.242` (`coinmarketcap.ptr.network`, Ubuntu 26.04). User `dv` already created with passwordless SSH + NOPASSWD sudo.

**To install:**
- Node.js 22 LTS (NodeSource)
- PostgreSQL 16 (native, listens on 127.0.0.1)
- Redis 7 (native, listens on 127.0.0.1)
- Nginx
- certbot (Let's Encrypt)
- PM2 (global npm)
- git, build-essential

**PM2 processes:**

| Process | Description |
|---------|-------------|
| `trientes-web` | Next.js production server, port 3000 |
| `trientes-worker` | Dedicated Node process running node-cron jobs (price-sync, global-stats-sync, history-snapshot, exchanges-sync, cleanup) |

Two processes so a redeploy of web doesn't restart cron, and so web can use PM2 cluster mode without duplicating jobs.

**Nginx vhost** terminates TLS for `trientes.org` and `www.trientes.org` → `127.0.0.1:3000` with HTTP/2, gzip, static caching for `/_next/static/`, and WS upgrade for SSE.

**DNS (IONOS panel — manual step):**
- `A trientes.org → 85.192.25.242`
- `A www.trientes.org → 85.192.25.242`
- TTL 3600

Once DNS propagates → `certbot --nginx -d trientes.org -d www.trientes.org`.

**Firewall (ufw):** allow 22, 80, 443; deny all else.

**Backups:**
- Nightly `pg_dump` to `/home/dv/backups/pg/`, 14-day retention via logrotate-style script.
- No standby (out of scope for v1).

**Deploy command (manual, no CI):**
```
ssh dv@85.192.25.242 'cd ~/trientes && git pull && npm ci && \
  npx prisma migrate deploy && npm run build && \
  pm2 restart trientes-web trientes-worker'
```

---

## 11. Environment variables

```
DATABASE_URL=postgresql://trientes:***@127.0.0.1:5432/trientes
REDIS_URL=redis://127.0.0.1:6379
NEXTAUTH_URL=https://trientes.org
NEXTAUTH_SECRET=***
GOOGLE_CLIENT_ID=***
GOOGLE_CLIENT_SECRET=***
GITHUB_CLIENT_ID=***
GITHUB_CLIENT_SECRET=***
TELEGRAM_BOT_TOKEN=***
COINGECKO_API_KEY=                                # empty = Free tier
BINANCE_USE_WS=true
ADMIN_WHITELIST=email:dvvolkovv@gmail.com         # comma-separated; supports email:/telegram:/github: prefixes
PRICE_REFRESH_SEC=60
```

---

## 12. Security

- All inbound HTTPS terminated at Nginx; HSTS enabled.
- CSP header restricting scripts to self + CoinGecko image CDN + Telegram widget origin.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- Rate limit on `/api/*` (60 rpm per IP) via middleware.
- CSRF protection from Auth.js for state-changing routes.
- Postgres/Redis bind to `127.0.0.1` only.
- No secrets in client bundles — all OAuth secrets server-side.

---

## 13. Testing

Minimum for v1:
- Unit tests for: CoinGecko response parser, price formatter, currency converter, ADMIN_WHITELIST matcher, rank calculator (auto + admin merge), CoinRequest state machine.
- Smoke test for `/api/health` (DB + Redis + CoinGecko reachable).

Out of scope for v1: E2E (Playwright), load tests.

---

## 14. Out of scope (Phase 2 candidates)

- Email notifications for request status changes
- Web/mobile push notifications
- Public developer API
- Interactive home-page sparklines
- Price alerts, portfolio, coin comparison
- DEX integration (Uniswap, Jupiter) and DEX-only tokens
- Mobile app
- GitHub Actions CI/CD
- Registration with this box in `monitor.taler.tirol`
- Standby/HA replica setup

---

## 15. Implementation phases (high level)

To be detailed in the implementation plan (next step):

1. **Scaffold** — Next.js project, Prisma schema, DB & Redis on server, Auth.js, layout shell, i18n routing
2. **Sync worker** — CoinGecko + Binance pipeline writing to Redis & Postgres
3. **Public listing** — `/` with ISR, search/sort, sparkline rendering
4. **Coin detail page** — chart, description, links, markets
5. **Watchlist + coin requests** — user-facing flows
6. **Admin panel** — `/admin/coins`, `/admin/requests`, `/admin/users`
7. **Global stats + exchanges** — `/exchanges`, hero stats on home
8. **Deploy** — DNS, Nginx + TLS, PM2, backup cron
