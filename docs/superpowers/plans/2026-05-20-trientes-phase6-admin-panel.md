# Trientes Phase 6: Admin Panel

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox-tracked.

**Goal:** ADMIN role gets three management pages:
1. **`/[locale]/admin/requests`** — review pending coin-add requests; approve (creates a `Coin` row, marks request APPROVED) or reject with a reason (REJECTED).
2. **`/[locale]/admin/coins`** — list of all coins with `isActive` toggle and a "Add coin by CoinGecko id" form.
3. **`/[locale]/admin/users`** — list of users with role toggle (USER↔ADMIN), searchable by email.

All three are already gated to `role === "ADMIN"` by middleware (`src/auth.config.ts`); we add a defense-in-depth check in the admin layout too. Bootstrapping: `ADMIN_WHITELIST=email:dvvolkovv@gmail.com` is already set on the server, so first login as that email promotes to ADMIN automatically.

**Trade-off explicitly accepted:** approved admin-added coins do NOT immediately get priced. The home-page listing only shows coins that have a recent `CoinSnapshot`, which today is only produced by `price-sync` against `category=layer-1`. **Admin-added coins won't appear on the public listing until Phase 7 adds a `/simple/price?ids=...` sync path for them.** They show up on `/admin/coins` and (after `metadata-sync` fills them) on a direct `/coin/<slug>` URL.

**Reference spec:** `docs/superpowers/specs/2026-05-19-trientes-cmc-clone-design.md` §6, §7.
**Working dir:** `/Users/dmitry/Coinmarketcap`. Server: `dv@85.192.25.242`.

**Carry constraints (from prior phases):**
- `npm` at `$HOME/.nvm/versions/node/v22.19.0/bin/` — set PATH in every bash invocation.
- Never `npm run build` / `tsc --noEmit` locally (macOS Tahoe SWC hang).
- `.claude/` is gitignored.

---

## File structure produced

```
prisma/migrations/<ts>_admin_attribution/
src/
├── lib/
│   ├── admin/
│   │   ├── approve-request.ts        # approveRequestCore (TDD)
│   │   └── set-user-role.ts          # setUserRoleCore (TDD)
│   └── is-admin.ts                   # server: requireAdmin()
├── app/
│   ├── actions/
│   │   ├── admin-requests.ts         # approveRequest, rejectRequest
│   │   ├── admin-coins.ts            # toggleCoinActive, addAdminCoin
│   │   └── admin-users.ts            # setUserRole
│   └── [locale]/admin/
│       ├── layout.tsx                # tabs + role check
│       ├── page.tsx                  # redirect to /admin/requests
│       ├── coins/page.tsx            # NEW (replaces Phase 1 placeholder)
│       ├── requests/page.tsx         # NEW
│       └── users/page.tsx            # NEW
└── components/
    ├── admin/
    │   ├── nav.tsx                   # tabs (Requests / Coins / Users)
    │   ├── request-row.tsx           # client: approve + reject buttons
    │   ├── add-coin-form.tsx         # client: input + submit
    │   ├── coin-row-admin.tsx        # server (but contains client toggle)
    │   ├── coin-active-toggle.tsx    # client island for isActive switch
    │   ├── user-role-toggle.tsx      # client
    │   └── search-input.tsx          # client wrapper for ?q= search
tests/
└── admin-core.test.ts                # approveRequestCore + setUserRoleCore
messages/*.json                        # +admin block (10 files)
```

---

## Task 1: Schema — admin attribution fields

**Files:** `prisma/schema.prisma`, new migration.

- [ ] **Step 1:** Add fields to `Coin` model (inside the model block):

```prisma
  addedByAdminId        String?
  approvedFromRequestId String?     @unique
  addedBy               User?       @relation("AdminCoinAdditions", fields: [addedByAdminId], references: [id])
  approvedFromRequest   CoinRequest? @relation("CoinRequestApproved", fields: [approvedFromRequestId], references: [id])
```

- [ ] **Step 2:** Update `User` model to include the reverse:

```prisma
  adminAddedCoins Coin[]   @relation("AdminCoinAdditions")
  reviewedRequests CoinRequest[] @relation("RequestReviewer")
```

- [ ] **Step 3:** Update `CoinRequest` model:

Add the reverse relation for reviewer + approved coin:
```prisma
  reviewer       User?  @relation("RequestReviewer", fields: [reviewedById], references: [id])
  approvedCoin   Coin?  @relation("CoinRequestApproved")
```

- [ ] **Step 4:** Generate and apply migration:

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" npx prisma migrate dev --name admin_attribution
```

- [ ] **Step 5:** Commit:
```bash
git add -A && git commit -m "feat(db): admin attribution on Coin (addedBy, approvedFromRequest)"
```

---

## Task 2: `requireAdmin` server helper

**Files:** `src/lib/is-admin.ts`.

- [ ] **Step 1: Implement**

```ts
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export type AdminCheckResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "unauth" | "not_admin" };

