# Trientes Phase 1: Scaffold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Next.js 15 project with PostgreSQL, Redis, Auth.js (Google/GitHub/Telegram), 10-locale i18n, light/dark themes, and a working public + auth-gated layout, deployed to `85.192.25.242` over HTTP. End state: a user can visit the server, switch locale/theme, sign in via any of the three providers, and be redirected based on role. No coin data yet — Phase 2 adds the sync worker.

**Architecture:** Next.js App Router monolith. PostgreSQL via Prisma. Redis available but only used by health check in this phase. Auth.js v5 with database sessions. ADMIN_WHITELIST env-driven admin bootstrap + `grant-admin` CLI fallback. next-intl for path-prefixed locales (`/[locale]/...`). next-themes for theme toggle. PM2 manages two processes (`trientes-web`, `trientes-worker` — worker stub only in this phase).

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, Prisma, PostgreSQL 16, Redis 7, Auth.js v5 (next-auth@beta), next-intl, next-themes, Vitest (unit tests), PM2, Nginx, Node.js 22 LTS.

**Reference spec:** `docs/superpowers/specs/2026-05-19-trientes-cmc-clone-design.md`.

**Working directory:** `/Users/dmitry/Coinmarketcap` (local). Server: `dv@85.192.25.242` (passwordless SSH already configured).

---

## File structure produced by this plan

```
/Users/dmitry/Coinmarketcap/
├── .env.example
├── .env.local                # gitignored; secrets for dev
├── .gitignore
├── .eslintrc.json
├── .prettierrc
├── README.md
├── ecosystem.config.js        # PM2 config
├── next.config.mjs
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── vitest.config.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/            # generated
├── messages/                  # next-intl translations
│   ├── en.json
│   ├── ru.json
│   ├── zh-CN.json
│   ├── es.json
│   ├── ja.json
│   ├── ko.json
│   ├── de.json
│   ├── fr.json
│   ├── pt-BR.json
│   └── tr.json
├── scripts/
│   └── grant-admin.ts         # CLI: npm run grant-admin -- --email ...
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   └── [...nextauth]/route.ts
│   │   │   └── health/
│   │   │       └── route.ts
│   │   ├── [locale]/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   ├── settings/
│   │   │   │   └── page.tsx
│   │   │   └── admin/
│   │   │       └── page.tsx   # placeholder for Phase 6
│   │   ├── layout.tsx         # root: html/body, theme provider
│   │   └── globals.css
│   ├── auth.ts                # NextAuth config
│   ├── auth.config.ts         # middleware-safe config (no DB calls)
│   ├── middleware.ts          # locale + auth gating
│   ├── i18n.ts                # next-intl request config
│   ├── lib/
│   │   ├── prisma.ts          # PrismaClient singleton
│   │   ├── redis.ts           # ioredis singleton
│   │   ├── admin-whitelist.ts # ADMIN_WHITELIST parser + matcher
│   │   ├── telegram-auth.ts   # Telegram Login Widget HMAC verifier
│   │   └── locales.ts         # SUPPORTED_LOCALES constant
│   └── components/
│       ├── navbar.tsx
│       ├── footer.tsx
│       ├── locale-switcher.tsx
│       ├── theme-toggle.tsx
│       ├── theme-provider.tsx
│       └── ui/                # shadcn components installed via CLI
├── tests/
│   ├── admin-whitelist.test.ts
│   ├── telegram-auth.test.ts
│   └── grant-admin.test.ts
└── worker/
    └── index.ts               # stub: prints "worker started", phase 2 fills it
```

---

## Task 1: Server prep — install runtime stack on `85.192.25.242`

**Files:** server-side only, no repo files.

- [ ] **Step 1: Update apt and install base packages**

Run from local:
```bash
ssh dv@85.192.25.242 'sudo apt-get update -qq && sudo apt-get install -y -qq curl ca-certificates gnupg lsb-release build-essential git ufw'
```
Expected: completes with exit 0. No prompts (NOPASSWD sudo).

- [ ] **Step 2: Install Node.js 22 LTS via NodeSource**

```bash
ssh dv@85.192.25.242 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y -qq nodejs && node -v && npm -v'
```
Expected: `node -v` prints `v22.x.x`.

- [ ] **Step 3: Install PostgreSQL 16**

```bash
ssh dv@85.192.25.242 'sudo apt-get install -y -qq postgresql-16 postgresql-contrib-16 && sudo systemctl enable --now postgresql && systemctl is-active postgresql'
```
Expected: `active`.

- [ ] **Step 4: Install Redis 7**

```bash
ssh dv@85.192.25.242 'sudo apt-get install -y -qq redis-server && sudo systemctl enable --now redis-server && redis-cli ping'
```
Expected: `PONG`.

- [ ] **Step 5: Install Nginx + certbot**

```bash
ssh dv@85.192.25.242 'sudo apt-get install -y -qq nginx certbot python3-certbot-nginx && sudo systemctl enable --now nginx && systemctl is-active nginx'
```
Expected: `active`.

- [ ] **Step 6: Install PM2 globally**

```bash
ssh dv@85.192.25.242 'sudo npm install -g pm2 && pm2 -v'
```
Expected: a version string.

- [ ] **Step 7: Configure ufw firewall**

```bash
ssh dv@85.192.25.242 'sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw --force enable && sudo ufw status'
```
Expected: `Status: active` with 22, 80, 443 ALLOW.

- [ ] **Step 8: Pin Postgres and Redis to localhost only**

Verify defaults (Ubuntu 26.04 ships them bound to `127.0.0.1` by default):
```bash
ssh dv@85.192.25.242 'sudo ss -tlnp | grep -E ":(5432|6379)\s"'
```
Expected: both listening on `127.0.0.1:5432` and `127.0.0.1:6379` (or `::1`). If any of them shows `0.0.0.0`, edit `/etc/postgresql/16/main/postgresql.conf` (`listen_addresses = 'localhost'`) and `/etc/redis/redis.conf` (`bind 127.0.0.1 ::1`), then restart.

- [ ] **Step 9: Set up enable PM2 startup**

```bash
ssh dv@85.192.25.242 'pm2 startup systemd -u dv --hp /home/dv | tail -1'
```
Copy the resulting `sudo env PATH=... pm2 startup ...` line printed, then:
```bash
ssh dv@85.192.25.242 'sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u dv --hp /home/dv'
```
Expected: `[PM2] Init system found: systemd` and success message.

- [ ] **Step 10: No commit — server config has no local artifact this task**

(Server config is captured later in the README at Task 25.)

---

## Task 2: Create PostgreSQL database and role for trientes

**Files:** server-side only.

- [ ] **Step 1: Generate a strong password for the DB role**

```bash
DB_PASS=$(openssl rand -hex 24); echo "$DB_PASS"
```
Save this output — you need it for env files in Task 8 and Task 24.

- [ ] **Step 2: Create role and database via `sudo -u postgres psql`**

```bash
ssh dv@85.192.25.242 "sudo -u postgres psql -c \"CREATE ROLE trientes WITH LOGIN PASSWORD '$DB_PASS';\" -c \"CREATE DATABASE trientes OWNER trientes;\""
```
Expected: `CREATE ROLE` and `CREATE DATABASE`.

- [ ] **Step 3: Verify connection**

```bash
ssh dv@85.192.25.242 "PGPASSWORD='$DB_PASS' psql -h 127.0.0.1 -U trientes -d trientes -c 'SELECT current_database(), current_user;'"
```
Expected: row `trientes | trientes`.

- [ ] **Step 4: Create a local dev DB too (on the Mac)**

```bash
# Requires Postgres on Mac. If not installed:
brew install postgresql@16 && brew services start postgresql@16
createdb trientes_dev
psql trientes_dev -c "SELECT version();"
```
Expected: a Postgres version string.

- [ ] **Step 5: No commit — DB creation has no local artifact**

---

## Task 3: Initialize Next.js 15 project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `postcss.config.mjs`, `tailwind.config.ts`

- [ ] **Step 1: Scaffold Next.js into the existing empty repo**

```bash
cd /Users/dmitry/Coinmarketcap
npx --yes create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbo --use-npm --skip-install
```
Answer `Yes` to "directory not empty" prompt (we have only `.git` and `docs/`).

- [ ] **Step 2: Install dependencies**

```bash
npm install
```
Expected: completes without errors. `node_modules/` populated.

- [ ] **Step 3: Verify dev server boots**

```bash
npm run dev &
DEV_PID=$!
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
kill $DEV_PID
```
Expected: `200`.

- [ ] **Step 4: Confirm `.gitignore` covers `.env*.local`, `.next`, `node_modules`**

```bash
grep -E "\.env\*\.local|\.next|node_modules" /Users/dmitry/Coinmarketcap/.gitignore
```
Expected: all three lines present. `create-next-app` adds them by default.

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitry/Coinmarketcap
git add -A
git commit -m "chore: scaffold Next.js 15 app with TS + Tailwind"
```

---

## Task 4: Configure shadcn/ui base and theme provider

**Files:**
- Create: `components.json` (shadcn config), `src/components/ui/button.tsx`, `src/components/theme-provider.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Initialize shadcn/ui**

```bash
cd /Users/dmitry/Coinmarketcap
npx --yes shadcn@latest init -y --base-color slate --css-variables
```
Expected: creates `components.json`, updates `src/app/globals.css` with CSS variables.

