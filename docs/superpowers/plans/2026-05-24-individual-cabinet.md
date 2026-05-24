# Individual Cabinet (Slice 4а) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let INDIVIDUAL users register with username + password, manage their profile/preferences in a single `/cabinet` page, and migrate the existing `/settings` form into that page.

**Architecture:** Add `username/passwordHash/firstName/lastName/phone` to `User` plus a `LoginAttempt` audit table. Authentication via two custom route handlers (`POST /api/auth/password/{register,login}`) that mirror `/api/auth/telegram/callback`: verify input → upsert `User` + `Account{provider:"credentials"}` → create `Session` row → set Auth.js cookie. NO Credentials provider, NO JWT migration — the existing database-session strategy stays. New `/{locale}/cabinet` page with three sections; old `/{locale}/settings` redirects to it.

**Tech Stack:** Next.js 16 (app router), Prisma 5 + PostgreSQL 16, Auth.js v5 (database strategy), next-intl, Tailwind v4, vitest, `bcryptjs` (new).

**Spec:** `docs/superpowers/specs/2026-05-24-individual-cabinet-design.md`

**Reused helpers (do NOT redefine):**
- `auth()` — `src/auth.ts`. User id: `(session?.user as { id?: string }).id`.
- `prisma` — `src/lib/prisma.ts`.
- `SUPPORTED_LOCALES`, `LOCALE_LABELS` — `src/lib/locales.ts`.
- `SettingsForm` — `src/components/settings-form.tsx`. Reused verbatim inside cabinet.
- `verifyTelegramAuth` / `parseAdminWhitelist` / `isAdminWhitelisted` — unchanged.

**Deploy note:** Worker (`trientes-worker`) does NOT import `src/lib/username`, `password`, `rate-limit`, `session`, or `client-ip`. Web-only restart suffices. Final deploy at the end of Task 15.

**Path prefix for all node/npm/prisma commands:**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
```

---

## File Structure

**Create:**
- `prisma/migrations/20260524180000_individual_cabinet/migration.sql`
- `src/lib/username.ts` — pure: `validateUsername`, `normalizeUsername`, `generateUsernameFromName`, `RESERVED_USERNAMES`.
- `src/lib/ensure-username.ts` — DB: `ensureUsername(userId)` (separate file to keep `username.ts` free of Prisma).
- `src/lib/password.ts` — `hashPassword`, `verifyPassword`, `DUMMY_HASH` (timing-safe).
- `src/lib/rate-limit.ts` — `checkLoginRateLimit(ip, identifier)`, `checkRegisterRateLimit(ip)`, `recordLoginAttempt`.
- `src/lib/client-ip.ts` — `clientIp(req: Request)`.
- `src/lib/session.ts` — `createDatabaseSession(userId)` returning `{ cookieName, value, expires }`.
- `src/app/api/auth/password/register/route.ts`
- `src/app/api/auth/password/login/route.ts`
- `src/app/actions/account.ts` — `setUsername`, `updateProfile`, `changePassword`, `setPasswordFirstTime`.
- `src/app/[locale]/register/page.tsx`
- `src/components/register-form.tsx` (client).
- `src/app/[locale]/cabinet/page.tsx`
- `src/components/cabinet/profile-section.tsx` (client).
- `src/components/cabinet/settings-section.tsx` (server wrapper around `SettingsForm`).
- `src/components/cabinet/alerts-stub.tsx` (server).
- `src/components/password-login-form.tsx` (client) — used on `/login`.
- `tests/username.test.ts`
- `tests/password.test.ts`
- `tests/rate-limit.test.ts`
- `tests/client-ip.test.ts`
- `tests/account-actions.test.ts`

**Modify:**
- `prisma/schema.prisma` — User fields + `LoginAttempt` model.
- `src/auth.config.ts` — add `cabinet` to `needsAuth` regex.
- `src/app/api/auth/telegram/callback/route.ts` — extract session creation to `src/lib/session.ts` (DRY).
- `src/components/login-buttons.tsx` — render `PasswordLoginForm` above OAuth buttons.
- `src/app/[locale]/login/page.tsx` — pass `next` query param to login form.
- `src/app/[locale]/settings/page.tsx` — redirect to `/cabinet#settings`.
- `src/components/navbar.tsx` — add "Cabinet" link for INDIVIDUAL users (Business stays for COMPANY).
- `messages/{en,ru,de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json` — add `cabinet.*`, `register.*`, `common.cabinet`.
- `package.json` — add `bcryptjs` + `@types/bcryptjs` dependency.

---

## Task 1: Install bcryptjs

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install dependency**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm install bcryptjs
npm install -D @types/bcryptjs
```

Why bcryptjs (pure JS) and not `bcrypt` (native): bcrypt requires node-gyp + libc bindings that have repeatedly broken on Next.js builds across Node versions. bcryptjs is slightly slower but is single-package and used by NextAuth examples.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add bcryptjs for password hashing"
```

---

## Task 2: Prisma schema — User fields + LoginAttempt

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260524180000_individual_cabinet/migration.sql`

- [ ] **Step 1: Add fields to `model User`**

Add the following fields inside `model User { ... }` immediately after `image`:
```prisma
  username          String?             @unique
  passwordHash      String?
  firstName         String?
  lastName          String?
  phone             String?
```

Add relation inside `model User { ... }` before the closing brace (place alongside the other relations):
```prisma
  loginAttempts     LoginAttempt[]
```

- [ ] **Step 2: Add `LoginAttempt` model**

Append to the file (after the `Watchlist` block is fine; placement doesn't matter):
```prisma
model LoginAttempt {
  id         String   @id @default(cuid())
  ip         String
  identifier String
  success    Boolean
  userId     String?
  user       User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  createdAt  DateTime @default(now())

  @@index([ip, createdAt])
  @@index([identifier, createdAt])
}
```

- [ ] **Step 3: Create migration SQL**

Create `prisma/migrations/20260524180000_individual_cabinet/migration.sql` with:
```sql
-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "phone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");
CREATE INDEX "LoginAttempt_identifier_createdAt_idx" ON "LoginAttempt"("identifier", "createdAt");

-- AddForeignKey
ALTER TABLE "LoginAttempt"
  ADD CONSTRAINT "LoginAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 4: Apply migration + regenerate client**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npx prisma migrate deploy
npx prisma generate
```

Expected: `1 migration found … applied successfully`; `Generated Prisma Client`. Run a quick sanity query:
```bash
npx prisma db execute --stdin <<'SQL'
SELECT column_name FROM information_schema.columns WHERE table_name='User' AND column_name IN ('username','passwordHash','firstName','lastName','phone');
SQL
```
Expected: 5 rows.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260524180000_individual_cabinet
git commit -m "feat(cabinet): User username/password fields + LoginAttempt model"
```

---

## Task 3: `src/lib/username.ts` — pure validation/generation

