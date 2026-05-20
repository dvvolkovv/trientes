# Trientes Phase 5: Watchlist + Coin Requests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Checkbox-tracked.

**Goal:**
1. **Watchlist** — logged-in users star/unstar coins via an icon on each row of the listing and on the coin detail page header. `/[locale]/watchlist` shows the same listing UI filtered to starred coins.
2. **Coin requests** — `/[locale]/request` has a form to submit a "please-add-this-coin" request (name, symbol, optional coingecko id, reason) and a list of the user's own past requests with status (PENDING/APPROVED/REJECTED). Admin review surface is Phase 6 — not this phase.

**Scope confirmations from prior phases / spec:**
- Watchlist toggle button: star icon, visible to everyone but redirects guests to `/login` on click.
- Request form fields: name, symbol, optional coingeckoId, reason (textarea). No CoinGecko id validation on submission (saves API budget; admin will verify in Phase 6).
- Status badges in own-requests list: PENDING / APPROVED / REJECTED.
- No email notifications this phase.
- Auth gating already exists in `src/auth.config.ts` for `/[locale]/{watchlist,request}` (redirects to `/<locale>/login`).

**Reference spec:** `docs/superpowers/specs/2026-05-19-trientes-cmc-clone-design.md` §4, §6, §7.
**Working dir:** `/Users/dmitry/Coinmarketcap`. Server: `dv@85.192.25.242`.

**Carry constraints:**
- `npm` at `$HOME/.nvm/versions/node/v22.19.0/bin/` — set PATH every bash invocation.
- Never `npm run build` / `tsc --noEmit` locally (macOS Tahoe SWC hang).
- `.claude/` is gitignored.

---

## File structure produced

```
prisma/migrations/<ts>_watchlist_requests/
src/
├── lib/
│   ├── watchlist.ts                          # readUserWatchedIds (server helper)
│   └── coin-request.ts                       # validators + insert function (TDD)
├── app/
│   ├── actions/
│   │   ├── watchlist.ts                      # toggleWatchlist server action
│   │   └── coin-request.ts                   # submitCoinRequest server action
│   └── [locale]/
│       ├── page.tsx                          # MODIFY: pass watchedSet + isAuthed to list
│       ├── watchlist/page.tsx                # REPLACE placeholder
│       ├── request/page.tsx                  # REPLACE placeholder
│       └── coin/[slug]/page.tsx              # MODIFY: pass isWatched + isAuthed to header
├── components/
│   ├── watchlist-button.tsx                  # client, star toggle with optimistic UI
│   ├── coin-list-client.tsx                  # MODIFY: accept watchedSet + isAuthed
│   ├── coin-row.tsx                          # MODIFY: 10th td with <WatchlistButton>
│   └── coin-detail/header.tsx                # MODIFY: WatchlistButton next to title
│   └── coin-request-form.tsx                 # client form
│   └── coin-request-list.tsx                 # server, lists user's own requests
tests/
└── coin-request.test.ts                      # validateCoinRequest + insertCoinRequest (TDD)
messages/*.json                                # +watchlist/request strings (10 files)
```

---

## Task 1: Schema — Watchlist + CoinRequest

**Files:** `prisma/schema.prisma`, new migration.

- [ ] **Step 1: Append models + enum** at the end of `prisma/schema.prisma`:

```prisma
enum RequestStatus {
  PENDING
  APPROVED
  REJECTED
}

model Watchlist {
  userId  String
  coinId  String
  addedAt DateTime @default(now())
  user    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  coin    Coin     @relation(fields: [coinId], references: [id], onDelete: Cascade)

  @@id([userId, coinId])
  @@index([userId])
}

model CoinRequest {
  id           String        @id @default(cuid())
  userId       String
  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  symbol       String
  name         String
  coingeckoId  String?
  reason       String        @db.Text
  status       RequestStatus @default(PENDING)
  reviewedAt   DateTime?
  reviewedById String?
  rejectReason String?
  createdAt    DateTime      @default(now())

  @@index([userId, createdAt])
  @@index([status, createdAt])
}
```

