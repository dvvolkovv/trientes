# Trientes

Top 100 Layer-1 cryptocurrencies, ranked. Live at [trientes.org](https://trientes.org).

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript)
- **Database:** PostgreSQL 16 + Prisma ORM
- **Cache:** Redis 8 (ioredis)
- **Auth:** Auth.js v5 (Google + GitHub + Telegram Login Widget)
- **UI:** shadcn/ui + TailwindCSS 4
- **i18n:** next-intl (10 locales: EN, RU, ZH, ES, JA, KO, DE, FR, PT-BR, TR)
- **Process manager:** PM2
- **Reverse proxy:** Nginx

## Local Development

### Prerequisites

- Node.js 22+
- PostgreSQL (local DB: `trientes_dev`)
- Redis

### Setup

```bash
# Install the baseline dependencies (see the peer-dependency note below)
npm ci --legacy-peer-deps

# Create local env file
cp .env.example .env.local
# Edit .env.local with your credentials

# Run database migrations
npm run db:migrate

# Start the development server
npm run dev
```

The `--legacy-peer-deps` flag is scoped to this site's baseline install only: the locked `openai@4.104.0` requests
`zod^3.23.8`, while the root uses `zod4.4.3`. Do not set the flag globally and do not change the manifests to silence
that baseline peer constraint.

