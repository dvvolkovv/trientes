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
# Install dependencies
npm install

# Create local env file
cp .env.example .env.local
# Edit .env.local with your credentials

# Run database migrations
npm run db:migrate

# Start the development server
npm run dev
```

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
cd ~/trientes && git pull && npm ci && npm run build

# Restart
pm2 restart trientes-web trientes-worker
```

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