- [ ] **Step 2: Add reverse relations to existing models**

In `model User`, append (inside the model block, near `accounts`/`sessions`):
```prisma
  watchlist      Watchlist[]
  coinRequests   CoinRequest[]
```

In `model Coin`, append (inside the model block, near `snapshots`):
```prisma
  watchedBy      Watchlist[]
```

- [ ] **Step 3: Generate + apply migration**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" npx prisma migrate dev --name watchlist_requests
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(db): Watchlist + CoinRequest models"
```

---

## Task 2: CoinRequest validation + insert (TDD)

**Files:** `tests/coin-request.test.ts`, `src/lib/coin-request.ts`.

- [ ] **Step 1: Write tests**

Create `tests/coin-request.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validateCoinRequest } from "@/lib/coin-request";

describe("validateCoinRequest", () => {
  it("accepts a fully valid request", () => {
    expect(
      validateCoinRequest({
        name: "Foobar Chain",
        symbol: "FOO",
        coingeckoId: "foobar",
        reason: "Excellent project to track.",
      }),
    ).toEqual({
      ok: true,
      data: {
        name: "Foobar Chain",
        symbol: "FOO",
        coingeckoId: "foobar",
        reason: "Excellent project to track.",
      },
    });
  });

  it("trims whitespace and uppercases symbol", () => {
    const r = validateCoinRequest({
      name: "  Sample  ",
      symbol: "  sam  ",
      coingeckoId: "  sample-id  ",
      reason: "  good reason  ",
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.data.name).toBe("Sample");
      expect(r.data.symbol).toBe("SAM");
      expect(r.data.coingeckoId).toBe("sample-id");
      expect(r.data.reason).toBe("good reason");
    }
  });

  it("treats empty coingeckoId as null", () => {
    const r = validateCoinRequest({
      name: "X",
      symbol: "X",
      coingeckoId: "   ",
      reason: "ok ok",
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.data.coingeckoId).toBeNull();
  });

  it("rejects missing name", () => {
    expect(validateCoinRequest({ name: "", symbol: "X", reason: "ok ok" })).toEqual({
      ok: false,
      reason: "name_required",
    });
  });

  it("rejects missing symbol", () => {
    expect(validateCoinRequest({ name: "X", symbol: "  ", reason: "ok ok" })).toEqual({
      ok: false,
      reason: "symbol_required",
    });
  });

  it("rejects symbol longer than 12 chars", () => {
    expect(validateCoinRequest({ name: "X", symbol: "TOOOOOOOLONG1", reason: "ok ok" })).toEqual({
      ok: false,
      reason: "symbol_too_long",
    });
  });

  it("rejects reason shorter than 5 chars", () => {
    expect(validateCoinRequest({ name: "X", symbol: "X", reason: "hi" })).toEqual({
      ok: false,
      reason: "reason_too_short",
    });
  });

  it("rejects reason longer than 2000 chars", () => {
    expect(
      validateCoinRequest({
        name: "X",
        symbol: "X",
        reason: "a".repeat(2001),
      }),
    ).toEqual({ ok: false, reason: "reason_too_long" });
  });

  it("rejects malformed coingeckoId", () => {
    expect(
      validateCoinRequest({ name: "X", symbol: "X", coingeckoId: "BAD ID!", reason: "ok ok ok" }),
    ).toEqual({ ok: false, reason: "coingecko_id_invalid" });
  });
});
```

- [ ] **Step 2: Run tests — should fail (module missing)**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test -- tests/coin-request.test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/coin-request.ts`:
```ts
export type CoinRequestInput = {
  name?: string | null;
  symbol?: string | null;
  coingeckoId?: string | null;
  reason?: string | null;
};

export type ValidatedCoinRequest = {
  name: string;
  symbol: string;
  coingeckoId: string | null;
  reason: string;
};

export type CoinRequestReason =
  | "name_required"
  | "symbol_required"
  | "symbol_too_long"
  | "reason_too_short"
  | "reason_too_long"
  | "coingecko_id_invalid";

export type ValidationResult =
  | { ok: true; data: ValidatedCoinRequest }
  | { ok: false; reason: CoinRequestReason };

export function validateCoinRequest(input: CoinRequestInput): ValidationResult {
  const name = (input.name ?? "").trim();
  const symbolRaw = (input.symbol ?? "").trim();
  const reason = (input.reason ?? "").trim();
  const cgRaw = (input.coingeckoId ?? "").trim();

  if (!name) return { ok: false, reason: "name_required" };
  if (!symbolRaw) return { ok: false, reason: "symbol_required" };
  const symbol = symbolRaw.toUpperCase();
  if (symbol.length > 12) return { ok: false, reason: "symbol_too_long" };
  if (reason.length < 5) return { ok: false, reason: "reason_too_short" };
  if (reason.length > 2000) return { ok: false, reason: "reason_too_long" };

  let coingeckoId: string | null = null;
  if (cgRaw) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(cgRaw)) {
      return { ok: false, reason: "coingecko_id_invalid" };
    }
    coingeckoId = cgRaw.toLowerCase();
  }

  return { ok: true, data: { name, symbol, coingeckoId, reason } };
}
```

- [ ] **Step 4: Confirm tests pass + full suite**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(coin-request): input validator with tests"
```

---

## Task 3: Watchlist server action + helper

**Files:** `src/lib/watchlist.ts`, `src/app/actions/watchlist.ts`.

- [ ] **Step 1: Server helper**

Create `src/lib/watchlist.ts`:
```ts
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function readUserWatchedIds(): Promise<Set<string>> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return new Set();
  const rows = await prisma.watchlist.findMany({
    where: { userId },
    select: { coinId: true },
  });
  return new Set(rows.map((r) => r.coinId));
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await auth();
  return Boolean((session?.user as { id?: string } | undefined)?.id);
}
```

- [ ] **Step 2: Server action**

Create `src/app/actions/watchlist.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function toggleWatchlist(coinId: string): Promise<{ ok: boolean; watched?: boolean; reason?: string }> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(coinId)) {
    return { ok: false, reason: "invalid_id" };
  }
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  // Confirm the coin exists.
  const coin = await prisma.coin.findUnique({ where: { id: coinId }, select: { id: true } });
  if (!coin) return { ok: false, reason: "not_found" };

  const existing = await prisma.watchlist.findUnique({
    where: { userId_coinId: { userId, coinId } },
  });
  if (existing) {
    await prisma.watchlist.delete({
      where: { userId_coinId: { userId, coinId } },
    });
    revalidatePath("/", "layout");
    return { ok: true, watched: false };
  }
  await prisma.watchlist.create({ data: { userId, coinId } });
  revalidatePath("/", "layout");
  return { ok: true, watched: true };
}
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(watchlist): toggle server action + readUserWatchedIds helper"
```

---

## Task 4: WatchlistButton client component

**Files:** `src/components/watchlist-button.tsx`.

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toggleWatchlist } from "@/app/actions/watchlist";

type Size = "sm" | "md";

export function WatchlistButton({
  coinId,
  initialWatched,
  isAuthed,
  locale,
  size = "sm",
}: {
  coinId: string;
  initialWatched: boolean;
  isAuthed: boolean;
  locale: string;
  size?: Size;
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [pending, start] = useTransition();
  const router = useRouter();
  const t = useTranslations("watchlist");

  const dims = size === "sm" ? "h-4 w-4" : "h-6 w-6";

  return (
    <button
      type="button"
      aria-label={watched ? t("removeFromWatchlist") : t("addToWatchlist")}
      disabled={pending}
      onClick={(e) => {
        // Prevent the row-level <Link> from navigating when star is clicked.
        e.stopPropagation();
        e.preventDefault();
        if (!isAuthed) {
          router.push(`/${locale}/login`);
          return;
        }
        // Optimistic
        const next = !watched;
        setWatched(next);
        start(async () => {
          const res = await toggleWatchlist(coinId);
          if (!res.ok) {
            // revert on error
            setWatched(!next);
          } else if (res.watched !== undefined) {
            setWatched(res.watched);
          }
        });
      }}
      className={`inline-flex items-center justify-center transition-colors ${watched ? "text-yellow-500 hover:text-yellow-400" : "text-muted-foreground hover:text-foreground"} ${pending ? "opacity-50" : ""}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={watched ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={dims}
        aria-hidden="true"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add -A && git commit -m "feat(ui): WatchlistButton (star toggle, optimistic, redirects guests to login)"
```

---

## Task 5: Wire WatchlistButton into listing + detail

**Files:** `src/components/coin-row.tsx`, `src/components/coin-list-client.tsx`, `src/app/[locale]/page.tsx`, `src/components/coin-detail/header.tsx`, `src/app/[locale]/coin/[slug]/page.tsx`.

- [ ] **Step 1: Update `CoinRow` to accept watchlist props + render the button**

In `src/components/coin-row.tsx`, change the props type to add:
```ts
isWatched: boolean;
isAuthed: boolean;
```
Then add a tenth `<td>` at the end:
```tsx
<td className="px-3 py-3 text-right">
  <WatchlistButton
    coinId={row.id}
    initialWatched={isWatched}
    isAuthed={isAuthed}
    locale={locale}
  />
</td>
```
And add the import:
```tsx
import { WatchlistButton } from "./watchlist-button";
```

- [ ] **Step 2: Update `CoinListClient` to thread the props**

Add to props:
```ts
watchedSet: Set<string>;
isAuthed: boolean;
```
And pass them to each `<CoinRow ... isWatched={watchedSet.has(row.id)} isAuthed={isAuthed} />`.

Also add an empty 10th `<th>` to the table header so columns align:
```tsx
<th className="px-3 py-2 font-medium" />
```

- [ ] **Step 3: Update home page to fetch watched IDs + auth status**

In `src/app/[locale]/page.tsx`, change the parallel fetch to include the two new values:
```tsx
import { readUserWatchedIds, isAuthenticated } from "@/lib/watchlist";

// inside the page component, replace the existing Promise.all:
const [rows, stats, rates, currency, watchedSet, isAuthed] = await Promise.all([
  readTop100(),
  readGlobalStats(),
  readExchangeRates(),
  getCurrency(),
  readUserWatchedIds(),
  isAuthenticated(),
]);
```
Then pass to `<CoinListClient ... watchedSet={watchedSet} isAuthed={isAuthed} />`.

- [ ] **Step 4: Wire into detail page header**

In `src/components/coin-detail/header.tsx`, add to props:
```ts
isWatched: boolean;
isAuthed: boolean;
locale: string;
```
Then render `<WatchlistButton coinId={row.id} initialWatched={isWatched} isAuthed={isAuthed} locale={locale} size="md" />` next to the `<h1>`.

In `src/app/[locale]/coin/[slug]/page.tsx`, fetch the two values and pass to header:
```tsx
import { readUserWatchedIds, isAuthenticated } from "@/lib/watchlist";

// after computing `row` and before returning JSX:
const [currency, rates, watchedSet, isAuthed] = await Promise.all([
  getCurrency(),
  readExchangeRates(),
  readUserWatchedIds(),
  isAuthenticated(),
]);
const isWatched = watchedSet.has(coin.id);

// Then:
// <CoinHeader row={row} currency={currency} rates={rates} isWatched={isWatched} isAuthed={isAuthed} locale={locale} />
```

- [ ] **Step 5: Run tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: still green (changes are wiring only).

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(ui): watchlist toggle on every row + detail header"
```

---

## Task 6: Watchlist page

**Files:** `src/app/[locale]/watchlist/page.tsx`.

- [ ] **Step 1: Replace the existing placeholder**

```tsx
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { readTop100, readExchangeRates } from "@/lib/snapshot";
import { getCurrency } from "@/lib/get-currency";
import { readUserWatchedIds, isAuthenticated } from "@/lib/watchlist";
import { CoinListClient } from "@/components/coin-list-client";

export const dynamic = "force-dynamic";

export default async function WatchlistPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const isAuthed = await isAuthenticated();
  if (!isAuthed) redirect(`/${locale}/login`);

  const t = await getTranslations("watchlist");
  const tl = await getTranslations("listing");

  const [allRows, rates, currency, watchedSet] = await Promise.all([
    readTop100(),
    readExchangeRates(),
    getCurrency(),
    readUserWatchedIds(),
  ]);
  const rows = allRows.filter((r) => watchedSet.has(r.id));

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </header>
      {rows.length > 0 ? (
        <CoinListClient
          rows={rows}
          currency={currency}
          rates={rates}
          locale={locale}
          watchedSet={watchedSet}
          isAuthed={true}
        />
      ) : (
        <div className="border rounded-lg p-12 text-center">
          <p className="text-muted-foreground mb-3">{t("empty")}</p>
          <Link href={`/${locale}`} className="text-primary hover:underline">
            {t("browse")}
          </Link>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add -A && git commit -m "feat(watchlist): /[locale]/watchlist page (filtered listing)"
```

---

## Task 7: Coin-request server action

**Files:** `src/app/actions/coin-request.ts`.

- [ ] **Step 1: Implement**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validateCoinRequest } from "@/lib/coin-request";