export async function checkAdmin(): Promise<AdminCheckResult> {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) return { ok: false, reason: "unauth" };
  if (user.role !== "ADMIN") return { ok: false, reason: "not_admin" };
  return { ok: true, userId: user.id };
}

export async function requireAdmin(redirectLocale: string): Promise<string> {
  const r = await checkAdmin();
  if (!r.ok) redirect(`/${redirectLocale}/login`);
  return r.userId;
}
```

- [ ] **Step 2: Commit**
```bash
git add -A && git commit -m "feat(admin): requireAdmin/checkAdmin server helpers"
```

---

## Task 3: `approveRequestCore` + `setUserRoleCore` (TDD)

**Files:** `tests/admin-core.test.ts`, `src/lib/admin/approve-request.ts`, `src/lib/admin/set-user-role.ts`.

- [ ] **Step 1: Tests** — `tests/admin-core.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { approveRequestCore } from "@/lib/admin/approve-request";
import { setUserRoleCore } from "@/lib/admin/set-user-role";

function makeFakePrisma() {
  const requests: Record<string, {
    id: string; userId: string; name: string; symbol: string; coingeckoId: string | null;
    status: "PENDING" | "APPROVED" | "REJECTED"; reviewedById: string | null; reviewedAt: Date | null; rejectReason: string | null;
  }> = {};
  const coins: Record<string, {
    id: string; symbol: string; name: string; slug: string; rank: number; source: string;
    addedByAdminId: string | null; approvedFromRequestId: string | null; isActive: boolean;
  }> = {};
  const users: Record<string, { id: string; role: "USER" | "ADMIN" }> = {};

  return {
    state: { requests, coins, users },
    prisma: {
      coinRequest: {
        findUnique: vi.fn(async ({ where }: any) => requests[where.id] ?? null),
        update: vi.fn(async ({ where, data }: any) => {
          requests[where.id] = { ...requests[where.id], ...data };
          return requests[where.id];
        }),
      },
      coin: {
        findUnique: vi.fn(async ({ where }: any) => coins[where.id] ?? null),
        create: vi.fn(async ({ data }: any) => {
          coins[data.id] = data;
          return data;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          coins[where.id] = { ...coins[where.id], ...data };
          return coins[where.id];
        }),
      },
      user: {
        findUnique: vi.fn(async ({ where }: any) => users[where.id] ?? null),
        update: vi.fn(async ({ where, data }: any) => {
          users[where.id] = { ...users[where.id], ...data };
          return users[where.id];
        }),
        count: vi.fn(async ({ where }: any) => {
          if (where.role === "ADMIN") return Object.values(users).filter((u) => u.role === "ADMIN").length;
          return Object.keys(users).length;
        }),
      },
    },
  };
}