- [ ] **Step 2: Add commonly needed components**

```bash
npx --yes shadcn@latest add button dropdown-menu dialog input label form table sonner
```
Expected: components added under `src/components/ui/`.

- [ ] **Step 3: Install next-themes**

```bash
npm install next-themes
```

- [ ] **Step 4: Create theme provider**

Create `src/components/theme-provider.tsx`:
```tsx
"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

- [ ] **Step 5: Wrap root layout with the theme provider**

Replace `src/app/layout.tsx` body with:
```tsx
import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Trientes",
  description: "Top Layer-1 cryptocurrencies, ranked.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: configure shadcn/ui + next-themes provider"
```

---

## Task 5: Install Prisma and write initial schema

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/prisma.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Install Prisma**

```bash
npm install -D prisma
npm install @prisma/client
```

- [ ] **Step 2: Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```
This creates `prisma/schema.prisma` and updates `.env` (we'll replace this with `.env.local` later).

- [ ] **Step 3: Write the initial schema**

Replace `prisma/schema.prisma` entirely with:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

model User {
  id                String    @id @default(cuid())
  email             String?   @unique
  name              String?
  image             String?
  role              Role      @default(USER)
  preferredLocale   String    @default("en")
  preferredCurrency String    @default("USD")
  preferredTheme    String    @default("system")
  emailVerified     DateTime?
  createdAt         DateTime  @default(now())
  accounts          Account[]
  sessions          Session[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

- [ ] **Step 4: Create the Prisma client singleton**

Create `src/lib/prisma.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["error", "warn"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 5: Add migration npm script**

In `package.json`, ensure `"scripts"` contains:
```json
"db:migrate": "prisma migrate dev",
"db:deploy": "prisma migrate deploy",
"db:studio": "prisma studio",
"db:generate": "prisma generate"
```

- [ ] **Step 6: Create `.env.local` with the local DB URL**

Create `.env.local`:
```
DATABASE_URL=postgresql://$(whoami)@localhost:5432/trientes_dev
REDIS_URL=redis://127.0.0.1:6379
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=local-dev-secret-change-me-in-prod
ADMIN_WHITELIST=email:dvvolkovv@gmail.com
```
Replace `$(whoami)` with your actual Mac username (run `whoami`).

- [ ] **Step 7: Generate and run initial migration locally**

```bash
npx prisma migrate dev --name init
```
Expected: creates `prisma/migrations/<ts>_init/migration.sql`, applies it to `trientes_dev`, regenerates client.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(db): initial Prisma schema (User + NextAuth tables)"
```

---

## Task 6: Add `.env.example` and wire `.env*.local` into `.gitignore`

**Files:**
- Create: `.env.example`
- Modify: `.gitignore` (verify)

- [ ] **Step 1: Create `.env.example`**

```
DATABASE_URL=postgresql://trientes:CHANGE_ME@127.0.0.1:5432/trientes
REDIS_URL=redis://127.0.0.1:6379
NEXTAUTH_URL=https://trientes.org
NEXTAUTH_SECRET=CHANGE_ME

# OAuth providers
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=

# Admin bootstrap. Comma-separated entries with prefixes:
#   email:foo@bar.com
#   telegram:123456789
#   github:octocat
ADMIN_WHITELIST=

# Coin data sources (used in Phase 2)
COINGECKO_API_KEY=
BINANCE_USE_WS=true
PRICE_REFRESH_SEC=60
```

- [ ] **Step 2: Confirm `.env`, `.env.local`, `.env*.local` are ignored**

```bash
git check-ignore -v .env.local
```
Expected: prints `.gitignore:<line>:.env*.local  .env.local` (or similar).

- [ ] **Step 3: Commit**

```bash
git add .env.example .gitignore
git commit -m "chore: add .env.example with all required vars"
```

---

## Task 7: Install Vitest and write the ADMIN_WHITELIST matcher (TDD)

**Files:**
- Create: `vitest.config.ts`, `tests/admin-whitelist.test.ts`, `src/lib/admin-whitelist.ts`
- Modify: `package.json` (add test script)

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest @vitest/ui
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Add npm test script**

In `package.json` `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the failing test**

Create `tests/admin-whitelist.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isAdminWhitelisted, parseAdminWhitelist } from "@/lib/admin-whitelist";

describe("parseAdminWhitelist", () => {
  it("parses comma-separated prefixed entries", () => {
    const parsed = parseAdminWhitelist(
      "email:foo@bar.com,telegram:123,github:octo",
    );
    expect(parsed).toEqual([
      { type: "email", value: "foo@bar.com" },
      { type: "telegram", value: "123" },
      { type: "github", value: "octo" },
    ]);
  });

  it("trims whitespace and ignores empty entries", () => {
    expect(parseAdminWhitelist(" email:a@b.com ,, github:x ")).toEqual([
      { type: "email", value: "a@b.com" },
      { type: "github", value: "x" },
    ]);
  });

  it("lowercases emails and github usernames", () => {
    expect(parseAdminWhitelist("email:FOO@Bar.COM,github:OctoCat")).toEqual([
      { type: "email", value: "foo@bar.com" },
      { type: "github", value: "octocat" },
    ]);
  });

  it("preserves telegram ids as-is (numeric strings)", () => {
    expect(parseAdminWhitelist("telegram:123456789")).toEqual([
      { type: "telegram", value: "123456789" },
    ]);
  });

  it("ignores entries with unknown prefixes", () => {
    expect(parseAdminWhitelist("twitter:foo,email:a@b.com")).toEqual([
      { type: "email", value: "a@b.com" },
    ]);
  });

  it("returns [] for empty/undefined input", () => {
    expect(parseAdminWhitelist("")).toEqual([]);
    expect(parseAdminWhitelist(undefined)).toEqual([]);
  });
});

describe("isAdminWhitelisted", () => {
  const list = parseAdminWhitelist(
    "email:foo@bar.com,telegram:42,github:octo",
  );

  it("matches by email case-insensitively", () => {
    expect(isAdminWhitelisted(list, { email: "FOO@bar.com" })).toBe(true);
  });

  it("matches by telegram id", () => {
    expect(isAdminWhitelisted(list, { telegramId: "42" })).toBe(true);
  });

  it("matches by github username case-insensitively", () => {
    expect(isAdminWhitelisted(list, { githubLogin: "Octo" })).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(isAdminWhitelisted(list, { email: "other@x.com" })).toBe(false);
  });

  it("returns false on empty whitelist", () => {
    expect(isAdminWhitelisted([], { email: "foo@bar.com" })).toBe(false);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
npm test
```
Expected: FAIL — `Cannot find module '@/lib/admin-whitelist'`.

- [ ] **Step 6: Implement**

Create `src/lib/admin-whitelist.ts`:
```ts
export type AdminEntry =
  | { type: "email"; value: string }
  | { type: "telegram"; value: string }
  | { type: "github"; value: string };

export type AdminIdentity = {
  email?: string | null;
  telegramId?: string | null;
  githubLogin?: string | null;
};

const KNOWN_PREFIXES = ["email", "telegram", "github"] as const;
type KnownPrefix = (typeof KNOWN_PREFIXES)[number];

function normalize(type: KnownPrefix, raw: string): string {
  const v = raw.trim();
  if (type === "telegram") return v;
  return v.toLowerCase();
}

export function parseAdminWhitelist(
  raw: string | undefined | null,
): AdminEntry[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(":");
      if (idx === -1) return null;
      const prefix = entry.slice(0, idx).trim().toLowerCase();
      const value = entry.slice(idx + 1);
      if (!KNOWN_PREFIXES.includes(prefix as KnownPrefix)) return null;
      const type = prefix as KnownPrefix;
      const normalized = normalize(type, value);
      if (!normalized) return null;
      return { type, value: normalized } as AdminEntry;
    })
    .filter((x): x is AdminEntry => x !== null);
}

export function isAdminWhitelisted(
  list: AdminEntry[],
  identity: AdminIdentity,
): boolean {
  for (const entry of list) {
    if (entry.type === "email" && identity.email) {
      if (entry.value === identity.email.toLowerCase()) return true;
    } else if (entry.type === "telegram" && identity.telegramId) {
      if (entry.value === identity.telegramId) return true;
    } else if (entry.type === "github" && identity.githubLogin) {
      if (entry.value === identity.githubLogin.toLowerCase()) return true;
    }
  }
  return false;
}
```

- [ ] **Step 7: Run test to verify it passes**

```bash
npm test
```
Expected: all 11 assertions PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(auth): ADMIN_WHITELIST parser and matcher with tests"
```

---

## Task 8: Telegram Login Widget HMAC verifier (TDD)

**Files:**
- Create: `tests/telegram-auth.test.ts`, `src/lib/telegram-auth.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/telegram-auth.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { verifyTelegramAuth } from "@/lib/telegram-auth";

function makeSignedPayload(botToken: string, fields: Record<string, string>) {
  const secret = createHash("sha256").update(botToken).digest();
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return { ...fields, hash };
}

describe("verifyTelegramAuth", () => {
  const botToken = "1234567:test-bot-token";

  it("accepts a valid signed payload", () => {
    const payload = makeSignedPayload(botToken, {
      id: "42",
      first_name: "Alice",
      username: "alice",
      auth_date: String(Math.floor(Date.now() / 1000)),
    });
    expect(verifyTelegramAuth(payload, botToken)).toEqual({
      ok: true,
      telegramId: "42",
      firstName: "Alice",
      lastName: undefined,
      username: "alice",
      photoUrl: undefined,
    });
  });

  it("rejects a tampered payload", () => {
    const payload = makeSignedPayload(botToken, {
      id: "42",
      auth_date: String(Math.floor(Date.now() / 1000)),
    });
    payload.id = "999";
    expect(verifyTelegramAuth(payload, botToken)).toEqual({
      ok: false,
      reason: "bad_hash",
    });
  });

  it("rejects a stale auth_date (older than 1 day)", () => {
    const payload = makeSignedPayload(botToken, {
      id: "42",
      auth_date: String(Math.floor(Date.now() / 1000) - 86401),
    });
    expect(verifyTelegramAuth(payload, botToken)).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("rejects missing hash", () => {
    expect(verifyTelegramAuth({ id: "42" }, botToken)).toEqual({
      ok: false,
      reason: "missing_hash",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/telegram-auth.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/lib/telegram-auth.ts`:
```ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type TelegramAuthPayload = Record<string, string | undefined>;

export type TelegramAuthResult =
  | {
      ok: true;
      telegramId: string;
      firstName?: string;
      lastName?: string;
      username?: string;
      photoUrl?: string;
    }
  | { ok: false; reason: "missing_hash" | "bad_hash" | "stale" };

const MAX_AGE_SEC = 86400;

export function verifyTelegramAuth(
  payload: TelegramAuthPayload,
  botToken: string,
): TelegramAuthResult {
  const { hash, ...rest } = payload;
  if (!hash) return { ok: false, reason: "missing_hash" };

  const dataCheckString = Object.keys(rest)
    .filter((k) => rest[k] !== undefined && rest[k] !== "")
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");

  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_hash" };
  }

  const authDate = Number(rest.auth_date ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) {
    return { ok: false, reason: "stale" };
  }

  return {
    ok: true,
    telegramId: String(rest.id),
    firstName: rest.first_name,
    lastName: rest.last_name,
    username: rest.username,
    photoUrl: rest.photo_url,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/telegram-auth.test.ts
```
Expected: all 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): Telegram Login Widget HMAC verifier with tests"
```

---

## Task 9: Wire up Auth.js v5 with Google, GitHub providers + Prisma adapter

**Files:**
- Create: `src/auth.ts`, `src/auth.config.ts`, `src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Install Auth.js and Prisma adapter**

```bash
npm install next-auth@beta @auth/prisma-adapter
```

- [ ] **Step 2: Create middleware-safe auth config**

Create `src/auth.config.ts`:
```ts
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";

export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: "/en/login",
  },
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const isAdminRoute = /\/[a-z-]+\/admin(\/|$)/i.test(path);
      const isProtectedRoute =
        /\/[a-z-]+\/(watchlist|request|settings)(\/|$)/i.test(path);
      const role = (auth?.user as { role?: string } | undefined)?.role;
      if (isAdminRoute) return role === "ADMIN";
      if (isProtectedRoute) return !!auth?.user;
      return true;
    },
  },
} satisfies NextAuthConfig;
```

- [ ] **Step 3: Create the full auth config**

Create `src/auth.ts`:
```ts
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import {
  isAdminWhitelisted,
  parseAdminWhitelist,
} from "@/lib/admin-whitelist";
import { authConfig } from "@/auth.config";

const adminWhitelist = parseAdminWhitelist(process.env.ADMIN_WHITELIST);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  events: {
    async createUser({ user }) {
      const matched = isAdminWhitelisted(adminWhitelist, {
        email: user.email ?? null,
      });
      if (matched && user.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: "ADMIN" },
        });
      }
    },
    async linkAccount({ user, account }) {
      if (account.provider === "github") {
        // GitHub login isn't returned in default profile; we'd need profile() hook.
        // ADMIN_WHITELIST for GitHub uses providerAccountId (numeric id) — see Task 11.
      }
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async session({ session, user }) {
      if (session.user) {
        (session.user as { id?: string }).id = user.id;
        (session.user as { role?: string }).role = (user as { role?: string })
          .role;
      }
      return session;
    },
  },
});
```

- [ ] **Step 4: Add the route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 5: Generate a real NEXTAUTH_SECRET**

```bash
openssl rand -base64 32
```
Copy the output into `.env.local`, replacing the placeholder:
```
NEXTAUTH_SECRET=<the-base64-string>
```

- [ ] **Step 6: Verify build doesn't break**

```bash
npm run build
```
Expected: builds successfully (with warnings about missing GOOGLE_CLIENT_ID etc — that's fine, those routes lazy-init).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(auth): wire up Auth.js v5 with Google + GitHub + Prisma adapter"
```

---

## Task 10: Add Telegram as a custom Auth.js provider

**Files:**
- Create: `src/lib/telegram-provider.ts`
- Modify: `src/auth.config.ts`, `src/auth.ts`

- [ ] **Step 1: Create the custom credentials provider**

Create `src/lib/telegram-provider.ts`:
```ts
import Credentials from "next-auth/providers/credentials";
import { verifyTelegramAuth } from "@/lib/telegram-auth";

export function TelegramProvider() {
  return Credentials({
    id: "telegram",
    name: "Telegram",
    credentials: {
      id: { type: "text" },
      first_name: { type: "text" },
      last_name: { type: "text" },
      username: { type: "text" },
      photo_url: { type: "text" },
      auth_date: { type: "text" },
      hash: { type: "text" },
    },
    async authorize(raw) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return null;
      const payload = Object.fromEntries(
        Object.entries(raw ?? {}).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;
      const result = verifyTelegramAuth(payload, token);
      if (!result.ok) return null;
      return {
        id: `telegram:${result.telegramId}`,
        name:
          [result.firstName, result.lastName].filter(Boolean).join(" ") ||
          result.username ||
          `Telegram ${result.telegramId}`,
        image: result.photoUrl ?? null,
        // Email omitted intentionally; Telegram users have no email.
        // Account linkage uses `providerAccountId = telegramId`.
        telegramId: result.telegramId,
      } as unknown as import("next-auth").User;
    },
  });
}
```

- [ ] **Step 2: Add Telegram to providers list**

Edit `src/auth.config.ts` — change the `providers` array:
```ts
import { TelegramProvider } from "@/lib/telegram-provider";
// ... at top, alongside Google/GitHub imports.

// Inside the config:
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
    TelegramProvider(),
  ],
```

- [ ] **Step 3: Hook ADMIN_WHITELIST for telegram + github in jwt/signIn callback**

The current `events.createUser` handles email-based admin promotion. Add a `signIn` callback in `src/auth.ts` to handle telegram and github IDs:

Replace the `callbacks` block in `src/auth.ts` with:
```ts
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      // Promote to ADMIN on every sign-in if identity matches whitelist.
      // Email-based promotion also fires in events.createUser for brand-new users.
      if (!user?.id) return true;
      const githubLogin =
        account?.provider === "github"
          ? ((profile as { login?: string } | undefined)?.login ?? null)
          : null;
      const telegramId =
        account?.provider === "telegram" ? (account.providerAccountId ?? null) : null;
      const matched = isAdminWhitelisted(adminWhitelist, {
        email: user.email ?? null,
        telegramId,
        githubLogin,
      });
      if (matched) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: "ADMIN" },
        });
      }
      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        (session.user as { id?: string }).id = user.id;
        (session.user as { role?: string }).role = (user as { role?: string })
          .role;
      }
      return session;
    },
  },
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): add Telegram Login Widget as custom credentials provider"
```

---

## Task 11: `grant-admin` CLI script (TDD)

**Files:**
- Create: `tests/grant-admin.test.ts`, `scripts/grant-admin.ts`, `src/lib/grant-admin-core.ts`
- Modify: `package.json` (script entry)

- [ ] **Step 1: Write the failing test**

The CLI itself is a thin shell over a pure function — test the pure function.

Create `tests/grant-admin.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { grantAdminCore } from "@/lib/grant-admin-core";