const MAX_PENDING_PER_USER = 10;

export async function submitCoinRequest(input: {
  name: string;
  symbol: string;
  coingeckoId?: string;
  reason: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const validated = validateCoinRequest(input);
  if (!validated.ok) return { ok: false, reason: validated.reason };

  // Anti-spam: limit pending requests per user.
  const pendingCount = await prisma.coinRequest.count({
    where: { userId, status: "PENDING" },
  });
  if (pendingCount >= MAX_PENDING_PER_USER) {
    return { ok: false, reason: "too_many_pending" };
  }

  await prisma.coinRequest.create({
    data: {
      userId,
      name: validated.data.name,
      symbol: validated.data.symbol,
      coingeckoId: validated.data.coingeckoId,
      reason: validated.data.reason,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 2: Commit**
```bash
git add -A && git commit -m "feat(coin-request): submit server action with rate-limit (10 pending/user)"
```

---

## Task 8: Request page (form + own list)

**Files:** `src/components/coin-request-form.tsx`, `src/components/coin-request-list.tsx`, `src/app/[locale]/request/page.tsx`.

- [ ] **Step 1: Form (client)**

`src/components/coin-request-form.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitCoinRequest } from "@/app/actions/coin-request";

export function CoinRequestForm() {
  const t = useTranslations("request");
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [coingeckoId, setCoingeckoId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await submitCoinRequest({ name, symbol, coingeckoId, reason });
          if (res.ok) {
            setDone(true);
            setName("");
            setSymbol("");
            setCoingeckoId("");
            setReason("");
            router.refresh();
          } else {
            setError(res.reason ?? "unknown_error");
          }
        });
      }}
    >
      <div>
        <Label htmlFor="rq-name">{t("name")}</Label>
        <Input id="rq-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
      </div>
      <div>
        <Label htmlFor="rq-symbol">{t("symbol")}</Label>
        <Input id="rq-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} required maxLength={12} />
      </div>
      <div>
        <Label htmlFor="rq-cg">{t("coingeckoIdOptional")}</Label>
        <Input
          id="rq-cg"
          value={coingeckoId}
          onChange={(e) => setCoingeckoId(e.target.value)}
          placeholder="e.g. bitcoin"
          maxLength={80}
        />
      </div>
      <div>
        <Label htmlFor="rq-reason">{t("reason")}</Label>
        <textarea
          id="rq-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={5}
          maxLength={2000}
          rows={4}
          className="w-full border rounded-md p-2 text-sm bg-background"
        />
      </div>
      {error && <p className="text-red-500 text-sm">{t(`errors.${error}`)}</p>}
      {done && <p className="text-green-600 text-sm">{t("submitted")}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Own-requests list (server)**

`src/components/coin-request-list.tsx`:
```tsx
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type ReqRow = {
  id: string;
  name: string;
  symbol: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason: string | null;
  createdAt: Date;
};

function badgeCls(status: ReqRow["status"]): string {
  switch (status) {
    case "PENDING":
      return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
    case "APPROVED":
      return "bg-green-500/15 text-green-700 dark:text-green-400";
    case "REJECTED":
      return "bg-red-500/15 text-red-700 dark:text-red-400";
  }
}

export async function CoinRequestList() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return null;

  const rows = (await prisma.coinRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      symbol: true,
      reason: true,
      status: true,
      rejectReason: true,
      createdAt: true,
    },
  })) as ReqRow[];

  const t = await getTranslations("request");
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("noRequestsYet")}</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="border rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">{r.name}</span>
            <span className="text-xs text-muted-foreground uppercase">{r.symbol}</span>
            <span className={`ml-auto px-2 py-0.5 text-xs rounded ${badgeCls(r.status)}`}>
              {t(`status.${r.status}`)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{r.reason}</p>
          {r.status === "REJECTED" && r.rejectReason && (
            <p className="text-sm text-red-500">
              {t("rejectReasonLabel")}: {r.rejectReason}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{r.createdAt.toISOString().slice(0, 10)}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Page**

`src/app/[locale]/request/page.tsx` (replace placeholder):
```tsx
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isAuthenticated } from "@/lib/watchlist";
import { CoinRequestForm } from "@/components/coin-request-form";
import { CoinRequestList } from "@/components/coin-request-list";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const isAuthed = await isAuthenticated();
  if (!isAuthed) redirect(`/${locale}/login`);

  const t = await getTranslations("request");
  return (
    <main className="container mx-auto px-4 py-8 max-w-2xl space-y-10">
      <header>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </header>
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("newRequest")}</h2>
        <CoinRequestForm />
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("yourRequests")}</h2>
        <CoinRequestList />
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(request): submit form + own-requests list page"
```

---

## Task 9: i18n strings for new UI

**Files:** all 10 message files in `messages/`.

- [ ] **Step 1: Add `watchlist` + `request` blocks**

For `messages/en.json`, append two new top-level blocks:
```json
"watchlist": {
  "title": "Watchlist",
  "subtitle": "Your starred coins.",
  "addToWatchlist": "Add to watchlist",
  "removeFromWatchlist": "Remove from watchlist",
  "empty": "Your watchlist is empty. Star a coin to add it here.",
  "browse": "Browse coins →"
},
"request": {
  "title": "Request a coin",
  "subtitle": "Suggest a coin we should add. Admins review submissions.",
  "newRequest": "New request",
  "yourRequests": "Your requests",
  "noRequestsYet": "You haven't submitted any requests yet.",
  "name": "Name",
  "symbol": "Symbol",
  "coingeckoIdOptional": "CoinGecko ID (optional)",
  "reason": "Reason / context",
  "submit": "Submit",
  "submitting": "Submitting…",
  "submitted": "Submitted! An admin will review shortly.",
  "rejectReasonLabel": "Rejection reason",
  "status": {
    "PENDING": "Pending",
    "APPROVED": "Approved",
    "REJECTED": "Rejected"
  },
  "errors": {
    "unauth": "Please sign in.",
    "name_required": "Name is required.",
    "symbol_required": "Symbol is required.",
    "symbol_too_long": "Symbol must be 12 characters or fewer.",
    "reason_too_short": "Reason must be at least 5 characters.",
    "reason_too_long": "Reason must be at most 2000 characters.",
    "coingecko_id_invalid": "Invalid CoinGecko ID.",
    "too_many_pending": "You have too many pending requests.",
    "unknown_error": "Something went wrong."
  }
}
```

Add `watchlist` block to all 9 other locales — translations (use these; keys identical, falling back to English where uncertain):

- **ru:**
```json
"watchlist": {"title":"Избранное","subtitle":"Ваши отмеченные монеты.","addToWatchlist":"Добавить в избранное","removeFromWatchlist":"Убрать из избранного","empty":"Избранное пусто. Отметьте монету звёздочкой, чтобы добавить.","browse":"К списку монет →"},
"request": {"title":"Предложить монету","subtitle":"Предложите монету для добавления. Заявки проверяет администратор.","newRequest":"Новая заявка","yourRequests":"Ваши заявки","noRequestsYet":"Вы пока не подавали заявок.","name":"Название","symbol":"Символ","coingeckoIdOptional":"CoinGecko ID (необязательно)","reason":"Причина / контекст","submit":"Отправить","submitting":"Отправка…","submitted":"Отправлено! Заявка скоро будет рассмотрена.","rejectReasonLabel":"Причина отклонения","status":{"PENDING":"Ожидает","APPROVED":"Принято","REJECTED":"Отклонено"},"errors":{"unauth":"Войдите в аккаунт.","name_required":"Укажите название.","symbol_required":"Укажите символ.","symbol_too_long":"Символ не длиннее 12 символов.","reason_too_short":"Причина — минимум 5 символов.","reason_too_long":"Причина — максимум 2000 символов.","coingecko_id_invalid":"Неверный CoinGecko ID.","too_many_pending":"Слишком много ожидающих заявок.","unknown_error":"Что-то пошло не так."}}
```

- **zh-CN, es, ja, ko, de, fr, pt-BR, tr** — translate the visible labels into the target language. For status enum keep capitalized markers (Pending/Approved/Rejected) translated. The `errors.*` keys can fall back to English if uncertain. The shape MUST match en.json exactly.

For brevity in this plan, follow these short pivots when picking translations:

| Key | zh-CN | es | ja | ko | de | fr | pt-BR | tr |
|-----|-------|-----|----|----|------|-----|--------|----|
| title (watchlist) | 收藏 | Favoritos | お気に入り | 관심목록 | Watchlist | Favoris | Favoritos | İzleme listesi |
| addToWatchlist | 添加到收藏 | Añadir a favoritos | お気に入りに追加 | 관심목록 추가 | Zur Watchlist | Ajouter aux favoris | Adicionar | İzleme listesine ekle |
| removeFromWatchlist | 取消收藏 | Quitar de favoritos | お気に入りから削除 | 관심목록 제거 | Aus Watchlist | Retirer | Remover | Listeden çıkar |
| empty | 收藏夹为空。点击星标添加。 | Tu lista está vacía. Marca una moneda con estrella. | お気に入りは空です。星マークで追加してください。 | 관심목록이 비었습니다. 별표로 추가하세요. | Watchlist leer. Münze mit Stern markieren. | Liste vide. Cliquez sur l'étoile pour ajouter. | Lista vazia. Marque uma moeda com estrela. | İzleme listeniz boş. Yıldız ile ekleyin. |
| browse | 浏览币种 → | Ver monedas → | コインを見る → | 코인 둘러보기 → | Coins ansehen → | Voir les monnaies → | Ver moedas → | Coinleri gözat → |
| title (request) | 申请添加币种 | Solicitar moneda | コインをリクエスト | 코인 요청 | Coin vorschlagen | Proposer une monnaie | Solicitar moeda | Coin öner |
| status.PENDING | 待审核 | Pendiente | 審査中 | 검토 중 | Wartend | En attente | Pendente | Beklemede |
| status.APPROVED | 已通过 | Aprobado | 承認済み | 승인됨 | Genehmigt | Approuvé | Aprovado | Onaylandı |
| status.REJECTED | 已拒绝 | Rechazado | 却下 | 거부됨 | Abgelehnt | Rejeté | Rejeitado | Reddedildi |
| submit | 提交 | Enviar | 送信 | 제출 | Absenden | Envoyer | Enviar | Gönder |
| submitting | 提交中… | Enviando… | 送信中… | 제출 중… | Wird gesendet… | Envoi… | Enviando… | Gönderiliyor… |
| submitted | 已提交！管理员将很快审核。 | Enviado. Un administrador lo revisará. | 送信しました。管理者が確認します。 | 제출했습니다. 관리자가 검토합니다. | Eingereicht. Admin prüft in Kürze. | Envoyé. Un admin va vérifier. | Enviado. Um admin vai revisar. | Gönderildi. Yönetici inceleyecek. |

For other request keys (name, symbol, coingeckoIdOptional, reason, newRequest, yourRequests, noRequestsYet, rejectReasonLabel, errors.*) — translate the visible text; errors can fall back to English if uncertain. The shape MUST be identical across all 10 files.

- [ ] **Step 2: Run all tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(i18n): watchlist + request strings in 10 locales"
```

---

## Task 10: Deploy + smoke

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

- [ ] **Step 3: Restart web only (worker untouched)**
```bash
ssh dv@85.192.25.242 'pm2 restart trientes-web && pm2 status'
```

- [ ] **Step 4: Anonymous user — watchlist redirects to login**
```bash
curl -s -o /dev/null -w "%{http_code}\n" -L http://85.192.25.242/en/watchlist
curl -s -o /dev/null -w "%{http_code}\n" -L http://85.192.25.242/en/request
# Final after redirects = 200 (login page). What matters is /watchlist itself returns 307.
curl -s -o /dev/null -w "%{http_code}\n" http://85.192.25.242/en/watchlist
curl -s -o /dev/null -w "%{http_code}\n" http://85.192.25.242/en/request
```
Expected: redirect (307) for anon; both end up at the login page when followed.

- [ ] **Step 5: Star icon renders on every listing row**
```bash
curl -s http://85.192.25.242/en | grep -oE 'aria-label="Add to watchlist"' | wc -l
```
Expected: 99 (one per row).

- [ ] **Step 6: Star icon on detail page header**
```bash
curl -s http://85.192.25.242/en/coin/bitcoin | grep -oE 'aria-label="Add to watchlist"' | head -1
```
Expected: one match.

- [ ] **Step 7: Health, locales, listing still working**
```bash
curl -s http://85.192.25.242/api/health | python3 -m json.tool
for L in en ru zh-CN; do
  echo "$L → $(curl -s -o /dev/null -w "%{http_code}" "http://85.192.25.242/$L")"
done
curl -s http://85.192.25.242/en | grep -oE 'Bitcoin' | head -1
```

- [ ] **Step 8: Local test suite**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
npm test
```

## Done criteria

- [ ] Migration `watchlist_requests` applied on server
- [ ] Star icons render on every row of `/en` (99 of them) + on `/en/coin/bitcoin` header
- [ ] Anonymous request to `/en/watchlist` returns 307 redirect (or follows to login)
- [ ] `/en/request` shows the form and "your requests" empty state when authenticated
- [ ] All unit tests pass (65 prior + ~9 new coin-request tests)

**Out of scope (Phase 6+):**
- Admin moderation surface (`/admin/coins`, `/admin/requests`, `/admin/users`) — Phase 6
- Email notifications on approve/reject — Phase 7
- Coin-request "auto-fill from CoinGecko" if user types a valid id — Phase 6