describe("approveRequestCore", () => {
  it("creates Coin and marks request APPROVED", async () => {
    const fake = makeFakePrisma();
    fake.state.requests["r1"] = {
      id: "r1", userId: "user1", name: "Foo Chain", symbol: "FOO",
      coingeckoId: "foo-chain", status: "PENDING",
      reviewedById: null, reviewedAt: null, rejectReason: null,
    };

    const res = await approveRequestCore(fake.prisma as never, {
      requestId: "r1",
      reviewerId: "admin1",
      coingeckoIdOverride: undefined,
    });

    expect(res).toMatchObject({ ok: true, coinId: "foo-chain" });
    expect(fake.state.coins["foo-chain"]).toMatchObject({
      id: "foo-chain", symbol: "FOO", name: "Foo Chain",
      source: "ADMIN_ADDED", addedByAdminId: "admin1",
      approvedFromRequestId: "r1", isActive: true,
    });
    expect(fake.state.requests["r1"].status).toBe("APPROVED");
    expect(fake.state.requests["r1"].reviewedById).toBe("admin1");
  });

  it("uses coingeckoIdOverride when provided", async () => {
    const fake = makeFakePrisma();
    fake.state.requests["r2"] = {
      id: "r2", userId: "u", name: "Bar", symbol: "BAR",
      coingeckoId: null, status: "PENDING",
      reviewedById: null, reviewedAt: null, rejectReason: null,
    };

    const res = await approveRequestCore(fake.prisma as never, {
      requestId: "r2", reviewerId: "admin1", coingeckoIdOverride: "bar-correct-id",
    });

    expect(res).toMatchObject({ ok: true, coinId: "bar-correct-id" });
    expect(fake.state.coins["bar-correct-id"]).toBeDefined();
  });

  it("returns no_coingecko_id when neither request nor override has one", async () => {
    const fake = makeFakePrisma();
    fake.state.requests["r3"] = {
      id: "r3", userId: "u", name: "X", symbol: "X", coingeckoId: null,
      status: "PENDING", reviewedById: null, reviewedAt: null, rejectReason: null,
    };
    const res = await approveRequestCore(fake.prisma as never, {
      requestId: "r3", reviewerId: "a", coingeckoIdOverride: "",
    });
    expect(res).toEqual({ ok: false, reason: "no_coingecko_id" });
  });

  it("returns not_pending when request already processed", async () => {
    const fake = makeFakePrisma();
    fake.state.requests["r4"] = {
      id: "r4", userId: "u", name: "Y", symbol: "Y", coingeckoId: "y",
      status: "APPROVED", reviewedById: null, reviewedAt: null, rejectReason: null,
    };
    expect(
      await approveRequestCore(fake.prisma as never, { requestId: "r4", reviewerId: "a" }),
    ).toEqual({ ok: false, reason: "not_pending" });
  });

  it("returns not_found when request id unknown", async () => {
    const fake = makeFakePrisma();
    expect(
      await approveRequestCore(fake.prisma as never, { requestId: "rnope", reviewerId: "a" }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns coin_exists when the target id is already a known coin", async () => {
    const fake = makeFakePrisma();
    fake.state.coins["bitcoin"] = {
      id: "bitcoin", symbol: "BTC", name: "Bitcoin", slug: "bitcoin",
      rank: 1, source: "AUTO_L1", addedByAdminId: null,
      approvedFromRequestId: null, isActive: true,
    };
    fake.state.requests["r5"] = {
      id: "r5", userId: "u", name: "Bitcoin", symbol: "BTC", coingeckoId: "bitcoin",
      status: "PENDING", reviewedById: null, reviewedAt: null, rejectReason: null,
    };
    expect(
      await approveRequestCore(fake.prisma as never, { requestId: "r5", reviewerId: "a" }),
    ).toEqual({ ok: false, reason: "coin_exists" });
  });

  it("normalises coingeckoIdOverride to lowercase, trims whitespace", async () => {
    const fake = makeFakePrisma();
    fake.state.requests["r6"] = {
      id: "r6", userId: "u", name: "Q", symbol: "Q", coingeckoId: null,
      status: "PENDING", reviewedById: null, reviewedAt: null, rejectReason: null,
    };
    const res = await approveRequestCore(fake.prisma as never, {
      requestId: "r6", reviewerId: "a", coingeckoIdOverride: "  My-Coin  ",
    });
    expect(res).toMatchObject({ ok: true, coinId: "my-coin" });
  });
});

describe("setUserRoleCore", () => {
  it("promotes USER to ADMIN", async () => {
    const fake = makeFakePrisma();
    fake.state.users["u1"] = { id: "u1", role: "USER" };
    fake.state.users["admin1"] = { id: "admin1", role: "ADMIN" };
    const res = await setUserRoleCore(fake.prisma as never, {
      userId: "u1", role: "ADMIN", actorId: "admin1",
    });
    expect(res).toEqual({ ok: true });
    expect(fake.state.users["u1"].role).toBe("ADMIN");
  });

  it("demotes ADMIN to USER", async () => {
    const fake = makeFakePrisma();
    fake.state.users["a1"] = { id: "a1", role: "ADMIN" };
    fake.state.users["a2"] = { id: "a2", role: "ADMIN" };
    const res = await setUserRoleCore(fake.prisma as never, {
      userId: "a1", role: "USER", actorId: "a2",
    });
    expect(res).toEqual({ ok: true });
    expect(fake.state.users["a1"].role).toBe("USER");
  });

  it("refuses to demote the last admin", async () => {
    const fake = makeFakePrisma();
    fake.state.users["only-admin"] = { id: "only-admin", role: "ADMIN" };
    const res = await setUserRoleCore(fake.prisma as never, {
      userId: "only-admin", role: "USER", actorId: "only-admin",
    });
    expect(res).toEqual({ ok: false, reason: "last_admin" });
    expect(fake.state.users["only-admin"].role).toBe("ADMIN");
  });

  it("returns not_found for unknown user", async () => {
    const fake = makeFakePrisma();
    const res = await setUserRoleCore(fake.prisma as never, {
      userId: "nope", role: "ADMIN", actorId: "a",
    });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });
});
```

- [ ] **Step 2: Implement `approveRequestCore`**

`src/lib/admin/approve-request.ts`:
```ts
type CoinRow = {
  id: string; symbol: string; name: string; slug: string; rank: number;
  source: string; isActive: boolean; addedByAdminId: string | null;
  approvedFromRequestId: string | null;
};
type ReqRow = {
  id: string; userId: string; name: string; symbol: string;
  coingeckoId: string | null; status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedById: string | null; reviewedAt: Date | null; rejectReason: string | null;
};

type PrismaLike = {
  coinRequest: {
    findUnique(args: { where: { id: string } }): Promise<ReqRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ReqRow>;
  };
  coin: {
    findUnique(args: { where: { id: string } }): Promise<CoinRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<CoinRow>;
  };
};

export type ApproveResult =
  | { ok: true; coinId: string }
  | { ok: false; reason: "not_found" | "not_pending" | "no_coingecko_id" | "coin_exists" };

export async function approveRequestCore(
  prisma: PrismaLike,
  input: { requestId: string; reviewerId: string; coingeckoIdOverride?: string },
): Promise<ApproveResult> {
  const req = await prisma.coinRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return { ok: false, reason: "not_found" };
  if (req.status !== "PENDING") return { ok: false, reason: "not_pending" };

  const overrideTrim = (input.coingeckoIdOverride ?? "").trim().toLowerCase();
  const coinId = overrideTrim || req.coingeckoId || "";
  if (!coinId) return { ok: false, reason: "no_coingecko_id" };

  const existing = await prisma.coin.findUnique({ where: { id: coinId } });
  if (existing) return { ok: false, reason: "coin_exists" };

  await prisma.coin.create({
    data: {
      id: coinId,
      symbol: req.symbol,
      name: req.name,
      slug: coinId,
      rank: 9999,                // sorted to the end until metadata-sync updates it
      source: "ADMIN_ADDED",
      isActive: true,
      addedByAdminId: input.reviewerId,
      approvedFromRequestId: req.id,
    },
  });

  await prisma.coinRequest.update({
    where: { id: req.id },
    data: {
      status: "APPROVED",
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
    },
  });

  return { ok: true, coinId };
}
```

- [ ] **Step 3: Implement `setUserRoleCore`**

`src/lib/admin/set-user-role.ts`:
```ts
type UserRow = { id: string; role: "USER" | "ADMIN" };

type PrismaLike = {
  user: {
    findUnique(args: { where: { id: string } }): Promise<UserRow | null>;
    update(args: { where: { id: string }; data: { role: "USER" | "ADMIN" } }): Promise<UserRow>;
    count(args: { where: { role: "ADMIN" } }): Promise<number>;
  };
};

export type SetRoleResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "last_admin" };

export async function setUserRoleCore(
  prisma: PrismaLike,
  input: { userId: string; role: "USER" | "ADMIN"; actorId: string },
): Promise<SetRoleResult> {
  const u = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!u) return { ok: false, reason: "not_found" };

  if (u.role === "ADMIN" && input.role === "USER") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) return { ok: false, reason: "last_admin" };
  }

  await prisma.user.update({ where: { id: input.userId }, data: { role: input.role } });
  return { ok: true };
}
```

- [ ] **Step 4: Run tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: 74 prior + ~11 new = ~85 passing.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(admin): approveRequestCore + setUserRoleCore with TDD"
```