**Files:**
- Create: `src/lib/username.ts`
- Create: `tests/username.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/username.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  validateUsername,
  normalizeUsername,
  generateUsernameFromName,
  RESERVED_USERNAMES,
} from "@/lib/username";

describe("normalizeUsername", () => {
  it("lowercases and trims", () => {
    expect(normalizeUsername("  Foo_Bar  ")).toBe("foo_bar");
  });
});

describe("validateUsername", () => {
  it("accepts a valid 3-32 char username", () => {
    expect(validateUsername("alice_99")).toEqual({ ok: true, value: "alice_99" });
  });
  it("rejects too short", () => {
    expect(validateUsername("ab")).toMatchObject({ ok: false, reason: "username_too_short" });
  });
  it("rejects too long", () => {
    expect(validateUsername("a".repeat(33))).toMatchObject({ ok: false, reason: "username_too_long" });
  });
  it("rejects invalid chars", () => {
    expect(validateUsername("alice.bob")).toMatchObject({ ok: false, reason: "username_invalid_chars" });
    expect(validateUsername("alice bob")).toMatchObject({ ok: false, reason: "username_invalid_chars" });
    expect(validateUsername("Алиса")).toMatchObject({ ok: false, reason: "username_invalid_chars" });
  });
  it("rejects reserved names", () => {
    for (const name of RESERVED_USERNAMES) {
      expect(validateUsername(name)).toMatchObject({ ok: false, reason: "username_reserved" });
    }
  });
});

describe("generateUsernameFromName", () => {
  it("strips non-allowed chars and lowercases", () => {
    expect(generateUsernameFromName("Alice Smith")).toBe("alicesmith");
    expect(generateUsernameFromName("Дмитрий")).toBe("user");
  });
  it("truncates to 24 chars to leave room for suffixes", () => {
    expect(generateUsernameFromName("a".repeat(50))).toBe("a".repeat(24));
  });
  it("falls back to 'user' for empty", () => {
    expect(generateUsernameFromName("")).toBe("user");
    expect(generateUsernameFromName(null)).toBe("user");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npx vitest run tests/username.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/username.ts`**

```ts
export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "system", "support", "help",
  "cabinet", "business", "settings", "login", "register", "logout",
  "signin", "signup", "api", "auth", "user", "users", "me", "you",
  "trientes", "anonymous", "null", "undefined", "owner",
]);

export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: "username_too_short" | "username_too_long" | "username_invalid_chars" | "username_reserved" };

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): UsernameValidation {
  const value = normalizeUsername(raw);
  if (value.length < 3) return { ok: false, reason: "username_too_short" };
  if (value.length > 32) return { ok: false, reason: "username_too_long" };
  if (!/^[a-z0-9_]+$/.test(value)) return { ok: false, reason: "username_invalid_chars" };
  if (RESERVED_USERNAMES.has(value)) return { ok: false, reason: "username_reserved" };
  return { ok: true, value };
}

export function generateUsernameFromName(name: string | null | undefined): string {
  if (!name) return "user";
  const cleaned = name.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!cleaned) return "user";
  return cleaned.slice(0, 24);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/username.test.ts
```
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/username.ts tests/username.test.ts
git commit -m "feat(cabinet): pure username validation + generation utils"
```

---

## Task 4: `src/lib/password.ts` — bcrypt wrappers

**Files:**
- Create: `src/lib/password.ts`
- Create: `tests/password.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/password.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, DUMMY_HASH } from "@/lib/password";