Open [http://localhost:3000](http://localhost:3000) — redirects to `/en`.

### Tests

```bash
npm test           # Run all unit tests (Vitest)
npm run test:watch # Watch mode
```

### Admin bootstrap

Promote a user to admin by email:
```bash
npm run grant-admin -- --email your@email.com
# or by Telegram ID:
npm run grant-admin -- --telegram 12345678
# or by GitHub account ID (numeric):
npm run grant-admin -- --github 98765
```

Alternatively, set `ADMIN_WHITELIST=email:your@email.com` in `.env.local` before the user's first sign-in.

## Environment Variables

See `.env.example` for the full list. Key vars:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `NEXTAUTH_URL` | Public URL of the app |
| `NEXTAUTH_SECRET` | Random 32-byte secret (`openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID/SECRET` | Google OAuth app credentials |
| `GITHUB_CLIENT_ID/SECRET` | GitHub OAuth app credentials |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | Telegram bot username (without @) |
| `ADMIN_WHITELIST` | Comma-separated admin identities (see above) |

## Deployment

The app runs on `85.192.25.242` under PM2:

```bash
# SSH to server
ssh dv@85.192.25.242

# Pull latest + rebuild
cd ~/trientes && git pull && npm ci --legacy-peer-deps && npm run build

# Restart
pm2 restart trientes-web trientes-worker
```

### MapLibre runtime assets

The map worker is served at runtime from `.generated/maplibre/<version>/` by the
`/maplibre/[...path]` route; it is not part of `public/` or `.next/`.

- Build only with `npm run build`: its `prebuild` step copies the installed
  MapLibre worker and shared bundles there. A bare `next build` skips the copy.
- Start PM2 / `next start` with the repository root as the working directory:
  the route resolves the directory from `process.cwd()`.
- `.generated/maplibre` belongs to the build output: whenever `.next` is copied
  or moved to another host or directory, copy it along.
- Only `npm run build` deletes old versions (it keeps the current and the
  previous one for open tabs). `npm test` and `npm run dev` copy the assets but
  never delete anything.
- On startup the server logs `[maplibre-assets] DEPLOYMENT ERROR` if an asset
  of the installed version is missing.

### OAuth App Registration

To enable sign-in, register OAuth apps:

**Google:** [console.cloud.google.com](https://console.cloud.google.com)
- Authorized redirect URI: `https://trientes.org/api/auth/callback/google`

**GitHub:** [github.com/settings/developers](https://github.com/settings/developers)
- Callback URL: `https://trientes.org/api/auth/callback/github`

**Telegram:** Talk to [@BotFather](https://t.me/botfather) — create a bot, get the token. Set `TELEGRAM_BOT_USERNAME` to your bot's username. The widget requires HTTPS in production.

### Health Check

```bash
curl https://trientes.org/api/health
```

### Exchange market-data APIs

The exchange page at `/exchange/` uses these public read-only Binance proxies for chart data. They do **not** quote or
create Trientes orders: an order quote comes only from the Trientes chain's `SwapApi.quote`.

#### `GET /api/exchange/klines`

Query parameters:

| Parameter | Default | Validation |
|---|---|---|
| `symbol` | required | Trimmed and uppercased, then must match `^[A-Z0-9]{4,30}$` |
| `interval` | `1h` | One of `1s`, `1m`, `5m`, `15m`, `1h`, `4h`, `1d`, `1w`, `1M` |
| `limit` | `500` | Decimal integer from 1 through 1000 |

Example: `/api/exchange/klines?symbol=ETHBTC&interval=1h&limit=720`.

A `200` response has `x-cache: hit` or `x-cache: miss` and this shape:

```json
{
  "source": "binance",
  "symbol": "ETHBTC",
  "interval": "1h",
  "fetchedAt": 1793800000000,
  "candles": [
    { "time": 1793799600, "open": 0.035, "high": 0.036, "low": 0.034, "close": 0.0358, "volume": 123.45 }
  ]
}
```

`fetchedAt` is Unix milliseconds. Candle `time` is Unix seconds; candles have strictly increasing timestamps and
validated OHLC/volume values.

#### `GET /api/exchange/ticker`

`symbol` is required and follows the same validation rule. Example: `/api/exchange/ticker?symbol=ETHBTC`.

A `200` response has `x-cache: hit` or `x-cache: miss` and this shape:

```json
{
  "source": "binance",
  "symbol": "ETHBTC",
  "fetchedAt": 1793800000000,
  "lastPrice": 0.0358,
  "priceChangePercent": 1.24,
  "volume": 184209.1,
  "quoteVolume": 6598.2
}
```

`volume` is the 24-hour base-asset volume and `quoteVolume` the quote-asset volume.

#### Error contract

Errors always use `{ "error": "<code>" }`:

| Status | Codes | Meaning |
|---:|---|---|
| 400 | `invalid_symbol`, `invalid_interval`, `invalid_limit` | Invalid query input |
| 404 | `pair_unavailable` | Binance returned HTTP 400 with a parsed JSON body containing `code: -1121` |
| 502 | `upstream_unavailable` | Fetch failure/timeout, any other HTTP 400 body (including non-JSON/WAF), another unsuccessful Binance status, or an unexpected failure |
| 502 | `upstream_shape` | Invalid JSON, response shape, numeric values, timestamps, OHLC or volume |
| 503 | `upstream_rate_limited` | Binance returned HTTP 418 or 429 |

Redis is only a cache. Cached payloads are fully validated again. Every Redis read/write has a 250 ms deadline
and uses a dedicated client with its offline queue disabled. A transport timeout or failure disconnects that client,
opens a 5-second circuit and falls back to Binance; a failed cache write is ignored. Malformed cached JSON is only a
miss: it neither disconnects the client nor opens the circuit, so a subsequent cache write can replace the bad entry.
Kline TTLs range from 2 seconds (`1s`) to 3600 seconds (`1M`); ticker TTL is 5 seconds. Binance requests have an
8-second timeout.

### Backups

Daily Postgres backups run at 03:00 UTC on the server, stored at `~/backups/pg/`, 14-day retention.

## Project Structure

```
src/
├── app/
│   ├── [locale]/          # All pages under locale prefix
│   │   ├── page.tsx        # Home (coin listings in Phase 2)
│   │   ├── login/          # Auth page
│   │   ├── settings/       # User preferences
│   │   ├── admin/          # Admin panel (Phase 6)
│   │   ├── watchlist/      # User watchlist (Phase 5)
│   │   └── request/        # Coin request form (Phase 5)
│   ├── api/
│   │   ├── auth/           # Auth.js + Telegram callback
│   │   ├── exchange/       # Binance klines and 24h ticker for the exchange chart
│   │   └── health/         # Health check endpoint
│   └── actions/            # Server actions (auth, settings)
├── auth.ts                 # NextAuth full config (Node.js runtime)
├── auth.config.ts          # NextAuth middleware-safe config (edge)
├── middleware.ts            # Intl + auth gating
├── i18n.ts                 # next-intl request config
├── lib/
│   ├── prisma.ts            # PrismaClient singleton
│   ├── redis.ts             # ioredis singleton
│   ├── admin-whitelist.ts   # ADMIN_WHITELIST parser/matcher
│   ├── telegram-auth.ts     # Telegram HMAC verifier
│   ├── telegram-provider.ts # Auth.js credentials provider
│   ├── grant-admin-core.ts  # grant-admin pure function
│   └── locales.ts           # Locale list + labels
└── components/
    ├── navbar.tsx
    ├── footer.tsx
    ├── locale-switcher.tsx
    ├── theme-toggle.tsx
    ├── theme-provider.tsx
    ├── login-buttons.tsx
    ├── telegram-login.tsx
    ├── settings-form.tsx
    └── ui/                  # shadcn components
messages/                    # next-intl translation files (10 locales)
worker/                      # Background worker (Phase 2+)
scripts/                     # CLI utilities
deploy/                      # Server config (nginx, backup)
```

## Roadmap

- **Phase 1 (current):** Scaffold, auth, i18n, theme, deployment
- **Phase 2:** CoinGecko sync worker, coin listing page
- **Phase 3:** Per-coin detail page with charts (TradingView lightweight-charts)
- **Phase 4:** Exchange listings, global stats bar
- **Phase 5:** User watchlist, coin request form
- **Phase 6:** Admin panel (approve/reject coin requests, user management)
- **Phase 7:** i18n polish (Crowdin), SEO, performance