---

## Task 4: Admin server actions (request, coin, user)

**Files:** `src/app/actions/admin-requests.ts`, `src/app/actions/admin-coins.ts`, `src/app/actions/admin-users.ts`.

- [ ] **Step 1: `admin-requests.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { approveRequestCore } from "@/lib/admin/approve-request";

export async function approveRequest(input: { requestId: string; coingeckoIdOverride?: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const res = await approveRequestCore(prisma as never, {
    requestId: input.requestId,
    reviewerId: admin.userId,
    coingeckoIdOverride: input.coingeckoIdOverride,
  });
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

export async function rejectRequest(input: { requestId: string; rejectReason: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.rejectReason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };

  const req = await prisma.coinRequest.findUnique({ where: { id: input.requestId } });
  if (!req) return { ok: false, reason: "not_found" };
  if (req.status !== "PENDING") return { ok: false, reason: "not_pending" };

  await prisma.coinRequest.update({
    where: { id: req.id },
    data: {
      status: "REJECTED",
      reviewedById: admin.userId,
      reviewedAt: new Date(),
      rejectReason: reason,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 2: `admin-coins.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";

export async function toggleCoinActive(coinId: string) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const c = await prisma.coin.findUnique({ where: { id: coinId }, select: { isActive: true } });
  if (!c) return { ok: false, reason: "not_found" };
  await prisma.coin.update({ where: { id: coinId }, data: { isActive: !c.isActive } });
  revalidatePath("/", "layout");
  return { ok: true, isActive: !c.isActive };
}