describe("hashPassword / verifyPassword", () => {
  it("verifies a correct password", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword("correct horse battery staple", h)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const h = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", h)).toBe(false);
  });

  it("returns false (not throw) for null/empty hash", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });

  it("DUMMY_HASH is a valid bcrypt hash that always returns false", async () => {
    expect(DUMMY_HASH).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword("anything", DUMMY_HASH)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/password.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/password.ts`**

```ts
import bcrypt from "bcryptjs";

const COST = 12;

// Pre-computed bcrypt hash of a random secret; used to keep timing constant
// when a user with the supplied identifier doesn't exist (defends against
// account enumeration via response-time side-channel).
export const DUMMY_HASH =
  "$2b$12$CwTycUXWue0Thq9StjUM0uJ8mP1bGuUu7sP1zSDl/oCM3xQ6m2dpu";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(
  plain: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) {
    // Still pay the bcrypt cost so attackers can't enumerate accounts.
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/password.test.ts
```
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/password.ts tests/password.test.ts
git commit -m "feat(cabinet): bcrypt password hash + timing-safe verify"
```

---

## Task 5: `src/lib/client-ip.ts` — extract IP

**Files:**
- Create: `src/lib/client-ip.ts`
- Create: `tests/client-ip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client-ip.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client-ip";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://trientes.org/x", { headers });
}

describe("clientIp", () => {
  it("uses first entry from x-forwarded-for", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip", () => {
    expect(clientIp(reqWith({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
  });
  it("falls back to 'unknown' when no header", () => {
    expect(clientIp(reqWith({}))).toBe("unknown");
  });
  it("trims whitespace", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "  9.9.9.9  " }))).toBe("9.9.9.9");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/client-ip.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/client-ip.ts`**

```ts
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/client-ip.test.ts
```
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-ip.ts tests/client-ip.test.ts
git commit -m "feat(cabinet): client-ip helper for rate-limit"
```

---

## Task 6: `src/lib/rate-limit.ts` — login + register limits

**Files:**
- Create: `src/lib/rate-limit.ts`
- Create: `tests/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/rate-limit.test.ts`. We test the pure threshold helpers by injecting a fake counter:
```ts
import { describe, expect, it } from "vitest";
import { evalLoginLimit, evalRegisterLimit } from "@/lib/rate-limit";

describe("evalLoginLimit", () => {
  it("allows under the threshold", () => {
    expect(evalLoginLimit({ failuresByIp: 3, failuresByIpAndIdentifier: 2 })).toEqual({ blocked: false });
  });
  it("blocks at 10 failures by IP alone in the window", () => {
    expect(evalLoginLimit({ failuresByIp: 10, failuresByIpAndIdentifier: 0 })).toEqual({ blocked: true });
  });
  it("blocks at 5 failures for (ip,identifier) even if total IP failures are low", () => {
    expect(evalLoginLimit({ failuresByIp: 1, failuresByIpAndIdentifier: 5 })).toEqual({ blocked: true });
  });
});

describe("evalRegisterLimit", () => {
  it("allows under the per-IP threshold", () => {
    expect(evalRegisterLimit({ registrationsByIp: 4 })).toEqual({ blocked: false });
  });
  it("blocks at 5 registrations per IP per hour", () => {
    expect(evalRegisterLimit({ registrationsByIp: 5 })).toEqual({ blocked: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/rate-limit.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/rate-limit.ts`**

```ts
import { prisma } from "@/lib/prisma";

// Spec: 10 failed attempts per IP per 10 minutes → block for ~15 minutes.
// Implemented as a 15-minute sliding window with a 10-failure threshold: once
// the count is hit, the limiter stays blocked until the oldest failure ages out
// of the window (i.e., naturally ~15 min from the 10th attempt).
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILS_BY_IP = 10;
export const LOGIN_MAX_FAILS_BY_IP_IDENT = 5;
export const REGISTER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const REGISTER_MAX_BY_IP = 5;

export function evalLoginLimit(c: {
  failuresByIp: number;
  failuresByIpAndIdentifier: number;
}): { blocked: boolean } {
  return {
    blocked:
      c.failuresByIp >= LOGIN_MAX_FAILS_BY_IP ||
      c.failuresByIpAndIdentifier >= LOGIN_MAX_FAILS_BY_IP_IDENT,
  };
}

export function evalRegisterLimit(c: { registrationsByIp: number }): { blocked: boolean } {
  return { blocked: c.registrationsByIp >= REGISTER_MAX_BY_IP };
}

// DB-backed checks (used in route handlers).
export async function checkLoginRateLimit(ip: string, identifier: string): Promise<{ blocked: boolean }> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const [failuresByIp, failuresByIpAndIdentifier] = await Promise.all([
    prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } }),
    prisma.loginAttempt.count({
      where: { ip, identifier, success: false, createdAt: { gte: since } },
    }),
  ]);
  return evalLoginLimit({ failuresByIp, failuresByIpAndIdentifier });
}

export async function checkRegisterRateLimit(ip: string): Promise<{ blocked: boolean }> {
  const since = new Date(Date.now() - REGISTER_WINDOW_MS);
  // Re-use LoginAttempt with identifier="__register__" to avoid a 2nd table.
  const registrationsByIp = await prisma.loginAttempt.count({
    where: { ip, identifier: "__register__", createdAt: { gte: since } },
  });
  return evalRegisterLimit({ registrationsByIp });
}

export async function recordLoginAttempt(input: {
  ip: string;
  identifier: string;
  success: boolean;
  userId?: string | null;
}): Promise<void> {
  await prisma.loginAttempt.create({
    data: {
      ip: input.ip,
      identifier: input.identifier,
      success: input.success,
      userId: input.userId ?? null,
    },
  });
  // Lazy cleanup of old rows; cheap because indexed on createdAt.
  await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/rate-limit.test.ts
```
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit.ts tests/rate-limit.test.ts
git commit -m "feat(cabinet): login + register rate limits (pure + DB)"
```

---

## Task 7: `src/lib/session.ts` — extract Auth.js session creation

**Files:**
- Create: `src/lib/session.ts`
- Modify: `src/app/api/auth/telegram/callback/route.ts`

This refactor is required before Task 8/9 — we will reuse `createDatabaseSession()` from both password routes and (after refactor) telegram-callback, so we touch them together to keep behavior identical.

- [ ] **Step 1: Create `src/lib/session.ts`**

```ts
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionCookie = {
  name: string;
  value: string;
  expires: Date;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
};

export function authSessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

// Creates a Session row for the given user and returns the cookie attributes
// the caller should set on the NextResponse.
export async function createDatabaseSession(userId: string): Promise<SessionCookie> {
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { sessionToken, userId, expires } });
  return {
    name: authSessionCookieName(),
    value: sessionToken,
    expires,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}
```

- [ ] **Step 2: Refactor telegram-callback to use `createDatabaseSession`**

Edit `src/app/api/auth/telegram/callback/route.ts`. Replace the lines that compute `sessionToken`, `expires`, `cookieName`, and call `prisma.session.create(...)` and `response.cookies.set(...)` with:

```ts
import { createDatabaseSession } from "@/lib/session";
// ...
const cookie = await createDatabaseSession(userId);
const redirectTo = req.headers.get("referer")
  ? new URL("/", new URL(req.headers.get("referer")!))
  : new URL("/", req.url);
const response = NextResponse.redirect(redirectTo);
response.cookies.set(cookie);
return response;
```

Remove the now-unused `randomBytes` import and the `isProd`/`cookieName` lines.

- [ ] **Step 3: Run unit tests + typecheck**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npx vitest run
npx tsc --noEmit
```
Expected: all tests still pass, typecheck clean.

- [ ] **Step 4: Manual smoke**

Restart web + try Telegram login (or skip if no test Telegram account is available — note in commit message). At minimum: `npm run build` succeeds.

```bash
npm run build
```
Expected: build completes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts src/app/api/auth/telegram/callback/route.ts
git commit -m "refactor(auth): extract createDatabaseSession (used by telegram + upcoming password)"
```

---

## Task 8: `POST /api/auth/password/register` route

**Files:**
- Create: `src/app/api/auth/password/register/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { clientIp } from "@/lib/client-ip";
import { hashPassword } from "@/lib/password";
import { validateUsername, normalizeUsername } from "@/lib/username";
import { checkRegisterRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import { createDatabaseSession } from "@/lib/session";

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

export async function POST(req: Request) {
  const ip = clientIp(req);
  const limit = await checkRegisterRateLimit(ip);
  if (limit.blocked) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { username?: unknown; password?: unknown; email?: unknown; locale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const v = validateUsername(String(body.username ?? ""));
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 });

  const password = String(body.password ?? "");
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD) {
    return NextResponse.json({ error: "password_too_long" }, { status: 400 });
  }

  const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const email = emailRaw.length > 0 ? emailRaw : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "email_invalid" }, { status: 400 });
  }

  const locale = typeof body.locale === "string" ? body.locale : "en";

  const passwordHash = await hashPassword(password);

  // Record a "registration attempt" first so rate-limit ticks even if the next
  // step errors out (e.g. duplicate username): otherwise an attacker could
  // probe usernames without cost.
  await recordLoginAttempt({ ip, identifier: "__register__", success: true });

  let userId: string;
  try {
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { username: v.value, passwordHash, email, accountType: "INDIVIDUAL" },
      });
      await tx.account.create({
        data: {
          userId: u.id,
          type: "credentials",
          provider: "credentials",
          providerAccountId: u.id,
        },
      });
      return u;
    });
    userId = user.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta as { target?: string[] } | undefined)?.target ?? [];
      if (target.includes("username")) {
        return NextResponse.json({ error: "username_taken" }, { status: 409 });
      }
      if (target.includes("email")) {
        return NextResponse.json({ error: "email_taken" }, { status: 409 });
      }
    }
    throw err;
  }

  const cookie = await createDatabaseSession(userId);
  const res = NextResponse.json({ ok: true, redirect: `/${locale}/cabinet` });
  res.cookies.set(cookie);
  return res;
}
```

- [ ] **Step 2: Typecheck**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Manual smoke**

Start dev server (`npm run dev`) in a separate shell, then:
```bash
curl -i -X POST http://localhost:3000/api/auth/password/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"testalice","password":"hunter2hunter","email":"alice@example.com"}'
```
Expected: `HTTP/1.1 200`, `Set-Cookie: authjs.session-token=…`, body `{"ok":true,"redirect":"/en/cabinet"}`. Then re-run same call: expect `409` with `username_taken`.

Clean up the test row after smoke:
```bash
npx prisma db execute --stdin <<'SQL'
DELETE FROM "Session" WHERE "userId" IN (SELECT id FROM "User" WHERE username='testalice');
DELETE FROM "Account" WHERE "userId" IN (SELECT id FROM "User" WHERE username='testalice');
DELETE FROM "LoginAttempt" WHERE "userId" IN (SELECT id FROM "User" WHERE username='testalice');
DELETE FROM "User" WHERE username='testalice';
SQL
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/password/register
git commit -m "feat(cabinet): POST /api/auth/password/register"
```

---

## Task 9: `POST /api/auth/password/login` route

**Files:**
- Create: `src/app/api/auth/password/login/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/client-ip";
import { verifyPassword, DUMMY_HASH } from "@/lib/password";
import { checkLoginRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import { createDatabaseSession } from "@/lib/session";

export async function POST(req: Request) {
  const ip = clientIp(req);

  let body: { identifier?: unknown; password?: unknown; locale?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const identifier = String(body.identifier ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!identifier || !password) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const limit = await checkLoginRateLimit(ip, identifier);
  if (limit.blocked) {
    // Still pay bcrypt cost so attackers can't distinguish rate-limit from miss.
    await verifyPassword(password, DUMMY_HASH);
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const user = identifier.includes("@")
    ? await prisma.user.findUnique({ where: { email: identifier } })
    : await prisma.user.findUnique({ where: { username: identifier } });

  const ok = await verifyPassword(password, user?.passwordHash ?? null);

  await recordLoginAttempt({ ip, identifier, success: ok, userId: user?.id ?? null });

  if (!ok || !user) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const locale = typeof body.locale === "string" ? body.locale : "en";
  const next = typeof body.next === "string" && body.next.startsWith("/")
    ? body.next
    : `/${locale}/cabinet`;

  const cookie = await createDatabaseSession(user.id);
  const res = NextResponse.json({ ok: true, redirect: next });
  res.cookies.set(cookie);
  return res;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Manual smoke**

With dev server running:
```bash
# 1) Re-register
curl -s -X POST http://localhost:3000/api/auth/password/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"smokealice","password":"hunter2hunter"}' | jq .

# 2) Wrong password
curl -i -X POST http://localhost:3000/api/auth/password/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"smokealice","password":"wrong"}'
# Expected: 401 invalid_credentials

# 3) Correct password
curl -i -X POST http://localhost:3000/api/auth/password/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"smokealice","password":"hunter2hunter"}'
# Expected: 200, Set-Cookie present

# 4) Rate-limit: 5 bad attempts for (ip,identifier) → next blocked
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST http://localhost:3000/api/auth/password/login \
    -H 'Content-Type: application/json' \
    -d '{"identifier":"smokealice","password":"wrong"}'
done
curl -i -X POST http://localhost:3000/api/auth/password/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"smokealice","password":"hunter2hunter"}'
# Expected: 429 rate_limited
```

Clean up:
```bash
npx prisma db execute --stdin <<'SQL'
DELETE FROM "Session" WHERE "userId" IN (SELECT id FROM "User" WHERE username='smokealice');
DELETE FROM "Account" WHERE "userId" IN (SELECT id FROM "User" WHERE username='smokealice');
DELETE FROM "LoginAttempt" WHERE "userId" IN (SELECT id FROM "User" WHERE username='smokealice');
DELETE FROM "User" WHERE username='smokealice';
SQL
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/password/login
git commit -m "feat(cabinet): POST /api/auth/password/login with rate-limit"
```

---

## Task 10: Registration UI — `/{locale}/register`

**Files:**
- Create: `src/app/[locale]/register/page.tsx`
- Create: `src/components/register-form.tsx`

- [ ] **Step 1: Page (server component)**

Create `src/app/[locale]/register/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { RegisterForm } from "@/components/register-form";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  if (session?.user) redirect(`/${locale}/cabinet`);
  const t = await getTranslations("register");
  return (
    <main className="max-w-md mx-auto px-6 py-10 md:py-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">
        ● {t("kicker")}
      </div>
      <h1 className="text-[32px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
        {t("title")}
      </h1>
      <p className="text-muted mb-8">{t("subtitle")}</p>
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <RegisterForm locale={locale} />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Client form**

Create `src/components/register-form.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const fieldCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";

export function RegisterForm({ locale }: { locale: string }) {
  const t = useTranslations("register");
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await fetch("/api/auth/password/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, email: email || undefined, locale }),
          });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; redirect?: string; error?: string };
          if (res.ok && data.redirect) {
            router.push(data.redirect);
            router.refresh();
            return;
          }
          setError(data.error ?? "unknown_error");
        });
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("username")}</span>
        <input
          className={fieldCls}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9_]+"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("password")}</span>
        <input
          className={fieldCls}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          maxLength={200}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("emailOptional")}</span>
        <input
          className={fieldCls}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {error ? (
        <p className="text-sm text-red-500">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.unknown_error")}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-accent-foreground rounded-full px-4 py-2.5 text-sm font-semibold uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-50"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
      <p className="text-xs text-muted text-center">
        {t("haveAccount")}{" "}
        <a href={`/${locale}/login`} className="underline">{t("signIn")}</a>
      </p>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean (i18n strings will be added in Task 15; typecheck doesn't check JSON).

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/register src/components/register-form.tsx
git commit -m "feat(cabinet): registration page + form (UI only; i18n strings in later task)"
```

---

## Task 11: Login UI — credentials form on `/{locale}/login`

**Files:**
- Create: `src/components/password-login-form.tsx`
- Modify: `src/components/login-buttons.tsx`
- Modify: `src/app/[locale]/login/page.tsx`

- [ ] **Step 1: Create `password-login-form.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const fieldCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";

export function PasswordLoginForm({ locale, next }: { locale: string; next?: string }) {
  const t = useTranslations("register");
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await fetch("/api/auth/password/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier, password, locale, next }),
          });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; redirect?: string; error?: string };
          if (res.ok && data.redirect) {
            router.push(data.redirect);
            router.refresh();
            return;
          }
          setError(data.error ?? "unknown_error");
        });
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("identifier")}</span>
        <input
          className={fieldCls}
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("password")}</span>
        <input
          className={fieldCls}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error ? (
        <p className="text-sm text-red-500">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.unknown_error")}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-accent-foreground rounded-full px-4 py-2.5 text-sm font-semibold uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-50"
      >
        {pending ? t("submitting") : t("signIn")}
      </button>
      <p className="text-xs text-muted text-center">
        {t("noAccount")}{" "}
        <a href={`/${locale}/register`} className="underline">{t("createAccount")}</a>
      </p>
    </form>
  );
}
```

- [ ] **Step 2: Modify `src/components/login-buttons.tsx`**

Replace the entire file with:
```tsx
"use client";

import { useTransition } from "react";
import { signInWithProvider } from "@/app/actions/auth";
import { TelegramLogin } from "@/components/telegram-login";
import { PasswordLoginForm } from "@/components/password-login-form";

export function LoginButtons({
  locale,
  telegramBotUsername,
  next,
}: {
  locale: string;
  telegramBotUsername?: string;
  next?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-5">
      <PasswordLoginForm locale={locale} next={next} />
      <div className="relative flex items-center my-1">
        <div className="flex-grow border-t border-hairline" />
        <span className="px-3 text-[11px] uppercase tracking-[0.2em] text-muted">or</span>
        <div className="flex-grow border-t border-hairline" />
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => signInWithProvider("google"))}
        className="bg-blue text-blue-foreground rounded-full px-4 py-2.5 text-sm font-semibold uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-50"
      >
        Continue with Google
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => signInWithProvider("github"))}
        className="bg-card-alt text-foreground border border-hairline rounded-md px-4 py-2.5 text-sm font-medium transition-colors hover:bg-card disabled:opacity-50"
      >
        Continue with GitHub
      </button>
      {telegramBotUsername ? (
        <div className="pt-4 mt-2 border-t border-hairline">
          <TelegramLogin botUsername={telegramBotUsername} />
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Modify `src/app/[locale]/login/page.tsx`**

Replace the file with:
```tsx
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { LoginButtons } from "@/components/login-buttons";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  return (
    <main className="max-w-md mx-auto px-6 py-10 md:py-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">
        ● Sign in
      </div>
      <h1 className="text-[32px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
        {t("signIn")}
      </h1>
      <p className="text-muted mb-8">
        Continue with your preferred provider or sign in with a password.
      </p>
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <LoginButtons
          locale={locale}
          telegramBotUsername={process.env.TELEGRAM_BOT_USERNAME}
          next={typeof next === "string" ? next : undefined}
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/password-login-form.tsx src/components/login-buttons.tsx src/app/[locale]/login/page.tsx
git commit -m "feat(cabinet): credentials form on login page"
```

---

## Task 12: Account server actions (profile/username/password)

**Files:**
- Create: `src/app/actions/account.ts`
- Create: `tests/account-actions.test.ts` (pure-validation portions only)

The actions themselves hit the DB and `auth()`; we test only the input-validation branches that can run without a real session by extracting them into small pure helpers.

- [ ] **Step 1: Write tests for pure validators**

Create `tests/account-actions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validateProfileInput, normalizePhone } from "@/app/actions/account";

describe("normalizePhone", () => {
  it("strips everything except + and digits", () => {
    expect(normalizePhone(" +1 (555) 123-4567 ")).toBe("+15551234567");
  });
  it("returns null for blank", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });
});

describe("validateProfileInput", () => {
  it("accepts a minimal valid input", () => {
    const r = validateProfileInput({ firstName: "Alice", lastName: "", phone: "", email: "" });
    expect(r.ok).toBe(true);
  });
  it("rejects an invalid email", () => {
    expect(validateProfileInput({ email: "not-an-email" }))
      .toMatchObject({ ok: false, reason: "email_invalid" });
  });
  it("rejects firstName > 80 chars", () => {
    expect(validateProfileInput({ firstName: "a".repeat(81) }))
      .toMatchObject({ ok: false, reason: "first_name_too_long" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/account-actions.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/app/actions/account.ts`**

```ts
"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { hashPassword, verifyPassword } from "@/lib/password";
import { validateUsername } from "@/lib/username";

export type ProfileInput = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
};

export type ProfileValidated =
  | {
      ok: true;
      data: {
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        email: string | null;
      };
    }
  | { ok: false; reason: "first_name_too_long" | "last_name_too_long" | "phone_too_long" | "email_invalid" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

function trimOrNull(s: string | undefined | null, max: number): string | null | { tooLong: true } {
  if (s == null) return null;
  const t = s.trim();
  if (t.length === 0) return null;
  if (t.length > max) return { tooLong: true };
  return t;
}

export function validateProfileInput(input: ProfileInput): ProfileValidated {
  const fn = trimOrNull(input.firstName, 80);
  if (fn && typeof fn === "object") return { ok: false, reason: "first_name_too_long" };
  const ln = trimOrNull(input.lastName, 80);
  if (ln && typeof ln === "object") return { ok: false, reason: "last_name_too_long" };
  const phRaw = trimOrNull(input.phone, 40);
  if (phRaw && typeof phRaw === "object") return { ok: false, reason: "phone_too_long" };
  const ph = normalizePhone(typeof phRaw === "string" ? phRaw : null);
  const emRaw = trimOrNull(input.email, 200);
  if (emRaw && typeof emRaw === "object") return { ok: false, reason: "email_invalid" };
  let em: string | null = null;
  if (typeof emRaw === "string") {
    const lower = emRaw.toLowerCase();
    if (!EMAIL_RE.test(lower)) return { ok: false, reason: "email_invalid" };
    em = lower;
  }
  return {
    ok: true,
    data: {
      firstName: typeof fn === "string" ? fn : null,
      lastName: typeof ln === "string" ? ln : null,
      phone: ph,
      email: em,
    },
  };
}

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function setUsername(next: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, reason: "unauth" };
  const v = validateUsername(next);
  if (!v.ok) return { ok: false, reason: v.reason };
  try {
    await prisma.user.update({ where: { id: userId }, data: { username: v.value } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: "username_taken" };
    }
    throw err;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateProfile(input: ProfileInput): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, reason: "unauth" };
  const v = validateProfileInput(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  // If email changes, reset emailVerified.
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const emailChanged = (current?.email ?? null) !== v.data.email;
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: v.data.firstName,
        lastName: v.data.lastName,
        phone: v.data.phone,
        email: v.data.email,
        ...(emailChanged ? { emailVerified: null } : {}),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: "email_taken" };
    }
    throw err;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changePassword(oldPw: string, newPw: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, reason: "unauth" };
  if (newPw.length < 8) return { ok: false, reason: "password_too_short" };
  if (newPw.length > 200) return { ok: false, reason: "password_too_long" };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user?.passwordHash) return { ok: false, reason: "no_password_set" };
  const ok = await verifyPassword(oldPw, user.passwordHash);
  if (!ok) return { ok: false, reason: "invalid_credentials" };
  const passwordHash = await hashPassword(newPw);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  return { ok: true };
}

export async function setPasswordFirstTime(pw: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, reason: "unauth" };
  if (pw.length < 8) return { ok: false, reason: "password_too_short" };
  if (pw.length > 200) return { ok: false, reason: "password_too_long" };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (user?.passwordHash) return { ok: false, reason: "password_already_set" };
  const passwordHash = await hashPassword(pw);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.account.upsert({
      where: { provider_providerAccountId: { provider: "credentials", providerAccountId: userId } },
      create: { userId, type: "credentials", provider: "credentials", providerAccountId: userId },
      update: {},
    }),
  ]);
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/account-actions.test.ts
```
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/account.ts tests/account-actions.test.ts
git commit -m "feat(cabinet): account server actions (setUsername, updateProfile, changePassword)"
```

---

## Task 13: `ensureUsername()` for OAuth users + `/cabinet` page

**Files:**
- Create: `src/lib/ensure-username.ts` (keeps `src/lib/username.ts` pure / test-friendly).
- Create: `src/app/[locale]/cabinet/page.tsx`
- Create: `src/components/cabinet/profile-section.tsx`
- Create: `src/components/cabinet/settings-section.tsx`
- Create: `src/components/cabinet/alerts-stub.tsx`

- [ ] **Step 1: Create `src/lib/ensure-username.ts`**

Kept separate from `username.ts` so the validator module remains free of Prisma
imports (matches the pattern of `src/lib/company.ts` — pure validators).

```ts
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generateUsernameFromName, RESERVED_USERNAMES } from "@/lib/username";

// Lazily assigns a unique username to a user that doesn't have one yet.
// Idempotent: if the user already has a username, returns it unchanged.
export async function ensureUsername(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, name: true },
  });
  if (!user) throw new Error("ensureUsername: user not found");
  if (user.username) return user.username;

  const base = generateUsernameFromName(user.name);
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}${Math.floor(Math.random() * 10000)}`;
    if (RESERVED_USERNAMES.has(candidate)) continue;
    try {
      await prisma.user.update({ where: { id: userId }, data: { username: candidate } });
      return candidate;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("ensureUsername: exhausted retries");
}
```

- [ ] **Step 2: Settings section wrapper**

Create `src/components/cabinet/settings-section.tsx`:
```tsx
import { getTranslations } from "next-intl/server";
import { SettingsForm } from "@/components/settings-form";

export async function SettingsSection({
  initialLocale,
  initialCurrency,
  initialTheme,
}: {
  initialLocale: string;
  initialCurrency: string;
  initialTheme: string;
}) {
  const t = await getTranslations("cabinet.settings");
  return (
    <section id="settings" className="scroll-mt-24">
      <h2 className="text-[20px] md:text-[24px] font-bold tracking-[-0.02em] mb-4">
        {t("title")}
      </h2>
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <SettingsForm
          initialLocale={initialLocale}
          initialCurrency={initialCurrency}
          initialTheme={initialTheme}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Alerts stub**

Create `src/components/cabinet/alerts-stub.tsx`:
```tsx
import { getTranslations } from "next-intl/server";

export async function AlertsStub({ locale }: { locale: string }) {
  const t = await getTranslations("cabinet.alerts");
  return (
    <section id="alerts" className="scroll-mt-24">
      <h2 className="text-[20px] md:text-[24px] font-bold tracking-[-0.02em] mb-4">
        {t("title")}
      </h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <a
          href={`/${locale}/watchlist`}
          className="bg-card border border-hairline rounded-[20px] p-6 hover:border-accent transition-colors"
        >
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted mb-2">{t("watchlistKicker")}</div>
          <div className="text-lg font-semibold mb-1">{t("watchlistTitle")}</div>
          <p className="text-sm text-muted">{t("watchlistBody")}</p>
        </a>
        <div className="bg-card-alt border border-hairline rounded-[20px] p-6 opacity-70">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted mb-2">{t("alertsKicker")}</div>
          <div className="text-lg font-semibold mb-1">{t("alertsTitle")}</div>
          <p className="text-sm text-muted">{t("alertsBody")}</p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Profile section (client)**

Create `src/components/cabinet/profile-section.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  setUsername,
  updateProfile,
  changePassword,
  setPasswordFirstTime,
} from "@/app/actions/account";

const fieldCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";
const labelCls = "text-[12px] uppercase tracking-[0.15em] text-muted mb-1 block";

export function ProfileSection({
  initial,
}: {
  initial: {
    username: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    hasPassword: boolean;
  };
}) {
  const t = useTranslations("cabinet.profile");
  const [pending, start] = useTransition();
  const [username, setUsernameLocal] = useState(initial.username);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usernameMsg, setUsernameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section id="profile" className="scroll-mt-24 flex flex-col gap-6">
      <h2 className="text-[20px] md:text-[24px] font-bold tracking-[-0.02em]">
        {t("title")}
      </h2>

      {/* Username */}
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <h3 className="font-semibold mb-4">{t("usernameTitle")}</h3>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setUsernameMsg(null);
            start(async () => {
              const r = await setUsername(username);
              setUsernameMsg(
                r.ok
                  ? { ok: true, text: t("saved") }
                  : { ok: false, text: t.has(`errors.${r.reason}`) ? t(`errors.${r.reason}`) : r.reason },
              );
            });
          }}
        >
          <label>
            <span className={labelCls}>{t("username")}</span>
            <input
              className={fieldCls}
              value={username}
              onChange={(e) => setUsernameLocal(e.target.value)}
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              required
            />
          </label>
          {usernameMsg ? (
            <p className={`text-sm ${usernameMsg.ok ? "text-green-500" : "text-red-500"}`}>{usernameMsg.text}</p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="self-start bg-accent text-accent-foreground rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50"
          >
            {t("save")}
          </button>
        </form>
      </div>

      {/* Profile fields */}
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <h3 className="font-semibold mb-4">{t("contactTitle")}</h3>
        <form
          className="grid sm:grid-cols-2 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setProfileMsg(null);
            start(async () => {
              const r = await updateProfile({ firstName, lastName, phone, email });
              setProfileMsg(
                r.ok
                  ? { ok: true, text: t("saved") }
                  : { ok: false, text: t.has(`errors.${r.reason}`) ? t(`errors.${r.reason}`) : r.reason },
              );
            });
          }}
        >
          <label>
            <span className={labelCls}>{t("firstName")}</span>
            <input className={fieldCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={80} />
          </label>
          <label>
            <span className={labelCls}>{t("lastName")}</span>
            <input className={fieldCls} value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={80} />
          </label>
          <label>
            <span className={labelCls}>{t("phone")}</span>
            <input className={fieldCls} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </label>
          <label>
            <span className={labelCls}>{t("email")}</span>
            <input className={fieldCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
          </label>
          {profileMsg ? (
            <p className={`sm:col-span-2 text-sm ${profileMsg.ok ? "text-green-500" : "text-red-500"}`}>{profileMsg.text}</p>
          ) : null}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="bg-accent text-accent-foreground rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50"
            >
              {t("save")}
            </button>
          </div>
        </form>
      </div>

      {/* Password */}
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <h3 className="font-semibold mb-4">
          {initial.hasPassword ? t("changePasswordTitle") : t("setPasswordTitle")}
        </h3>
        <form
          className="flex flex-col gap-3 max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            setPwMsg(null);
            start(async () => {
              const r = initial.hasPassword
                ? await changePassword(oldPw, newPw)
                : await setPasswordFirstTime(newPw);
              setPwMsg(
                r.ok
                  ? { ok: true, text: t("passwordSaved") }
                  : { ok: false, text: t.has(`errors.${r.reason}`) ? t(`errors.${r.reason}`) : r.reason },
              );
              if (r.ok) {
                setOldPw("");
                setNewPw("");
              }
            });
          }}
        >
          {initial.hasPassword ? (
            <label>
              <span className={labelCls}>{t("currentPassword")}</span>
              <input className={fieldCls} type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
            </label>
          ) : null}
          <label>
            <span className={labelCls}>{t("newPassword")}</span>
            <input className={fieldCls} type="password" autoComplete="new-password" minLength={8} maxLength={200} value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          </label>
          {pwMsg ? (
            <p className={`text-sm ${pwMsg.ok ? "text-green-500" : "text-red-500"}`}>{pwMsg.text}</p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="self-start bg-accent text-accent-foreground rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50"
          >
            {initial.hasPassword ? t("changePassword") : t("setPassword")}
          </button>
        </form>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Cabinet page**

Create `src/app/[locale]/cabinet/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureUsername } from "@/lib/ensure-username";
import { ProfileSection } from "@/components/cabinet/profile-section";
import { SettingsSection } from "@/components/cabinet/settings-section";
import { AlertsStub } from "@/components/cabinet/alerts-stub";

export default async function CabinetPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect(`/${locale}/login?next=/${locale}/cabinet`);

  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect(`/${locale}/login`);
  if (user.accountType === "COMPANY") redirect(`/${locale}/business`);

  if (!user.username) {
    await ensureUsername(userId);
    user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) redirect(`/${locale}/login`);
  }

  const t = await getTranslations("cabinet");

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 md:py-16 flex flex-col gap-10">
      <header>
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
          {t("kicker")}
        </div>
        <h1 className="text-[28px] sm:text-[36px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
          {t("title")}
        </h1>
        <p className="text-muted">{t("subtitle")}</p>
      </header>

      <ProfileSection
        initial={{
          username: user.username ?? "",
          firstName: user.firstName ?? "",
          lastName: user.lastName ?? "",
          phone: user.phone ?? "",
          email: user.email ?? "",
          hasPassword: !!user.passwordHash,
        }}
      />

      <SettingsSection
        initialLocale={user.preferredLocale}
        initialCurrency={user.preferredCurrency}
        initialTheme={user.preferredTheme}
      />

      <AlertsStub locale={locale} />
    </main>
  );
}
```

- [ ] **Step 6: Typecheck + build**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ensure-username.ts src/app/[locale]/cabinet src/components/cabinet
git commit -m "feat(cabinet): /cabinet page with profile/settings/alerts-stub sections"
```

---

## Task 14: `/settings` redirect + auth.config + navbar link

**Files:**
- Modify: `src/app/[locale]/settings/page.tsx`
- Modify: `src/auth.config.ts`
- Modify: `src/components/navbar.tsx`

- [ ] **Step 1: Redirect `/settings`**

Replace `src/app/[locale]/settings/page.tsx` with:
```tsx
import { redirect } from "next/navigation";

export default async function SettingsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/cabinet#settings`);
}
```

- [ ] **Step 2: Gate `/cabinet` in middleware**

Edit `src/auth.config.ts`, replace the `needsAuth` line:
```ts
const needsAuth =
  /\/[a-z-]+\/(watchlist|request|settings|admin|cabinet)(\/|$)/i.test(path);
```

(`/settings` stays in the matcher so the redirect itself triggers a login if needed.)

- [ ] **Step 3: Navbar — Cabinet link for INDIVIDUAL users**

`src/components/navbar.tsx` already calls `auth()` itself — extend it to also
look up the user's `accountType`. Apply the following three edits.

**Edit 3a** — add `prisma` import and load `accountType` after the existing `isAdmin` line. Replace:
```tsx
import { auth, signOut } from "@/auth";
import { LocaleSwitcher } from "./locale-switcher";
```
with:
```tsx
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { LocaleSwitcher } from "./locale-switcher";
```

Then replace:
```tsx
  const isAdmin =
    (session?.user as { role?: string } | undefined)?.role === "ADMIN";
```
with:
```tsx
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const isAdmin =
    (session?.user as { role?: string } | undefined)?.role === "ADMIN";
  const accountType = userId
    ? (await prisma.user.findUnique({ where: { id: userId }, select: { accountType: true } }))?.accountType
    : null;
  const cabinetHref =
    accountType === "COMPANY" ? `/${locale}/business` : `/${locale}/cabinet`;
  const cabinetLabel =
    accountType === "COMPANY" ? t("business") : t("cabinet");
  const showCabinetLink = !!session?.user;
```

**Edit 3b** — replace the **mobile** Business link block:
```tsx
            <Link
              href={`/${locale}/business`}
              className="block py-3 text-base text-foreground hover:text-accent border-b border-hairline transition-colors"
            >
              {t("business")}
            </Link>
```
with:
```tsx
            {showCabinetLink ? (
              <Link
                href={cabinetHref}
                className="block py-3 text-base text-foreground hover:text-accent border-b border-hairline transition-colors"
              >
                {cabinetLabel}
              </Link>
            ) : (
              <Link
                href={`/${locale}/business`}
                className="block py-3 text-base text-foreground hover:text-accent border-b border-hairline transition-colors"
              >
                {t("business")}
              </Link>
            )}
```

**Edit 3c** — replace the **desktop** Business link block:
```tsx
          <Link
            href={`/${locale}/business`}
            className="hover:text-foreground transition-colors"
          >
            {t("business")}
          </Link>
```
with:
```tsx
          {showCabinetLink ? (
            <Link
              href={cabinetHref}
              className="hover:text-foreground transition-colors"
            >
              {cabinetLabel}
            </Link>
          ) : (
            <Link
              href={`/${locale}/business`}
              className="hover:text-foreground transition-colors"
            >
              {t("business")}
            </Link>
          )}
```

After edits, verify:
```bash
grep -n "cabinetHref\|cabinetLabel\|showCabinetLink" src/components/navbar.tsx
```
Expected: 6 lines (1 for each variable's declaration + 1 use of cabinetHref in mobile, 1 in desktop; cabinetLabel similar; showCabinetLink in 2 conditionals).

- [ ] **Step 4: Build + smoke**

```bash
npm run build
```
Expected: clean.

Quick manual: start dev, hit `/en/settings`, expect 30x → `/en/cabinet#settings`. Hit `/en/cabinet` while logged out → `/en/login?next=/en/cabinet`.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/settings src/auth.config.ts src/components/navbar.tsx
git commit -m "feat(cabinet): redirect /settings, gate /cabinet, navbar Cabinet/Business switch"
```

---

## Task 15: i18n strings — 10 locales

**Files:**
- Modify: `messages/{en,ru,de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json`

- [ ] **Step 1: Add `common.cabinet` and new namespaces**

For **every** file in `messages/`, add these keys. Translation values below are
the **EN baseline**; translate per locale (use the same precedent as
`common.business` translation for tone).

Inside `common`:
```json
"cabinet": "Cabinet"
```

Add top-level namespace `cabinet`:
```json
"cabinet": {
  "kicker": "Section · Cabinet",
  "title": "Your Cabinet",
  "subtitle": "Manage your profile, preferences, and alerts.",
  "profile": {
    "title": "Profile",
    "usernameTitle": "Username",
    "username": "Username",
    "contactTitle": "Contact details",
    "firstName": "First name",
    "lastName": "Last name",
    "phone": "Phone",
    "email": "Email",
    "save": "Save",
    "saved": "Saved.",
    "changePasswordTitle": "Change password",
    "setPasswordTitle": "Set a password",
    "currentPassword": "Current password",
    "newPassword": "New password",
    "changePassword": "Change password",
    "setPassword": "Set password",
    "passwordSaved": "Password updated.",
    "errors": {
      "unauth": "You are not signed in.",
      "username_too_short": "Username must be at least 3 characters.",
      "username_too_long": "Username must be at most 32 characters.",
      "username_invalid_chars": "Only lowercase letters, digits, and underscore are allowed.",
      "username_reserved": "That username is reserved.",
      "username_taken": "That username is already taken.",
      "email_invalid": "Please enter a valid email address.",
      "email_taken": "That email is already in use.",
      "first_name_too_long": "First name is too long.",
      "last_name_too_long": "Last name is too long.",
      "phone_too_long": "Phone is too long.",
      "no_password_set": "You don't have a password set yet.",
      "invalid_credentials": "Current password is incorrect.",
      "password_too_short": "Password must be at least 8 characters.",
      "password_too_long": "Password is too long.",
      "password_already_set": "You already have a password."
    }
  },
  "settings": {
    "title": "Preferences"
  },
  "alerts": {
    "title": "Favorites & alerts",
    "watchlistKicker": "Watchlist",
    "watchlistTitle": "Favorite coins",
    "watchlistBody": "Open your watchlist to manage coins you follow.",
    "alertsKicker": "Coming soon",
    "alertsTitle": "Price alerts",
    "alertsBody": "Notifications for price and geo triggers — shipping in the next slice."
  }
},
"register": {
  "kicker": "Create account",
  "title": "Register",
  "subtitle": "Pick a username and password. Email is optional for now.",
  "username": "Username",
  "password": "Password",
  "emailOptional": "Email (optional)",
  "identifier": "Username or email",
  "submit": "Create account",
  "submitting": "Creating…",
  "signIn": "Sign in",
  "createAccount": "Create one",
  "haveAccount": "Already have an account?",
  "noAccount": "No account yet?",
  "errors": {
    "unknown_error": "Something went wrong. Please try again.",
    "rate_limited": "Too many attempts. Try again in a few minutes.",
    "username_too_short": "Username must be at least 3 characters.",
    "username_too_long": "Username must be at most 32 characters.",
    "username_invalid_chars": "Only lowercase letters, digits, and underscore are allowed.",
    "username_reserved": "That username is reserved.",
    "username_taken": "That username is already taken.",
    "email_invalid": "Please enter a valid email address.",
    "email_taken": "That email is already in use.",
    "password_too_short": "Password must be at least 8 characters.",
    "password_too_long": "Password is too long.",
    "invalid_credentials": "Incorrect username or password.",
    "missing_fields": "Please fill in both fields."
  }
}
```

For non-English locales, translate values using `messages/<locale>.json`'s existing translations of `common.business` and `common.settings` for tone reference. For non-Latin scripts: error labels should localize, but keep the `errors.*` key names identical.

- [ ] **Step 2: Validate JSON**

```bash
for f in messages/*.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || { echo "BAD: $f"; exit 1; }
done
```
Expected: all parse.

- [ ] **Step 3: Build**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm run build
```
Expected: build completes, no missing-message warnings for the new keys.

- [ ] **Step 4: Commit**

```bash
git add messages/
git commit -m "i18n(cabinet): cabinet + register namespaces ×10 locales"
```

---

## Task 16: Manual verification + deploy

**Files:** none (just deploy).

- [ ] **Step 1: Full test + typecheck + build**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npx vitest run
npx tsc --noEmit
npm run build
```
Expected: all green.

- [ ] **Step 2: Restart web (worker not touched — none of the new files are imported by worker)**

```bash
pm2 restart trientes-web
pm2 save
```

- [ ] **Step 3: Manual flow on live trientes.org**

| # | Step | Expected |
|---|---|---|
| 1 | Open `/en/register` | Form renders |
| 2 | Submit `username=manualtest`, `password=hunter2hunter` | Redirect to `/en/cabinet`; profile section shows username `manualtest`; settings section preserves user defaults |
| 3 | In settings section, change currency to EUR, save | "Saved." appears; reload — EUR still selected |
| 4 | Visit `/en/settings` | 30x → `/en/cabinet#settings`, page scrolls to settings |
| 5 | Logout → `/en/login` | New password form on top, OAuth buttons below |
| 6 | Login with `manualtest` / `hunter2hunter` | Redirect to `/en/cabinet` |
| 7 | Login with `manualtest` / wrong 6× in a row | 6th attempt returns "Too many attempts" error |
| 8 | Login fresh tab via Google | Cabinet shows; `username` was auto-generated; rename it, save, reload — new username persists |
| 9 | COMPANY-type test account → `/en/cabinet` | Redirect to `/en/business` |
| 10 | Visit `/ru/cabinet` while logged in | Russian copy, sections render |

Delete the test user after manual flow:
```bash
npx prisma db execute --stdin <<'SQL'
DELETE FROM "Session" WHERE "userId" IN (SELECT id FROM "User" WHERE username='manualtest');
DELETE FROM "Account" WHERE "userId" IN (SELECT id FROM "User" WHERE username='manualtest');
DELETE FROM "LoginAttempt" WHERE "userId" IN (SELECT id FROM "User" WHERE username='manualtest');
DELETE FROM "User" WHERE username='manualtest';
SQL
```

- [ ] **Step 4: Push**

```bash
git push origin main
```