type FakeDB = {
  users: Array<{ id: string; email: string | null; role: "USER" | "ADMIN" }>;
  accounts: Array<{
    userId: string;
    provider: string;
    providerAccountId: string;
  }>;
};

function fakePrisma(db: FakeDB) {
  return {
    user: {
      findFirst: vi.fn(async ({ where }: { where: unknown }) => {
        const w = where as { email?: string; id?: string };
        if (w.email)
          return db.users.find((u) => u.email?.toLowerCase() === w.email?.toLowerCase()) ?? null;
        if (w.id) return db.users.find((u) => u.id === w.id) ?? null;
        return null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { role: "ADMIN" } }) => {
        const u = db.users.find((u) => u.id === where.id);
        if (!u) throw new Error("not found");
        u.role = data.role;
        return u;
      }),
    },
    account: {
      findFirst: vi.fn(async ({ where }: { where: { provider: string; providerAccountId: string } }) => {
        return (
          db.accounts.find(
            (a) =>
              a.provider === where.provider &&
              a.providerAccountId === where.providerAccountId,
          ) ?? null
        );
      }),
    },
  };
}

describe("grantAdminCore", () => {
  it("promotes by email", async () => {
    const db: FakeDB = {
      users: [{ id: "u1", email: "foo@bar.com", role: "USER" }],
      accounts: [],
    };
    const result = await grantAdminCore(fakePrisma(db) as never, {
      email: "foo@bar.com",
    });
    expect(result).toEqual({ ok: true, userId: "u1" });
    expect(db.users[0].role).toBe("ADMIN");
  });

  it("promotes by github id (via accounts)", async () => {
    const db: FakeDB = {
      users: [{ id: "u2", email: null, role: "USER" }],
      accounts: [
        { userId: "u2", provider: "github", providerAccountId: "98765" },
      ],
    };
    const result = await grantAdminCore(fakePrisma(db) as never, {
      github: "98765",
    });
    expect(result).toEqual({ ok: true, userId: "u2" });
    expect(db.users[0].role).toBe("ADMIN");
  });

  it("promotes by telegram id (via accounts)", async () => {
    const db: FakeDB = {
      users: [{ id: "u3", email: null, role: "USER" }],
      accounts: [
        { userId: "u3", provider: "telegram", providerAccountId: "42" },
      ],
    };
    const result = await grantAdminCore(fakePrisma(db) as never, {
      telegram: "42",
    });
    expect(result).toEqual({ ok: true, userId: "u3" });
    expect(db.users[0].role).toBe("ADMIN");
  });

  it("returns not_found when no match", async () => {
    const db: FakeDB = { users: [], accounts: [] };
    const result = await grantAdminCore(fakePrisma(db) as never, {
      email: "missing@x.com",
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("requires at least one identifier", async () => {
    const db: FakeDB = { users: [], accounts: [] };
    const result = await grantAdminCore(fakePrisma(db) as never, {});
    expect(result).toEqual({ ok: false, reason: "no_identifier" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/grant-admin.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the core function**

Create `src/lib/grant-admin-core.ts`:
```ts
import type { PrismaClient } from "@prisma/client";

export type GrantAdminInput = {
  email?: string;
  telegram?: string;
  github?: string;
};

export type GrantAdminResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "not_found" | "no_identifier" };

export async function grantAdminCore(
  prisma: PrismaClient,
  input: GrantAdminInput,
): Promise<GrantAdminResult> {
  const { email, telegram, github } = input;
  if (!email && !telegram && !github) {
    return { ok: false, reason: "no_identifier" };
  }

  let userId: string | null = null;

  if (email) {
    const u = await prisma.user.findFirst({ where: { email } });
    if (u) userId = u.id;
  }
  if (!userId && telegram) {
    const acc = await prisma.account.findFirst({
      where: { provider: "telegram", providerAccountId: telegram },
    });
    if (acc) userId = acc.userId;
  }
  if (!userId && github) {
    const acc = await prisma.account.findFirst({
      where: { provider: "github", providerAccountId: github },
    });
    if (acc) userId = acc.userId;
  }

  if (!userId) return { ok: false, reason: "not_found" };
  await prisma.user.update({
    where: { id: userId },
    data: { role: "ADMIN" },
  });
  return { ok: true, userId };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/grant-admin.test.ts
```
Expected: 5 PASS.

- [ ] **Step 5: Create the CLI script**

Create `scripts/grant-admin.ts`:
```ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "@/lib/prisma";
import { grantAdminCore } from "@/lib/grant-admin-core";

function parseArgs(argv: string[]): {
  email?: string;
  telegram?: string;
  github?: string;
} {
  const out: { email?: string; telegram?: string; github?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = argv[++i];
    else if (a === "--telegram") out.telegram = argv[++i];
    else if (a === "--github") out.github = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await grantAdminCore(prisma, args);
  if (result.ok) {
    console.log(`Granted ADMIN to user ${result.userId}`);
    process.exit(0);
  } else {
    console.error(`Failed: ${result.reason}`);
    console.error(
      "Usage: npm run grant-admin -- --email foo@bar.com\n" +
        "       npm run grant-admin -- --telegram 12345678\n" +
        "       npm run grant-admin -- --github 98765",
    );
    process.exit(1);
  }
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 6: Install tsx and dotenv, add npm script**

```bash
npm install -D tsx dotenv
```

Add to `package.json` `"scripts"`:
```json
"grant-admin": "tsx scripts/grant-admin.ts"
```

- [ ] **Step 7: Smoke-test the CLI**

```bash
npm run grant-admin -- --email nobody@example.com
```
Expected: `Failed: not_found` and exit 1.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(admin): grant-admin CLI script with tests"
```

---

## Task 12: Install next-intl and set up 10-locale routing

**Files:**
- Create: `src/i18n.ts`, `src/lib/locales.ts`, `messages/{en,ru,zh-CN,es,ja,ko,de,fr,pt-BR,tr}.json`
- Modify: `next.config.mjs`, `src/middleware.ts` (new file), `src/app/layout.tsx`, `src/app/page.tsx` (move to locale folder)

- [ ] **Step 1: Install next-intl**

```bash
npm install next-intl
```

- [ ] **Step 2: Define supported locales**

Create `src/lib/locales.ts`:
```ts
export const SUPPORTED_LOCALES = [
  "en",
  "ru",
  "zh-CN",
  "es",
  "ja",
  "ko",
  "de",
  "fr",
  "pt-BR",
  "tr",
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  "zh-CN": "中文",
  es: "Español",
  ja: "日本語",
  ko: "한국어",
  de: "Deutsch",
  fr: "Français",
  "pt-BR": "Português (BR)",
  tr: "Türkçe",
};
```

- [ ] **Step 3: Create the i18n request config**

Create `src/i18n.ts`:
```ts
import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) as Locale | undefined;
  if (!locale || !SUPPORTED_LOCALES.includes(locale)) notFound();
  const messages = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages };
});
```

- [ ] **Step 4: Create middleware combining next-intl + auth gating**

Create `src/middleware.ts`:
```ts
import createIntlMiddleware from "next-intl/middleware";
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@/lib/locales";

const intlMiddleware = createIntlMiddleware({
  locales: [...SUPPORTED_LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  return intlMiddleware(req);
});

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
```

- [ ] **Step 5: Update `next.config.mjs`**

Replace `next.config.mjs` with:
```js
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
```

- [ ] **Step 6: Move page tree under `[locale]`**

```bash
cd /Users/dmitry/Coinmarketcap
mkdir -p src/app/\[locale\]
git mv src/app/page.tsx 'src/app/[locale]/page.tsx'
```

- [ ] **Step 7: Create the locale-aware layout**

Create `src/app/[locale]/layout.tsx`:
```tsx
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale, getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(SUPPORTED_LOCALES, locale)) notFound();
  setRequestLocale(locale as Locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
```

- [ ] **Step 8: Update root layout to not hard-code `lang="en"`**

Edit `src/app/layout.tsx`, change the html line to:
```tsx
<html suppressHydrationWarning>
```
(next-intl will set `lang` via the locale layout's html attributes—actually, since root is shared, we set `lang` in the route segment. For Phase 1 this is acceptable. Phase 2 introduces per-locale `<html lang>` via a different approach if SEO requires.)

- [ ] **Step 9: Create base message files**

Create `messages/en.json`:
```json
{
  "common": {
    "appName": "Trientes",
    "tagline": "Top Layer-1 cryptocurrencies, ranked.",
    "signIn": "Sign in",
    "signOut": "Sign out",
    "settings": "Settings",
    "admin": "Admin",
    "watchlist": "Watchlist",
    "request": "Request a coin",
    "languageLabel": "Language",
    "currencyLabel": "Currency",
    "themeLabel": "Theme",
    "themeLight": "Light",
    "themeDark": "Dark",
    "themeSystem": "System"
  },
  "home": {
    "title": "Welcome",
    "comingSoon": "Coin listings coming in Phase 2."
  }
}
```

Create the same structure (same keys, translated values) for the remaining 9 locales. Translations for v1 can start as English and be refined later, but they MUST exist as separate files with identical key shapes so next-intl doesn't fall back loudly.

`messages/ru.json`:
```json
{
  "common": {
    "appName": "Trientes",
    "tagline": "Топ криптовалют Layer-1, по рангу.",
    "signIn": "Войти",
    "signOut": "Выйти",
    "settings": "Настройки",
    "admin": "Админ",
    "watchlist": "Избранное",
    "request": "Предложить монету",
    "languageLabel": "Язык",
    "currencyLabel": "Валюта",
    "themeLabel": "Тема",
    "themeLight": "Светлая",
    "themeDark": "Тёмная",
    "themeSystem": "Системная"
  },
  "home": {
    "title": "Добро пожаловать",
    "comingSoon": "Список монет — в Phase 2."
  }
}
```

For the remaining 8 (`zh-CN`, `es`, `ja`, `ko`, `de`, `fr`, `pt-BR`, `tr`), create files with the same JSON shape. Translate `appName` (keep "Trientes"), `tagline`, `signIn`, `signOut`, `settings`, `admin`, `watchlist`, `request`, `languageLabel`, `currencyLabel`, `themeLabel`, `themeLight`, `themeDark`, `themeSystem`, `title`, `comingSoon` into the target language. If a translation is uncertain, fall back to English text but keep the JSON key. (Crowdin/translation pass is Phase 7 fit-and-finish.)

Concrete starter for the other 8:

`messages/zh-CN.json`:
```json
{
  "common": {
    "appName": "Trientes",
    "tagline": "Layer-1 加密货币排行榜。",
    "signIn": "登录",
    "signOut": "退出",
    "settings": "设置",
    "admin": "管理员",
    "watchlist": "收藏",
    "request": "申请添加币种",
    "languageLabel": "语言",
    "currencyLabel": "货币",
    "themeLabel": "主题",
    "themeLight": "亮色",
    "themeDark": "深色",
    "themeSystem": "系统"
  },
  "home": { "title": "欢迎", "comingSoon": "币种列表将在第二阶段上线。" }
}
```

`messages/es.json`:
```json
{
  "common": {
    "appName": "Trientes",
    "tagline": "Las principales criptomonedas Layer-1, clasificadas.",
    "signIn": "Iniciar sesión",
    "signOut": "Cerrar sesión",
    "settings": "Ajustes",
    "admin": "Admin",
    "watchlist": "Favoritos",
    "request": "Solicitar moneda",
    "languageLabel": "Idioma",
    "currencyLabel": "Moneda",
    "themeLabel": "Tema",
    "themeLight": "Claro",
    "themeDark": "Oscuro",
    "themeSystem": "Sistema"
  },
  "home": { "title": "Bienvenido", "comingSoon": "Listado de monedas en la Fase 2." }
}
```

`messages/ja.json`:
```json
{
  "common": {
    "appName": "Trientes",
    "tagline": "レイヤー1暗号資産のトップランキング。",
    "signIn": "ログイン",
    "signOut": "ログアウト",
    "settings": "設定",
    "admin": "管理",
    "watchlist": "お気に入り",
    "request": "コインをリクエスト",
    "languageLabel": "言語",
    "currencyLabel": "通貨",
    "themeLabel": "テーマ",
    "themeLight": "ライト",
    "themeDark": "ダーク",
    "themeSystem": "システム"
  },
  "home": { "title": "ようこそ", "comingSoon": "コイン一覧はフェーズ2で公開。" }
}
```

`messages/ko.json`:
```json
{
  "common": {
    "appName": "Trientes",
    "tagline": "레이어-1 암호화폐 순위.",
    "signIn": "로그인",
    "signOut": "로그아웃",
    "settings": "설정",
    "admin": "관리자",
    "watchlist": "관심목록",
    "request": "코인 요청",
    "languageLabel": "언어",
    "currencyLabel": "통화",
    "themeLabel": "테마",
    "themeLight": "라이트",
    "themeDark": "다크",
    "themeSystem": "시스템"
  },
  "home": { "title": "환영합니다", "comingSoon": "코인 목록은 2단계에 공개." }
}
```

`messages/de.json`:
```json
{
  "common": {
    "appName": "Trientes",
    "tagline": "Die Top Layer-1-Kryptowährungen, sortiert.",
    "signIn": "Anmelden",
    "signOut": "Abmelden",
    "settings": "Einstellungen",
    "admin": "Admin",
    "watchlist": "Watchlist",
    "request": "Coin vorschlagen",
    "languageLabel": "Sprache",
    "currencyLabel": "Währung",
    "themeLabel": "Design",
    "themeLight": "Hell",
    "themeDark": "Dunkel",
    "themeSystem": "System"
  },
  "home": { "title": "Willkommen", "comingSoon": "Coin-Liste in Phase 2." }
}
```

`messages/fr.json`:
```json
{
  "common": {
    "appName": "Trientes",
    "tagline": "Les meilleures cryptomonnaies Layer-1, classées.",
    "signIn": "Se connecter",
    "signOut": "Se déconnecter",
    "settings": "Paramètres",
    "admin": "Admin",
    "watchlist": "Favoris",
    "request": "Proposer une monnaie",
    "languageLabel": "Langue",
    "currencyLabel": "Devise",
    "themeLabel": "Thème",
    "themeLight": "Clair",
    "themeDark": "Sombre",
    "themeSystem": "Système"
  },
  "home": { "title": "Bienvenue", "comingSoon": "Liste des monnaies en phase 2." }
}
```

`messages/pt-BR.json`:
```json
{
  "common": {
    "appName": "Trientes",
    "tagline": "As principais criptomoedas Layer-1, classificadas.",
    "signIn": "Entrar",
    "signOut": "Sair",
    "settings": "Configurações",
    "admin": "Admin",
    "watchlist": "Favoritos",
    "request": "Solicitar moeda",
    "languageLabel": "Idioma",
    "currencyLabel": "Moeda",
    "themeLabel": "Tema",
    "themeLight": "Claro",
    "themeDark": "Escuro",
    "themeSystem": "Sistema"
  },
  "home": { "title": "Bem-vindo", "comingSoon": "Listagem de moedas na Fase 2." }
}
```

`messages/tr.json`:
```json
{
  "common": {
    "appName": "Trientes",
    "tagline": "En iyi Layer-1 kripto paralar, sıralı.",
    "signIn": "Giriş yap",
    "signOut": "Çıkış yap",
    "settings": "Ayarlar",
    "admin": "Yönetici",
    "watchlist": "İzleme listesi",
    "request": "Coin öner",
    "languageLabel": "Dil",
    "currencyLabel": "Para birimi",
    "themeLabel": "Tema",
    "themeLight": "Açık",
    "themeDark": "Koyu",
    "themeSystem": "Sistem"
  },
  "home": { "title": "Hoş geldiniz", "comingSoon": "Coin listesi 2. Aşama'da." }
}
```

- [ ] **Step 10: Update the `[locale]/page.tsx` to use translations**

Replace `src/app/[locale]/page.tsx` with:
```tsx
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HomeContent />;
}

function HomeContent() {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-4xl font-bold">{tc("appName")}</h1>
      <p className="text-muted-foreground mt-2">{tc("tagline")}</p>
      <div className="mt-12">
        <h2 className="text-2xl font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground mt-2">{t("comingSoon")}</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 11: Verify dev server renders all locales**

```bash
npm run dev &
DEV_PID=$!
sleep 5
for L in en ru zh-CN es ja ko de fr pt-BR tr; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/$L")
  echo "$L → $CODE"
done
kill $DEV_PID
```
Expected: all 10 print `200`.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(i18n): next-intl with 10 locales and locale-aware layout"
```

---

## Task 13: Locale and theme switcher components

**Files:**
- Create: `src/components/locale-switcher.tsx`, `src/components/theme-toggle.tsx`, `src/components/navbar.tsx`, `src/components/footer.tsx`
- Modify: `src/app/[locale]/layout.tsx`

- [ ] **Step 1: Locale switcher**

Create `src/components/locale-switcher.tsx`:
```tsx
"use client";

import { useLocale, useTranslations } from "next-intl";
import { useParams, usePathname, useRouter } from "next/navigation";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/lib/locales";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const t = useTranslations("common");

  const setLocale = (next: string) => {
    const segments = pathname.split("/");
    segments[1] = next; // /<locale>/...
    router.push(segments.join("/"));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("languageLabel")}>
          {LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] ?? locale}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {SUPPORTED_LOCALES.map((l) => (
          <DropdownMenuItem key={l} onClick={() => setLocale(l)}>
            {LOCALE_LABELS[l]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Theme toggle**

Create `src/components/theme-toggle.tsx`:
```tsx
"use client";

import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { setTheme } = useTheme();
  const t = useTranslations("common");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("themeLabel")}>
          {t("themeLabel")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => setTheme("light")}>
          {t("themeLight")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          {t("themeDark")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          {t("themeSystem")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Navbar with sign-in/out**

Create `src/components/navbar.tsx`:
```tsx
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { auth, signIn, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";

export async function Navbar() {
  const session = await auth();
  const locale = await getLocale();
  const t = await getTranslations("common");
  const isAdmin =
    (session?.user as { role?: string } | undefined)?.role === "ADMIN";

  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-3 flex items-center gap-4">
        <Link href={`/${locale}`} className="font-bold text-lg">
          {t("appName")}
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href={`/${locale}/watchlist`}>{t("watchlist")}</Link>
          <Link href={`/${locale}/request`}>{t("request")}</Link>
          {isAdmin && <Link href={`/${locale}/admin`}>{t("admin")}</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
          {session?.user ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: `/${locale}` });
              }}
            >
              <Button variant="ghost" size="sm" type="submit">
                {t("signOut")}
              </Button>
            </form>
          ) : (
            <Button asChild size="sm">
              <Link href={`/${locale}/login`}>{t("signIn")}</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Footer**

Create `src/components/footer.tsx`:
```tsx
import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("common");
  return (
    <footer className="border-t mt-12">
      <div className="container mx-auto px-4 py-6 text-sm text-muted-foreground">
        © {new Date().getFullYear()} {t("appName")}
      </div>
    </footer>
  );
}
```

- [ ] **Step 5: Mount navbar + footer in locale layout**

Replace `src/app/[locale]/layout.tsx` with:
```tsx
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale, getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(SUPPORTED_LOCALES, locale)) notFound();
  setRequestLocale(locale as Locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1">{children}</div>
        <Footer />
      </div>
    </NextIntlClientProvider>
  );
}
```

- [ ] **Step 6: Verify dev server**

```bash
npm run dev &
DEV_PID=$!
sleep 5
curl -s http://localhost:3000/en | grep -E "(Trientes|Sign in)" | head -3
kill $DEV_PID
```
Expected: matches found.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): navbar + footer + locale/theme switchers"
```

---

## Task 14: Login page with provider buttons

**Files:**
- Create: `src/app/[locale]/login/page.tsx`, `src/components/login-buttons.tsx`

- [ ] **Step 1: Login page (server component)**

Create `src/app/[locale]/login/page.tsx`:
```tsx
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { LoginButtons } from "@/components/login-buttons";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  return (
    <main className="container mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-bold mb-8">{t("signIn")}</h1>
      <LoginButtons />
    </main>
  );
}
```

- [ ] **Step 2: Login buttons (client component, uses server actions)**

Create `src/components/login-buttons.tsx`:
```tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signInWithProvider } from "@/app/actions/auth";

export function LoginButtons() {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Button
        disabled={pending}
        onClick={() => start(() => signInWithProvider("google"))}
      >
        Continue with Google
      </Button>
      <Button
        disabled={pending}
        onClick={() => start(() => signInWithProvider("github"))}
      >
        Continue with GitHub
      </Button>
      <div className="mt-4 border rounded p-4">
        <p className="text-sm text-muted-foreground mb-2">
          Telegram login widget will mount here once TELEGRAM_BOT_USERNAME is set.
          For Phase 1 the widget script is wired in Task 15.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Server action for sign-in**

Create `src/app/actions/auth.ts`:
```ts
"use server";

import { signIn } from "@/auth";

export async function signInWithProvider(provider: "google" | "github") {
  await signIn(provider, { redirectTo: "/" });
}
```

- [ ] **Step 4: Verify the page renders**

```bash
npm run dev &
DEV_PID=$!
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/en/login
kill $DEV_PID
```
Expected: `200`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): login page with Google/GitHub buttons"
```

---

## Task 15: Telegram Login Widget integration

**Files:**
- Create: `src/components/telegram-login.tsx`, `src/app/api/auth/telegram/callback/route.ts`
- Modify: `src/components/login-buttons.tsx`

- [ ] **Step 1: Telegram widget mount component**

Create `src/components/telegram-login.tsx`:
```tsx
"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, string | number>) => void;
  }
}

export function TelegramLogin({ botUsername }: { botUsername: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", botUsername);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-userpic", "true");
    s.setAttribute("data-onauth", "onTelegramAuth(user)");
    s.setAttribute("data-request-access", "write");
    ref.current.appendChild(s);

    window.onTelegramAuth = async (user) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(user)) form.append(k, String(v));
      const resp = await fetch("/api/auth/telegram/callback", {
        method: "POST",
        body: form,
      });
      if (resp.ok) window.location.href = resp.headers.get("Location") ?? "/";
    };
    return () => {
      window.onTelegramAuth = undefined;
    };
  }, [botUsername]);

  return <div ref={ref} />;
}
```

- [ ] **Step 2: Telegram callback route — verifies HMAC and calls signIn**

Create `src/app/api/auth/telegram/callback/route.ts`:
```ts
import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import { verifyTelegramAuth } from "@/lib/telegram-auth";

export async function POST(req: Request) {
  const formData = await req.formData();
  const payload: Record<string, string> = {};
  for (const [k, v] of formData.entries()) payload[k] = String(v);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "telegram_not_configured" }, { status: 503 });
  }
  const result = verifyTelegramAuth(payload, token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  // Auth.js Credentials provider expects to be called server-side via signIn.
  await signIn("telegram", {
    redirect: false,
    ...payload,
  });

  return NextResponse.redirect(new URL("/", req.url));
}
```

- [ ] **Step 3: Mount Telegram widget in login buttons**

Replace `src/components/login-buttons.tsx`:
```tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signInWithProvider } from "@/app/actions/auth";
import { TelegramLogin } from "@/components/telegram-login";

export function LoginButtons({ telegramBotUsername }: { telegramBotUsername?: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Button
        disabled={pending}
        onClick={() => start(() => signInWithProvider("google"))}
      >
        Continue with Google
      </Button>
      <Button
        disabled={pending}
        onClick={() => start(() => signInWithProvider("github"))}
      >
        Continue with GitHub
      </Button>
      {telegramBotUsername ? (
        <div className="flex justify-center pt-2">
          <TelegramLogin botUsername={telegramBotUsername} />
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Pass bot username from server to login page**

Edit `src/app/[locale]/login/page.tsx`, replace `<LoginButtons />` with:
```tsx
<LoginButtons telegramBotUsername={process.env.TELEGRAM_BOT_USERNAME} />
```

- [ ] **Step 5: Verify build still works**

```bash
npm run build
```
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): Telegram Login Widget integration"
```

---

## Task 16: Settings page (preferred locale/currency/theme)

**Files:**
- Create: `src/app/[locale]/settings/page.tsx`, `src/components/settings-form.tsx`, `src/app/actions/settings.ts`

- [ ] **Step 1: Server action to update preferences**

Create `src/app/actions/settings.ts`:
```ts
"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

const ALLOWED_CURRENCIES = ["USD", "EUR", "RUB", "GBP", "JPY", "CNY", "BTC", "ETH"];
const ALLOWED_THEMES = ["light", "dark", "system"];

export async function updatePreferences(input: {
  locale?: string;
  currency?: string;
  theme?: string;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" as const };

  const data: { preferredLocale?: string; preferredCurrency?: string; preferredTheme?: string } = {};
  if (input.locale) data.preferredLocale = input.locale;
  if (input.currency && ALLOWED_CURRENCIES.includes(input.currency))
    data.preferredCurrency = input.currency;
  if (input.theme && ALLOWED_THEMES.includes(input.theme))
    data.preferredTheme = input.theme;
  if (Object.keys(data).length === 0) return { ok: false, reason: "no_change" as const };
  await prisma.user.update({ where: { id: userId }, data });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
```

- [ ] **Step 2: Settings form component**

Create `src/components/settings-form.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { updatePreferences } from "@/app/actions/settings";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/lib/locales";

const CURRENCIES = ["USD", "EUR", "RUB", "GBP", "JPY", "CNY", "BTC", "ETH"];
const THEMES = ["light", "dark", "system"];

export function SettingsForm(props: {
  initialLocale: string;
  initialCurrency: string;
  initialTheme: string;
}) {
  const [locale, setLocale] = useState(props.initialLocale);
  const [currency, setCurrency] = useState(props.initialCurrency);
  const [theme, setTheme] = useState(props.initialTheme);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await updatePreferences({ locale, currency, theme });
          router.refresh();
        });
      }}
    >
      <div>
        <Label>Language</Label>
        <select
          className="border rounded p-2 w-full"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>Currency</Label>
        <select
          className="border rounded p-2 w-full"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>Theme</Label>
        <select
          className="border rounded p-2 w-full"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
        >
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <Button disabled={pending} type="submit">
        Save
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Settings page (auth-gated)**

Create `src/app/[locale]/settings/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SettingsForm } from "@/components/settings-form";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect(`/${locale}/login`);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect(`/${locale}/login`);

  return (
    <main className="container mx-auto max-w-lg px-4 py-12">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>
      <SettingsForm
        initialLocale={user.preferredLocale}
        initialCurrency={user.preferredCurrency}
        initialTheme={user.preferredTheme}
      />
    </main>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(settings): user preferences page (locale/currency/theme)"
```

---

## Task 17: Admin placeholder page (route gating verification)

**Files:**
- Create: `src/app/[locale]/admin/page.tsx`, `src/app/[locale]/watchlist/page.tsx`, `src/app/[locale]/request/page.tsx`

- [ ] **Step 1: Admin placeholder**

Create `src/app/[locale]/admin/page.tsx`:
```tsx
import { setRequestLocale } from "next-intl/server";

export default async function AdminHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold">Admin</h1>
      <p className="text-muted-foreground mt-2">
        Full admin panel arrives in Phase 6 (coins, requests, users).
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Watchlist placeholder**

Create `src/app/[locale]/watchlist/page.tsx`:
```tsx
import { setRequestLocale } from "next-intl/server";

export default async function WatchlistPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold">Watchlist</h1>
      <p className="text-muted-foreground mt-2">Phase 5.</p>
    </main>
  );
}
```

- [ ] **Step 3: Request placeholder**

Create `src/app/[locale]/request/page.tsx`:
```tsx
import { setRequestLocale } from "next-intl/server";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold">Request a coin</h1>
      <p className="text-muted-foreground mt-2">Phase 5.</p>
    </main>
  );
}
```

- [ ] **Step 4: Verify gating works**

The middleware in `src/middleware.ts` uses `authConfig.callbacks.authorized` which blocks `/<locale>/admin/*` unless role=ADMIN and `/<locale>/{watchlist,request,settings}/*` unless authenticated.

```bash
npm run dev &
DEV_PID=$!
sleep 5
echo "anon /en/admin:"
curl -s -o /dev/null -w "%{http_code}\n" -L http://localhost:3000/en/admin
echo "anon /en/watchlist:"
curl -s -o /dev/null -w "%{http_code}\n" -L http://localhost:3000/en/watchlist
echo "anon /en (public):"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/en
kill $DEV_PID
```
Expected: `/en/admin` and `/en/watchlist` get redirected (final 200 after redirect to `/en/login` is fine — what matters is that the unauth user can't see admin/watchlist content). The home page `/en` is `200` directly.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(routes): placeholder pages for admin/watchlist/request"
```

---

## Task 18: Redis client + `/api/health` endpoint

**Files:**
- Create: `src/lib/redis.ts`, `src/app/api/health/route.ts`

- [ ] **Step 1: Install ioredis**

```bash
npm install ioredis
```

- [ ] **Step 2: Redis singleton**

Create `src/lib/redis.ts`:
```ts
import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
```

- [ ] **Step 3: Health route**

Create `src/app/api/health/route.ts`:
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const results: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    results.db = { ok: true, latencyMs: Date.now() - dbStart };
  } catch (e) {
    results.db = { ok: false, error: String(e) };
  }

  const redisStart = Date.now();
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const pong = await redis.ping();
    results.redis = { ok: pong === "PONG", latencyMs: Date.now() - redisStart };
  } catch (e) {
    results.redis = { ok: false, error: String(e) };
  }

  const allOk = Object.values(results).every((r) => r.ok);
  return NextResponse.json(
    { ok: allOk, checks: results, timestamp: new Date().toISOString() },
    { status: allOk ? 200 : 503 },
  );
}
```

- [ ] **Step 4: Verify health endpoint**

```bash
# Ensure local redis is running. On Mac:
brew services start redis 2>/dev/null || true
npm run dev &
DEV_PID=$!
sleep 5
curl -s http://localhost:3000/api/health | tee /dev/stderr | python3 -m json.tool
kill $DEV_PID
```
Expected: JSON with `"ok": true`, both `db` and `redis` healthy. If `redis` fails locally — install/start it (`brew install redis && brew services start redis`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(health): /api/health with DB + Redis checks"
```

---

## Task 19: Worker stub (so PM2 can manage it)

**Files:**
- Create: `worker/index.ts`, `worker/tsconfig.json`
- Modify: `package.json` (worker script)

- [ ] **Step 1: Worker entrypoint**

Create `worker/index.ts`:
```ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";

async function main() {
  console.log("[worker] starting…");
  // Smoke connections.
  await prisma.$queryRaw`SELECT 1`;
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
  await redis.ping();
  console.log("[worker] connections ok. Phase 1 stub running, no jobs scheduled yet.");

  // Keep process alive so PM2 doesn't restart-loop us.
  const tick = setInterval(() => {
    console.log(`[worker] alive ${new Date().toISOString()}`);
  }, 60_000);

  const shutdown = async (sig: string) => {
    console.log(`[worker] received ${sig}, shutting down`);
    clearInterval(tick);
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

- [ ] **Step 2: Worker tsconfig**

Create `worker/tsconfig.json`:
```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "module": "esnext",
    "moduleResolution": "bundler"
  },
  "include": ["./**/*.ts", "../src/**/*.ts"]
}
```

- [ ] **Step 3: Add npm scripts**

In `package.json` `"scripts"`:
```json
"worker:dev": "tsx watch worker/index.ts",
"worker:start": "tsx worker/index.ts"
```

- [ ] **Step 4: Smoke run**

```bash
timeout 3 npm run worker:start || true
```
Expected: prints `[worker] starting…` and `[worker] connections ok.` then is killed by timeout (exit code 124 is fine).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(worker): phase-1 stub that holds connections and prints heartbeats"
```

---

## Task 20: PM2 ecosystem file

**Files:**
- Create: `ecosystem.config.js`

- [ ] **Step 1: Create the ecosystem file**

Create `ecosystem.config.js`:
```js
module.exports = {
  apps: [
    {
      name: "trientes-web",
      cwd: "/home/dv/trientes",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      env: { NODE_ENV: "production" },
      max_memory_restart: "768M",
      out_file: "/home/dv/logs/trientes-web.out.log",
      error_file: "/home/dv/logs/trientes-web.err.log",
      time: true,
    },
    {
      name: "trientes-worker",
      cwd: "/home/dv/trientes",
      script: "node_modules/.bin/tsx",
      args: "worker/index.ts",
      env: { NODE_ENV: "production" },
      max_memory_restart: "512M",
      out_file: "/home/dv/logs/trientes-worker.out.log",
      error_file: "/home/dv/logs/trientes-worker.err.log",
      time: true,
    },
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add ecosystem.config.js
git commit -m "chore(deploy): PM2 ecosystem with web + worker apps"
```

---

## Task 21: Init GitHub repo and push

**Files:** none new; pushes existing local repo to GitHub.

- [ ] **Step 1: Confirm `gh` CLI is logged in**

```bash
gh auth status
```
Expected: shows logged-in user (`dvvolkovv`).

- [ ] **Step 2: Create private repo and push**

```bash
cd /Users/dmitry/Coinmarketcap
gh repo create dvvolkovv/trientes --private --source=. --remote=origin --description "Top Layer-1 cryptocurrencies, trientes.org" --push
```
Expected: repo created, branch pushed. URL printed.

- [ ] **Step 3: Verify**

```bash
git remote -v
gh repo view --json url
```
Expected: `origin` points to `github.com:dvvolkovv/trientes.git`.

- [ ] **Step 4: No commit — remote configuration only**

---

## Task 22: Server-side clone + first deploy (HTTP, no SSL yet)

**Files:** server-only (deploys existing repo).

- [ ] **Step 1: Set up an SSH deploy key on the server**

```bash
ssh dv@85.192.25.242 'ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -q <<< y >/dev/null; cat ~/.ssh/id_ed25519.pub'
```
Copy the printed `ssh-ed25519 ... dv@coinmarketcap...` line.

- [ ] **Step 2: Add the deploy key to the GitHub repo**

```bash
PUB=$(ssh dv@85.192.25.242 'cat ~/.ssh/id_ed25519.pub')
echo "$PUB" | gh repo deploy-key add - --repo dvvolkovv/trientes --title "trientes-server" --allow-write=false
```
Expected: `Deploy key added`.

- [ ] **Step 3: Clone the repo on the server**

```bash
ssh dv@85.192.25.242 'mkdir -p ~/logs && cd ~ && git clone git@github.com:dvvolkovv/trientes.git -o origin trientes && cd trientes && ls package.json'
```
Expected: `package.json` listed.

- [ ] **Step 4: Create server `.env`**

Compose locally (replace placeholders), then upload:
```bash
DB_PASS_FROM_TASK2="<paste-the-DB_PASS-from-Task-2-step-1>"
NEXTAUTH_SECRET=$(openssl rand -base64 32)
cat > /tmp/trientes.env <<EOF
DATABASE_URL=postgresql://trientes:${DB_PASS_FROM_TASK2}@127.0.0.1:5432/trientes
REDIS_URL=redis://127.0.0.1:6379
NEXTAUTH_URL=http://85.192.25.242
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
ADMIN_WHITELIST=email:dvvolkovv@gmail.com
EOF
scp /tmp/trientes.env dv@85.192.25.242:~/trientes/.env
rm /tmp/trientes.env
```

(OAuth client IDs/secrets are filled in once you register apps in Google Cloud Console, GitHub Developer Settings, and BotFather. That registration is documented in the README — Task 25 — and the deployment will still build and serve the public pages without them. Sign-in flow obviously won't work until they're set.)

- [ ] **Step 5: Install + build on the server**

```bash
ssh dv@85.192.25.242 'cd ~/trientes && npm ci && npx prisma migrate deploy && npm run build'
```
Expected: builds without errors. `npx prisma migrate deploy` applies the `init` migration to the prod DB.

- [ ] **Step 6: Start under PM2 and save process list**

```bash
ssh dv@85.192.25.242 'cd ~/trientes && pm2 start ecosystem.config.js && pm2 save && pm2 status'
```
Expected: both `trientes-web` and `trientes-worker` show `online`.

- [ ] **Step 7: Verify the app responds on port 3000**

```bash
ssh dv@85.192.25.242 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/en'
```
Expected: `200`.

- [ ] **Step 8: No commit — deployment is captured by the existing PM2 ecosystem file**

---

## Task 23: Nginx vhost (HTTP, no SSL yet — domain not configured)

**Files:** server-side `/etc/nginx/sites-available/trientes` (kept as a reference in the repo too).

- [ ] **Step 1: Add an nginx config to the repo for reference**

Create `deploy/nginx/trientes.conf`:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name 85.192.25.242 trientes.org www.trientes.org;

    client_max_body_size 10M;

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

- [ ] **Step 2: Deploy the nginx config**

```bash
scp deploy/nginx/trientes.conf dv@85.192.25.242:/tmp/trientes.conf
ssh dv@85.192.25.242 'sudo mv /tmp/trientes.conf /etc/nginx/sites-available/trientes && sudo ln -sf /etc/nginx/sites-available/trientes /etc/nginx/sites-enabled/trientes && sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx'
```
Expected: `nginx: configuration file ... test is successful` and reload completes.

- [ ] **Step 3: Verify the site is reachable via IP**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://85.192.25.242/en
```
Expected: `200`. The redirect from `/` to `/en` should also work — try `curl -sL -o /dev/null -w "%{http_code}\n" http://85.192.25.242`.

- [ ] **Step 4: Commit**

```bash
cd /Users/dmitry/Coinmarketcap
git add deploy/nginx/trientes.conf
git commit -m "chore(deploy): nginx vhost config for trientes.org"
```

---

## Task 24: Daily Postgres backup cron

**Files:**
- Create: `deploy/backup/pg-backup.sh` (deployed to server)

- [ ] **Step 1: Backup script**

Create `deploy/backup/pg-backup.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/dv/backups/pg}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_NAME="${DB_NAME:-trientes}"
DB_USER="${DB_USER:-trientes}"
DB_HOST="${DB_HOST:-127.0.0.1}"

mkdir -p "$BACKUP_DIR"
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$BACKUP_DIR/${DB_NAME}-${TS}.sql.gz"

# Use ~/.pgpass for credentials (mode 600):
# host:port:db:user:password
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
  | gzip -9 > "$FILE"

find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete

echo "[$(date -uIs)] backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
```

- [ ] **Step 2: Deploy the script and set up `.pgpass`**

```bash
scp deploy/backup/pg-backup.sh dv@85.192.25.242:~/pg-backup.sh
DB_PASS_FROM_TASK2="<paste-DB_PASS>"
ssh dv@85.192.25.242 "chmod +x ~/pg-backup.sh && echo '127.0.0.1:5432:trientes:trientes:${DB_PASS_FROM_TASK2}' > ~/.pgpass && chmod 600 ~/.pgpass"
```

- [ ] **Step 3: Smoke-test the backup**

```bash
ssh dv@85.192.25.242 '~/pg-backup.sh && ls -lh ~/backups/pg/'
```
Expected: a `.sql.gz` file is listed.

- [ ] **Step 4: Schedule via cron**

```bash
ssh dv@85.192.25.242 '(crontab -l 2>/dev/null | grep -v "pg-backup.sh"; echo "30 3 * * * /home/dv/pg-backup.sh >> /home/dv/logs/pg-backup.log 2>&1") | crontab -'
ssh dv@85.192.25.242 'crontab -l'
```
Expected: cron line present.

- [ ] **Step 5: Commit**

```bash
git add deploy/backup/pg-backup.sh
git commit -m "chore(backup): daily Postgres dump with 14-day retention"
```

---

## Task 25: README with dev + deploy instructions

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

Create `README.md`:
````markdown
# Trientes

Top Layer-1 cryptocurrencies, ranked. Hosted at https://trientes.org.

Phase 1 (this commit): scaffold — Next.js 15 + Postgres + Redis + Auth.js with
Google/GitHub/Telegram, 10 locales, light/dark themes. No coin data yet (Phase 2).

## Local dev

Requirements: Node 22, PostgreSQL 16, Redis 7 (Mac: `brew install postgresql@16 redis && brew services start postgresql@16 redis`).

```bash
git clone git@github.com:dvvolkovv/trientes.git
cd trientes
npm install
cp .env.example .env.local       # fill values; see below
createdb trientes_dev
npx prisma migrate dev
npm run dev                       # http://localhost:3000
npm run worker:dev                # separate terminal, optional in Phase 1
```

### Required env vars

See `.env.example`. For dev you need at minimum `DATABASE_URL`, `REDIS_URL`,
`NEXTAUTH_URL`, `NEXTAUTH_SECRET`. OAuth credentials are needed to actually
sign in:

- **Google:** Cloud Console → APIs & Services → Credentials → Create OAuth 2.0
  Client ID (Web application). Authorized redirect URI:
  `http://localhost:3000/api/auth/callback/google`
  (prod: `https://trientes.org/api/auth/callback/google`).
- **GitHub:** Settings → Developer settings → OAuth Apps → New OAuth App.
  Callback URL: `http://localhost:3000/api/auth/callback/github`
  (prod: `https://trientes.org/api/auth/callback/github`).
- **Telegram:** Talk to `@BotFather`, create a bot, get token. Set domain via
  `/setdomain` to `localhost` (dev) / `trientes.org` (prod). Put bot token in
  `TELEGRAM_BOT_TOKEN`, bot username in `TELEGRAM_BOT_USERNAME`.

### Grant admin role

```bash
npm run grant-admin -- --email you@example.com
# or
npm run grant-admin -- --telegram 123456789
# or
npm run grant-admin -- --github octocat   # numeric GitHub id, not username
```

You can also set `ADMIN_WHITELIST` in `.env.local` — matching identities are
promoted automatically on sign-in.

## Tests

```bash
npm test           # vitest run
npm run test:watch # vitest --watch
```

## Build

```bash
npm run build
```

## Deploy (manual, no CI)

Server: `dv@85.192.25.242` (Ubuntu 26.04). User has passwordless SSH from this
Mac and NOPASSWD sudo. Repo lives at `~/trientes`, env at `~/trientes/.env`.

```bash
ssh dv@85.192.25.242 'cd ~/trientes && git pull && npm ci && \
  npx prisma migrate deploy && npm run build && \
  pm2 restart trientes-web trientes-worker'
```

### One-time server setup

Done already in Task 1 of the Phase 1 plan
(`docs/superpowers/plans/2026-05-19-trientes-phase1-scaffold.md`):

- Node 22, PostgreSQL 16, Redis 7, Nginx, certbot, PM2 installed
- `trientes` DB + role created
- `ufw` allows 22/80/443
- PM2 startup unit registered for user `dv`
- Nginx vhost at `/etc/nginx/sites-available/trientes`
- Daily `pg_dump` cron at 03:30 UTC, 14-day retention

### DNS (IONOS panel — manual)

When ready to switch the domain:

- `A trientes.org → 85.192.25.242`
- `A www.trientes.org → 85.192.25.242`

Then on the server:

```bash
ssh dv@85.192.25.242 'sudo certbot --nginx -d trientes.org -d www.trientes.org --redirect --agree-tos -m dvvolkovv@gmail.com -n'
```

After SSL is provisioned, update `.env`:

```
NEXTAUTH_URL=https://trientes.org
```

Then `pm2 restart trientes-web`.

## Architecture & spec

See `docs/superpowers/specs/2026-05-19-trientes-cmc-clone-design.md` for the
full design.

## Phases

- [x] Phase 1 — Scaffold (this commit)
- [ ] Phase 2 — Sync worker (CoinGecko → Postgres + Redis)
- [ ] Phase 3 — Public listing
- [ ] Phase 4 — Coin detail page + charts
- [ ] Phase 5 — Watchlist + coin requests
- [ ] Phase 6 — Admin panel
- [ ] Phase 7 — Global stats + exchanges
- [ ] Phase 8 — DNS, SSL, polish
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with dev + deploy instructions"
```

- [ ] **Step 3: Push to GitHub**

```bash
git push origin main
```
Expected: push succeeds.

---

## Task 26: Final smoke test — full flow

**Files:** none new.

- [ ] **Step 1: Server-side smoke test of all locales**

```bash
for L in en ru zh-CN es ja ko de fr pt-BR tr; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://85.192.25.242/$L")
  echo "$L → $CODE"
done
```
Expected: all 10 return `200`.

- [ ] **Step 2: Health check from public**

```bash
curl -s http://85.192.25.242/api/health | python3 -m json.tool
```
Expected: `"ok": true` with `db` and `redis` both healthy.

- [ ] **Step 3: Verify PM2 status**

```bash
ssh dv@85.192.25.242 'pm2 status'
```
Expected: `trientes-web` and `trientes-worker` both online, restarts=0.

- [ ] **Step 4: Verify backup cron is scheduled**

```bash
ssh dv@85.192.25.242 'crontab -l | grep pg-backup'
```
Expected: cron line present.

- [ ] **Step 5: Verify auth gating from public (anon)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://85.192.25.242/en/settings
curl -s -o /dev/null -w "%{http_code}\n" http://85.192.25.242/en/admin
curl -s -o /dev/null -w "%{http_code}\n" http://85.192.25.242/en/watchlist
```
Expected: each returns a redirect/200 chain ending on the login page — the
important thing is none of the protected pages renders their content for an
anonymous request. (Visual confirmation: open in a browser and verify you
land on `/en/login` for each.)

- [ ] **Step 6: Phase 1 complete — note in commit log**

```bash
git commit --allow-empty -m "milestone: Phase 1 scaffold complete"
git push origin main
```

---

## Phase 1 acceptance criteria

- [ ] Server `85.192.25.242` runs `trientes-web` and `trientes-worker` under PM2
- [ ] All 10 locale homepages return 200
- [ ] `/api/health` reports both DB and Redis healthy
- [ ] OAuth login wired (Google + GitHub + Telegram) — works once provider apps are registered
- [ ] `ADMIN_WHITELIST` promotes matching identities on sign-in
- [ ] `npm run grant-admin` CLI promotes a user by email / telegram id / github id
- [ ] Light/dark/system theme toggle works and persists across reloads
- [ ] Locale switcher works and persists across reloads for authenticated users (preferred locale in DB)
- [ ] `/admin`, `/watchlist`, `/request`, `/settings` are gated correctly
- [ ] `npm test` passes (admin-whitelist + telegram-auth + grant-admin)
- [ ] Daily Postgres backup cron is scheduled and produced at least one `.sql.gz`
- [ ] `README.md` documents dev + deploy + OAuth setup

When all checkboxes are ticked, Phase 1 is done. Phase 2 (sync worker) gets its
own plan.