export async function addAdminCoin(input: { coingeckoId: string; symbol: string; name: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const id = input.coingeckoId.trim().toLowerCase();
  const symbol = input.symbol.trim().toUpperCase();
  const name = input.name.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { ok: false, reason: "invalid_id" };
  if (!symbol || symbol.length > 12) return { ok: false, reason: "invalid_symbol" };
  if (!name) return { ok: false, reason: "invalid_name" };

  const existing = await prisma.coin.findUnique({ where: { id } });
  if (existing) return { ok: false, reason: "coin_exists" };

  await prisma.coin.create({
    data: {
      id,
      symbol,
      name,
      slug: id,
      rank: 9999,
      source: "ADMIN_ADDED",
      isActive: true,
      addedByAdminId: admin.userId,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true, coinId: id };
}
```

- [ ] **Step 3: `admin-users.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { setUserRoleCore } from "@/lib/admin/set-user-role";

export async function setUserRole(input: { userId: string; role: "USER" | "ADMIN" }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const res = await setUserRoleCore(prisma as never, {
    userId: input.userId,
    role: input.role,
    actorId: admin.userId,
  });
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(admin): server actions (approve/reject, toggle/add coin, set role)"
```

---

## Task 5: Admin layout + nav

**Files:** `src/app/[locale]/admin/layout.tsx`, `src/app/[locale]/admin/page.tsx` (redirect index), `src/components/admin/nav.tsx`.

- [ ] **Step 1: Nav (server component)**

`src/components/admin/nav.tsx`:
```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";

const TABS = [
  { key: "requests", path: "requests" },
  { key: "coins", path: "coins" },
  { key: "users", path: "users" },
];

export async function AdminNav({ locale, active }: { locale: string; active: string }) {
  const t = await getTranslations("admin");
  return (
    <nav className="border-b mb-6">
      <div className="flex gap-1">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/${locale}/admin/${tab.path}`}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              active === tab.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`tabs.${tab.key}`)}
          </Link>
        ))}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Layout**

`src/app/[locale]/admin/layout.tsx`:
```tsx
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { checkAdmin } from "@/lib/is-admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const admin = await checkAdmin();
  if (!admin.ok) redirect(`/${locale}/login`);

  return <div className="container mx-auto px-4 py-8">{children}</div>;
}
```

- [ ] **Step 3: Index redirect**

Replace `src/app/[locale]/admin/page.tsx`:
```tsx
import { redirect } from "next/navigation";

export default async function AdminIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/admin/requests`);
}
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(admin): layout, tabs nav, /admin → /admin/requests redirect"
```

---

## Task 6: `/admin/requests` page

**Files:** `src/components/admin/request-row.tsx`, `src/app/[locale]/admin/requests/page.tsx`.

- [ ] **Step 1: RequestRow client component**

`src/components/admin/request-row.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approveRequest, rejectRequest } from "@/app/actions/admin-requests";

export type RequestRowData = {
  id: string;
  createdAt: string;
  name: string;
  symbol: string;
  coingeckoId: string | null;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason: string | null;
  userEmail: string | null;
};

export function RequestRow({ row }: { row: RequestRowData }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [overrideId, setOverrideId] = useState(row.coingeckoId ?? "");
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectMsg, setRejectMsg] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isPending = row.status === "PENDING";

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-medium">{row.name}</span>
        <span className="text-xs text-muted-foreground uppercase">{row.symbol}</span>
        <span
          className={`ml-auto px-2 py-0.5 text-xs rounded ${
            row.status === "PENDING"
              ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
              : row.status === "APPROVED"
                ? "bg-green-500/15 text-green-700 dark:text-green-400"
                : "bg-red-500/15 text-red-700 dark:text-red-400"
          }`}
        >
          {t(`status.${row.status}`)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{row.reason}</p>
      <p className="text-xs text-muted-foreground">
        {row.userEmail ?? "(no email)"} · {row.createdAt.slice(0, 10)}
      </p>

      {isPending && (
        <>
          <div className="flex items-center gap-2">
            <Input
              value={overrideId}
              onChange={(e) => setOverrideId(e.target.value)}
              placeholder="coingecko-id"
              className="text-sm"
            />
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                setError(null);
                start(async () => {
                  const res = await approveRequest({
                    requestId: row.id,
                    coingeckoIdOverride: overrideId,
                  });
                  if (res.ok) router.refresh();
                  else setError(res.reason ?? "unknown_error");
                });
              }}
            >
              {t("approve")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setRejectMode(!rejectMode)}
            >
              {t("reject")}
            </Button>
          </div>
          {rejectMode && (
            <div className="flex items-center gap-2">
              <Input
                value={rejectMsg}
                onChange={(e) => setRejectMsg(e.target.value)}
                placeholder={t("rejectReasonPlaceholder")}
                className="text-sm"
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={pending || rejectMsg.trim().length < 3}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const res = await rejectRequest({
                      requestId: row.id,
                      rejectReason: rejectMsg,
                    });
                    if (res.ok) router.refresh();
                    else setError(res.reason ?? "unknown_error");
                  });
                }}
              >
                {t("confirmReject")}
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-red-500">{t(`errors.${error}`)}</p>}
        </>
      )}

      {row.status === "REJECTED" && row.rejectReason && (
        <p className="text-sm text-red-500">
          {t("rejectReasonLabel")}: {row.rejectReason}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Page**

`src/app/[locale]/admin/requests/page.tsx`:
```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { RequestRow, type RequestRowData } from "@/components/admin/request-row";

export const dynamic = "force-dynamic";

export default async function AdminRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  const { tab } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("admin");
  const statusFilter =
    tab === "approved" ? "APPROVED" : tab === "rejected" ? "REJECTED" : "PENDING";

  const requests = await prisma.coinRequest.findMany({
    where: { status: statusFilter },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { user: { select: { email: true } } },
  });

  const rows: RequestRowData[] = requests.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    name: r.name,
    symbol: r.symbol,
    coingeckoId: r.coingeckoId,
    reason: r.reason,
    status: r.status,
    rejectReason: r.rejectReason,
    userEmail: r.user?.email ?? null,
  }));

  return (
    <>
      <AdminNav locale={locale} active="requests" />
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("requests.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("requests.subtitle")}</p>
      </header>
      <div className="flex gap-2 mb-4">
        {(["pending", "approved", "rejected"] as const).map((s) => {
          const active =
            (statusFilter === "PENDING" && s === "pending") ||
            (statusFilter === "APPROVED" && s === "approved") ||
            (statusFilter === "REJECTED" && s === "rejected");
          const href = s === "pending" ? "?" : `?tab=${s}`;
          return (
            <a
              key={s}
              href={href}
              className={`px-3 py-1 text-sm rounded ${
                active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`status.${s.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED"}`)}
            </a>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("requests.empty")}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <RequestRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(admin): /admin/requests page with approve/reject"
```

---

## Task 7: `/admin/coins` page

**Files:** `src/components/admin/coin-active-toggle.tsx`, `src/components/admin/add-coin-form.tsx`, `src/app/[locale]/admin/coins/page.tsx`.

- [ ] **Step 1: Toggle component (client)**

`src/components/admin/coin-active-toggle.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleCoinActive } from "@/app/actions/admin-coins";

export function CoinActiveToggle({ coinId, initialActive }: { coinId: string; initialActive: boolean }) {
  const [active, setActive] = useState(initialActive);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const next = !active;
        setActive(next);
        start(async () => {
          const res = await toggleCoinActive(coinId);
          if (!res.ok) {
            setActive(!next); // revert
          } else if (typeof res.isActive === "boolean") {
            setActive(res.isActive);
          }
          router.refresh();
        });
      }}
      className={`px-2 py-1 text-xs rounded ${
        active
          ? "bg-green-500/15 text-green-700 dark:text-green-400"
          : "bg-muted text-muted-foreground"
      } ${pending ? "opacity-50" : ""}`}
    >
      {active ? "Active" : "Disabled"}
    </button>
  );
}
```

- [ ] **Step 2: Add-coin form (client)**

`src/components/admin/add-coin-form.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addAdminCoin } from "@/app/actions/admin-coins";

export function AddCoinForm() {
  const t = useTranslations("admin");
  const router = useRouter();
  const [coingeckoId, setCoingeckoId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <form
      className="flex flex-wrap items-end gap-2 border rounded-lg p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setDone(false);
        start(async () => {
          const res = await addAdminCoin({ coingeckoId, symbol, name });
          if (res.ok) {
            setDone(true);
            setCoingeckoId("");
            setSymbol("");
            setName("");
            router.refresh();
          } else {
            setError(res.reason ?? "unknown_error");
          }
        });
      }}
    >
      <div className="flex-1 min-w-[150px]">
        <label className="text-xs text-muted-foreground">{t("addCoin.coingeckoId")}</label>
        <Input value={coingeckoId} onChange={(e) => setCoingeckoId(e.target.value)} required placeholder="e.g. solana" />
      </div>
      <div className="w-24">
        <label className="text-xs text-muted-foreground">{t("addCoin.symbol")}</label>
        <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} required maxLength={12} />
      </div>
      <div className="flex-1 min-w-[150px]">
        <label className="text-xs text-muted-foreground">{t("addCoin.name")}</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t("addCoin.adding") : t("addCoin.add")}
      </Button>
      {error && <p className="text-sm text-red-500 w-full">{t(`errors.${error}`)}</p>}
      {done && <p className="text-sm text-green-600 w-full">{t("addCoin.added")}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Page**

`src/app/[locale]/admin/coins/page.tsx`:
```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { CoinActiveToggle } from "@/components/admin/coin-active-toggle";
import { AddCoinForm } from "@/components/admin/add-coin-form";

export const dynamic = "force-dynamic";

export default async function AdminCoinsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  const coins = await prisma.coin.findMany({
    orderBy: [{ source: "asc" }, { rank: "asc" }],
    take: 250,
    select: {
      id: true,
      symbol: true,
      name: true,
      rank: true,
      source: true,
      isActive: true,
      logoUrl: true,
      metadataFetchedAt: true,
    },
  });

  return (
    <>
      <AdminNav locale={locale} active="coins" />
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("coins.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("coins.subtitle")}</p>
      </header>

      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">{t("addCoin.heading")}</h2>
        <AddCoinForm />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">{t("coins.name")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("coins.source")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("coins.metadata")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("coins.status")}</th>
            </tr>
          </thead>
          <tbody>
            {coins.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.rank >= 9999 ? "—" : c.rank}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {c.logoUrl && (
                      <img src={c.logoUrl} alt="" width={16} height={16} className="rounded-full" />
                    )}
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground uppercase">{c.symbol}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`px-2 py-0.5 text-xs rounded ${
                      c.source === "AUTO_L1"
                        ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                        : "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                    }`}
                  >
                    {c.source}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {c.metadataFetchedAt ? c.metadataFetchedAt.toISOString().slice(0, 10) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <CoinActiveToggle coinId={c.id} initialActive={c.isActive} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(admin): /admin/coins page with active toggle + add form"
```

---

## Task 8: `/admin/users` page

**Files:** `src/components/admin/user-role-toggle.tsx`, `src/components/admin/search-input.tsx`, `src/app/[locale]/admin/users/page.tsx`.

- [ ] **Step 1: Role toggle**

`src/components/admin/user-role-toggle.tsx`:
```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setUserRole } from "@/app/actions/admin-users";

export function UserRoleToggle({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: "USER" | "ADMIN";
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const next = currentRole === "ADMIN" ? "USER" : "ADMIN";
  return (
    <Button
      size="sm"
      variant={currentRole === "ADMIN" ? "outline" : "default"}
      disabled={pending}
      onClick={() => {
        start(async () => {
          await setUserRole({ userId, role: next });
          router.refresh();
        });
      }}
    >
      {currentRole === "ADMIN" ? "Demote" : "Promote"}
    </Button>
  );
}
```

- [ ] **Step 2: Search input (client)**

`src/components/admin/search-input.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

export function AdminSearchInput({ placeholder }: { placeholder: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const [value, setValue] = useState(sp.get("q") ?? "");
  const [pending, start] = useTransition();
  return (
    <Input
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        setValue(e.target.value);
        start(() => {
          const params = new URLSearchParams(sp);
          if (e.target.value) params.set("q", e.target.value);
          else params.delete("q");
          router.replace(`?${params.toString()}`);
        });
      }}
      className={`max-w-sm ${pending ? "opacity-50" : ""}`}
    />
  );
}
```

- [ ] **Step 3: Page**

`src/app/[locale]/admin/users/page.tsx`:
```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { AdminNav } from "@/components/admin/nav";
import { UserRoleToggle } from "@/components/admin/user-role-toggle";
import { AdminSearchInput } from "@/components/admin/search-input";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  setRequestLocale(locale);

  const admin = await checkAdmin();
  const t = await getTranslations("admin");

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      accounts: { select: { provider: true } },
    },
  });

  return (
    <>
      <AdminNav locale={locale} active="users" />
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("users.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("users.subtitle")}</p>
      </header>

      <div className="mb-4">
        <AdminSearchInput placeholder={t("users.searchPlaceholder")} />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">{t("users.email")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("users.name")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("users.providers")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("users.role")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("users.action")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="px-3 py-2">{u.email ?? "—"}</td>
                <td className="px-3 py-2">{u.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {u.accounts.map((a) => a.provider).join(", ") || "—"}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`px-2 py-0.5 text-xs rounded ${
                      u.role === "ADMIN"
                        ? "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {admin.ok && admin.userId !== u.id && (
                    <UserRoleToggle userId={u.id} currentRole={u.role} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(admin): /admin/users page with role toggle + email search"
```

---

## Task 9: i18n + minor strings

**Files:** all 10 `messages/*.json`.

- [ ] **Step 1: Add `admin` block to `messages/en.json`**

```json
"admin": {
  "tabs": {
    "requests": "Requests",
    "coins": "Coins",
    "users": "Users"
  },
  "status": {
    "PENDING": "Pending",
    "APPROVED": "Approved",
    "REJECTED": "Rejected"
  },
  "approve": "Approve",
  "reject": "Reject",
  "confirmReject": "Confirm reject",
  "rejectReasonPlaceholder": "Why are you rejecting?",
  "rejectReasonLabel": "Rejection reason",
  "requests": {
    "title": "Coin requests",
    "subtitle": "Review and act on user-submitted coin requests.",
    "empty": "No requests in this view."
  },
  "coins": {
    "title": "Coins",
    "subtitle": "Manage tracked coins. Disable to hide from public listings.",
    "name": "Name",
    "source": "Source",
    "metadata": "Metadata fetched",
    "status": "Status"
  },
  "addCoin": {
    "heading": "Add a coin manually",
    "coingeckoId": "CoinGecko ID",
    "symbol": "Symbol",
    "name": "Name",
    "add": "Add",
    "adding": "Adding…",
    "added": "Coin added."
  },
  "users": {
    "title": "Users",
    "subtitle": "Manage roles for registered users.",
    "email": "Email",
    "name": "Name",
    "providers": "Providers",
    "role": "Role",
    "action": "Action",
    "searchPlaceholder": "Search by email or name…"
  },
  "errors": {
    "unauth": "Sign in required.",
    "not_admin": "Admin role required.",
    "not_found": "Not found.",
    "not_pending": "Already processed.",
    "no_coingecko_id": "CoinGecko ID is required.",
    "coin_exists": "A coin with this ID already exists.",
    "reason_too_short": "Reason must be at least 3 characters.",
    "invalid_id": "Invalid ID format.",
    "invalid_symbol": "Invalid symbol.",
    "invalid_name": "Invalid name.",
    "last_admin": "Cannot demote the last admin.",
    "unknown_error": "Something went wrong."
  }
}
```

- [ ] **Step 2: Add the same `admin` block to all 9 other locales with translated visible labels**

Use this pivot for the high-value labels; for the rest, English fallback is acceptable. JSON shape must be identical across all 10 files.

| Key | ru | zh-CN | es | ja | ko | de | fr | pt-BR | tr |
|-----|----|----|----|----|----|----|----|----|----|
| tabs.requests | Заявки | 申请 | Solicitudes | リクエスト | 요청 | Anfragen | Demandes | Solicitações | İstekler |
| tabs.coins | Монеты | 币种 | Monedas | コイン | 코인 | Coins | Monnaies | Moedas | Coinler |
| tabs.users | Пользователи | 用户 | Usuarios | ユーザー | 사용자 | Benutzer | Utilisateurs | Usuários | Kullanıcılar |
| approve | Принять | 通过 | Aprobar | 承認 | 승인 | Genehmigen | Approuver | Aprovar | Onayla |
| reject | Отклонить | 拒绝 | Rechazar | 却下 | 거부 | Ablehnen | Rejeter | Rejeitar | Reddet |
| confirmReject | Подтвердить отказ | 确认拒绝 | Confirmar rechazo | 却下を確定 | 거부 확인 | Ablehnung bestätigen | Confirmer le rejet | Confirmar rejeição | Reddi onayla |
| addCoin.add | Добавить | 添加 | Añadir | 追加 | 추가 | Hinzufügen | Ajouter | Adicionar | Ekle |
| users.searchPlaceholder | Поиск по email или имени… | 按邮箱或姓名搜索… | Buscar por email o nombre… | メール/名前で検索… | 이메일/이름 검색… | Nach E-Mail oder Name… | Recherche email/nom… | Email ou nome… | Email/isim ile ara… |

For status enum (PENDING/APPROVED/REJECTED), reuse the same translations as in the existing `request.status.*` block from Phase 5.

For all other keys: translate visible labels naturally; errors can fall back to English. Required: every locale file MUST have the same key set as en.json.

- [ ] **Step 3: Run tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
```
Expected: still all green.

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(i18n): admin panel strings in 10 locales"
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

- [ ] **Step 3: Restart web (worker untouched)**
```bash
ssh dv@85.192.25.242 'pm2 restart trientes-web && pm2 status'
```

- [ ] **Step 4: Anonymous → all admin routes redirect to login**
```bash
for path in admin admin/requests admin/coins admin/users; do
  echo -n "$path: "
  curl -s -o /dev/null -w "%{http_code}\n" "http://85.192.25.242/en/$path"
done
echo "follow:"
curl -s -o /dev/null -w "%{http_code} url:%{url_effective}\n" -L "http://85.192.25.242/en/admin"
```
Expected: each direct request returns 302/307 (redirect); following lands on `/en/login`.

- [ ] **Step 5: Health + locales still pass**
```bash
curl -s http://85.192.25.242/api/health | python3 -m json.tool
for L in en ru zh-CN ja de; do
  printf "%-6s %s\n" "$L" "$(curl -s -o /dev/null -w "%{http_code}" "http://85.192.25.242/$L")"
done
```

- [ ] **Step 6: Listing + watchlist + request still work**
```bash
curl -s http://85.192.25.242/en | grep -oE '(Bitcoin|Ethereum)' | sort -u
curl -s -o /dev/null -w "watchlist: %{http_code}\n" http://85.192.25.242/en/watchlist
curl -s -o /dev/null -w "request: %{http_code}\n" http://85.192.25.242/en/request
```

- [ ] **Step 7: Local tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
npm test
```
Expected: 74 + ~11 new = ~85 passing.

## Done criteria

- [ ] Migration `admin_attribution` applied on server
- [ ] Anonymous user → 302 redirect to login on `/admin/*` (verified above)
- [ ] All unit tests pass (~85)
- [ ] User can log in via OAuth as `dvvolkovv@gmail.com` and see the admin tabs (manual verification by user)
- [ ] User can approve/reject a Phase 5 test request manually (manual verification by user)

**Out of scope (deferred to Phase 7+):**
- Admin-added coins price-sync via `/simple/price?ids=...` — Phase 7
- Email notifications on approve/reject — Phase 7
- Audit log of admin actions — Phase 8
- Bulk approve/reject — not planned
- Pagination on /admin/coins and /admin/users (currently capped at 100/250 rows) — Phase 8 if needed
