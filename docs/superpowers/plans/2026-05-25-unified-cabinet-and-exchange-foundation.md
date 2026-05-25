# Unified personal cabinet + exchange foundation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn account-type-as-identity (`User.accountType`) into ownership: one user is always a person, and Companies / Exchanges are entities they own from a single `/cabinet`. Add Exchange table + admin moderation as foundation.

**Architecture:** Server-action style (matches the existing `src/app/actions/company.ts` pattern). Pure validation logic in `src/lib/`, server actions in `src/app/actions/`, vitest unit tests in `tests/*.test.ts`. Public-facing pages (coins, `/exchanges` catalog, navigator) are not touched at all.

**Tech Stack:** Next.js (server actions), Prisma, vitest, next-intl (10 locales), Auth.js DB sessions, PM2 (deploy).

**Spec:** `docs/superpowers/specs/2026-05-25-unified-cabinet-and-exchange-foundation-design.md`

---

## File map

**Create:**
- `prisma/migrations/20260525190000_unified_cabinet_and_exchange/migration.sql`
- `src/lib/exchange.ts` — pure validator + helpers (mirrors `src/lib/company.ts`)
- `src/app/actions/exchange.ts` — server actions (mirrors `src/app/actions/company.ts`)
- `src/app/actions/admin-exchange.ts` — admin approve/reject actions
- `src/app/[locale]/cabinet/companies/[id]/page.tsx` — per-company management (rehoused from `/business`)
- `src/app/[locale]/cabinet/exchanges/[id]/page.tsx` — per-exchange management
- `src/app/[locale]/admin/exchanges/page.tsx` — admin moderation queue
- `src/components/cabinet/companies-section.tsx` — `/cabinet#companies` list + "Add" form
- `src/components/cabinet/exchanges-section.tsx` — `/cabinet#exchanges` list + "Add" form
- `src/components/business/exchange-profile-form.tsx` — full edit form for exchange
- `src/components/admin/exchange-row.tsx` — one row in moderation queue
- `tests/exchange.test.ts` — validator unit tests

**Modify:**
- `prisma/schema.prisma` — drop `User.accountType` + `AccountType` enum; drop `@unique` on `Company.ownerUserId`; add `@@index([ownerUserId])`; add `Exchange` model + `ExchangeStatus` enum
- `src/lib/business.ts` — replace 1:1 `getViewerCompany()` with `listViewerCompanies()` + `getViewerCompanyById(id)`
- `src/app/actions/company.ts` — `registerCompany` no longer flips `accountType`; rename to `createCompany`; `saveCompanyProfile` and `submitCompanyPoint` accept a `companyId`
- `src/app/[locale]/cabinet/page.tsx` — remove `accountType` redirect; render new `<CompaniesSection>` + `<ExchangesSection>`
- `src/app/[locale]/business/page.tsx` — replace with redirect to `/{locale}/cabinet#companies`
- `src/app/api/auth/password/register/route.ts` — drop `accountType: "INDIVIDUAL"` field at User create
- `src/components/navbar.tsx` — drop `accountType` lookup; always show "Cabinet" link for logged-in users
- `src/components/admin/nav.tsx` — add "exchanges" tab
- `messages/{en,ru,de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json` — new keys for cabinet.companies, cabinet.exchanges, exchange, admin.tabs.exchanges, admin.exchanges; remove `business.registerIntro`

**Untouched (hard rule from spec):**
- `/`, `/[locale]/coin/*`, `/[locale]/exchanges`, `/[locale]/markets`, `/[locale]/navigator`
- `/api/crypto-map/*` (including `/poi` route — already merges approved CompanyPoints, no change needed)
- The worker (`trientes-worker`) — no `src/lib` files we change are imported by it

---

## Task 1: Prisma migration + schema

**Files:**
- Create: `prisma/migrations/20260525190000_unified_cabinet_and_exchange/migration.sql`
- Modify: `prisma/schema.prisma` (User lines 15–43, Company lines 244–261, AccountType enum lines 232–235)

- [ ] **Step 1: Write the migration SQL**

Create `prisma/migrations/20260525190000_unified_cabinet_and_exchange/migration.sql`:

```sql
-- Drop User.accountType (was: INDIVIDUAL | COMPANY)
ALTER TABLE "User" DROP COLUMN "accountType";
DROP TYPE "AccountType";

-- Allow a user to own multiple companies
ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "Company_ownerUserId_key";
CREATE INDEX "Company_ownerUserId_idx" ON "Company"("ownerUserId");

-- Exchange status enum
CREATE TYPE "ExchangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- Exchange table
CREATE TABLE "Exchange" (
  "id"              TEXT NOT NULL,
  "ownerUserId"     TEXT NOT NULL,
  "legalName"       TEXT NOT NULL,
  "displayName"     TEXT NOT NULL,
  "logoUrl"         TEXT,
  "description"     TEXT,
  "website"         TEXT NOT NULL,
  "country"         TEXT NOT NULL,
  "email"           TEXT NOT NULL,
  "phone"           TEXT,
  "address"         TEXT,
  "socials"         JSONB,
  "status"          "ExchangeStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Exchange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Exchange_ownerUserId_idx" ON "Exchange"("ownerUserId");
CREATE INDEX "Exchange_status_createdAt_idx" ON "Exchange"("status", "createdAt");

ALTER TABLE "Exchange"
  ADD CONSTRAINT "Exchange_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE;
```

- [ ] **Step 2: Edit `prisma/schema.prisma`**

In the `User` model: delete the line `accountType  AccountType @default(INDIVIDUAL)` and any back-relation that referenced AccountType.

Add to User model:

```prisma
  exchanges    Exchange[]
```

(Companies already has `companies Company[]`; if not, also add it.)

Delete the entire `enum AccountType { ... }` block.

In the `Company` model: change `ownerUserId String @unique` → `ownerUserId String`. Add `@@index([ownerUserId])` after the existing `@@index` lines.

Add new models at the bottom of the file (or with the other content models):

```prisma
enum ExchangeStatus {
  PENDING
  APPROVED
  REJECTED
}

model Exchange {
  id              String         @id @default(cuid())
  ownerUserId     String
  owner           User           @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)

  legalName       String
  displayName     String
  logoUrl         String?
  description     String?
  website         String
  country         String
  email           String
  phone           String?
  address         String?
  socials         Json?

  status          ExchangeStatus @default(PENDING)
  rejectionReason String?

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([ownerUserId])
  @@index([status, createdAt])
}
```

- [ ] **Step 3: Apply migration locally**

Run: `npx prisma migrate deploy`
Expected: `Applied 1 migration: 20260525190000_unified_cabinet_and_exchange`

- [ ] **Step 4: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260525190000_unified_cabinet_and_exchange
git commit -m "feat(db): unified cabinet — drop accountType, allow N companies/user, add Exchange"
```

---

## Task 2: Exchange validator + tests

**Files:**
- Create: `src/lib/exchange.ts`
- Create: `tests/exchange.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/exchange.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateExchangeProfile } from "@/lib/exchange";

describe("validateExchangeProfile", () => {
  const base = {
    legalName: "Acme Exchange Ltd",
    displayName: "Acme",
    website: "https://acme.exchange",
    country: "EE",
    email: "ops@acme.exchange",
  };

  it("accepts a minimal valid profile and trims strings", () => {
    const r = validateExchangeProfile({ ...base, legalName: " Acme Exchange Ltd " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.legalName).toBe("Acme Exchange Ltd");
      expect(r.data.displayName).toBe("Acme");
    }
  });

  it("requires legalName, displayName, website, country, email", () => {
    expect(validateExchangeProfile({ ...base, legalName: "" })).toMatchObject({ ok: false, reason: "legal_name_required" });
    expect(validateExchangeProfile({ ...base, displayName: "" })).toMatchObject({ ok: false, reason: "display_name_required" });
    expect(validateExchangeProfile({ ...base, website: "" })).toMatchObject({ ok: false, reason: "website_required" });
    expect(validateExchangeProfile({ ...base, country: "" })).toMatchObject({ ok: false, reason: "country_required" });
    expect(validateExchangeProfile({ ...base, email: "" })).toMatchObject({ ok: false, reason: "email_required" });
  });

  it("rejects a non-http website", () => {
    expect(validateExchangeProfile({ ...base, website: "javascript:alert(1)" }))
      .toMatchObject({ ok: false, reason: "website_invalid" });
  });

  it("rejects a non-http logoUrl", () => {
    expect(validateExchangeProfile({ ...base, logoUrl: "ftp://x/y.png" }))
      .toMatchObject({ ok: false, reason: "logo_invalid" });
  });

  it("accepts an https logoUrl", () => {
    const r = validateExchangeProfile({ ...base, logoUrl: "https://cdn.acme.exchange/logo.png" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.logoUrl).toBe("https://cdn.acme.exchange/logo.png");
  });
});
```

- [ ] **Step 2: Run the test to confirm failure**

Run: `npx vitest run tests/exchange.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/exchange"`.

- [ ] **Step 3: Write the validator**

Create `src/lib/exchange.ts`:

```ts
// Pure validation for exchange profiles. No I/O.

function httpOrNull(raw: string | null | undefined): string | null | "invalid" {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : "invalid";
  } catch {
    return "invalid";
  }
}

export type ExchangeProfileInput = {
  legalName?: string | null;
  displayName?: string | null;
  description?: string | null;
  website?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  logoUrl?: string | null;
  socials?: { network: string; url: string }[] | null;
};

export type ValidatedExchangeProfile = {
  legalName: string;
  displayName: string;
  description: string | null;
  website: string;
  country: string;
  email: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
};

export type ExchangeProfileResult =
  | { ok: true; data: ValidatedExchangeProfile }
  | {
      ok: false;
      reason:
        | "legal_name_required"
        | "display_name_required"
        | "website_required"
        | "website_invalid"
        | "country_required"
        | "email_required"
        | "logo_invalid";
    };

export function validateExchangeProfile(input: ExchangeProfileInput): ExchangeProfileResult {
  const legalName = (input.legalName ?? "").trim();
  if (!legalName) return { ok: false, reason: "legal_name_required" };
  const displayName = (input.displayName ?? "").trim();
  if (!displayName) return { ok: false, reason: "display_name_required" };
  const country = (input.country ?? "").trim();
  if (!country) return { ok: false, reason: "country_required" };
  const email = (input.email ?? "").trim();
  if (!email) return { ok: false, reason: "email_required" };
  const websiteRaw = (input.website ?? "").trim();
  if (!websiteRaw) return { ok: false, reason: "website_required" };
  const website = httpOrNull(websiteRaw);
  if (website === "invalid" || website === null) return { ok: false, reason: "website_invalid" };
  const logoUrl = httpOrNull(input.logoUrl);
  if (logoUrl === "invalid") return { ok: false, reason: "logo_invalid" };
  const t = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    return s ? s : null;
  };
  return {
    ok: true,
    data: {
      legalName,
      displayName,
      description: t(input.description),
      website,
      country,
      email,
      phone: t(input.phone),
      address: t(input.address),
      logoUrl,
    },
  };
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx vitest run tests/exchange.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/exchange.ts tests/exchange.test.ts
git commit -m "feat(exchange): validator with website + logo url checks"
```

---

## Task 3: Exchange server actions

**Files:**
- Create: `src/app/actions/exchange.ts`

- [ ] **Step 1: Implement server actions**

Create `src/app/actions/exchange.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validateExchangeProfile, type ExchangeProfileInput } from "@/lib/exchange";

async function requireUser(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function createExchange(input: ExchangeProfileInput) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const v = validateExchangeProfile(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  const exchange = await prisma.exchange.create({
    data: {
      ownerUserId: userId,
      legalName: v.data.legalName,
      displayName: v.data.displayName,
      description: v.data.description,
      website: v.data.website,
      country: v.data.country,
      email: v.data.email,
      phone: v.data.phone,
      address: v.data.address,
      logoUrl: v.data.logoUrl,
      socials: Array.isArray(input.socials) ? input.socials : undefined,
      status: "PENDING",
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, id: exchange.id };
}

export async function saveExchangeProfile(
  exchangeId: string,
  input: ExchangeProfileInput,
) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const existing = await prisma.exchange.findUnique({ where: { id: exchangeId } });
  if (!existing || existing.ownerUserId !== userId) {
    return { ok: false as const, reason: "not_found" as const };
  }
  const v = validateExchangeProfile(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  // Editing an approved exchange returns it to PENDING (admin must re-approve).
  const nextStatus = existing.status === "APPROVED" ? "PENDING" : existing.status;
  await prisma.exchange.update({
    where: { id: exchangeId },
    data: {
      ...v.data,
      socials: Array.isArray(input.socials) ? input.socials : undefined,
      status: nextStatus,
      rejectionReason: nextStatus === "PENDING" ? null : existing.rejectionReason,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors related to `src/app/actions/exchange.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/exchange.ts
git commit -m "feat(exchange): createExchange + saveExchangeProfile server actions"
```

---

## Task 4: Admin exchange moderation actions + audit

**Files:**
- Create: `src/app/actions/admin-exchange.ts`

- [ ] **Step 1: Look up existing admin audit pattern**

Read `src/app/actions/admin-business.ts` (or wherever `APPROVE_POINT`/`REJECT_POINT` audit actions live — grep first with `grep -r "APPROVE_POINT" src/`). Copy the pattern: ADMIN role check + AdminAuditLog write.

- [ ] **Step 2: Implement admin actions**

Create `src/app/actions/admin-exchange.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "ADMIN") return null;
  return user.id;
}

export async function approveExchange(exchangeId: string) {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false as const, reason: "unauth" as const };
  await prisma.$transaction([
    prisma.exchange.update({
      where: { id: exchangeId },
      data: { status: "APPROVED", rejectionReason: null },
    }),
    prisma.adminAuditLog.create({
      data: {
        adminId,
        action: "APPROVE_EXCHANGE",
        targetType: "EXCHANGE",
        targetId: exchangeId,
      },
    }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function rejectExchange(exchangeId: string, reason: string) {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false as const, reason: "unauth" as const };
  const trimmed = reason.trim();
  if (trimmed.length < 3) return { ok: false as const, reason: "reason_too_short" as const };
  await prisma.$transaction([
    prisma.exchange.update({
      where: { id: exchangeId },
      data: { status: "REJECTED", rejectionReason: trimmed },
    }),
    prisma.adminAuditLog.create({
      data: {
        adminId,
        action: "REJECT_EXCHANGE",
        targetType: "EXCHANGE",
        targetId: exchangeId,
        meta: { reason: trimmed },
      },
    }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true as const };
}
```

(If `AdminAuditLog` does not have a `meta` JSON column, drop the `meta` field from `rejectExchange`. Check the schema before coding.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/admin-exchange.ts
git commit -m "feat(admin): approve/reject exchange + audit log"
```

---

## Task 5: Migrate company actions and helpers to multi-company ownership

**Files:**
- Modify: `src/lib/business.ts`
- Modify: `src/app/actions/company.ts`
- Modify: `tests/company.test.ts` (if it asserts on the old 1:1 behavior — read first)

- [ ] **Step 1: Update `src/lib/business.ts`**

Replace the file contents with:

```ts
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function listViewerCompanies() {
  const userId = await viewerId();
  if (!userId) return { userId: null as string | null, companies: [] };
  const companies = await prisma.company.findMany({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
  });
  return { userId, companies };
}

export async function getViewerCompanyById(companyId: string) {
  const userId = await viewerId();
  if (!userId) return { userId: null as string | null, company: null };
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.ownerUserId !== userId) return { userId, company: null };
  return { userId, company };
}
```

(Remove the old `getViewerCompany()` 1:1 helper; let TypeScript surface the call sites.)

- [ ] **Step 2: Update `src/app/actions/company.ts`**

Edit:

- Rename `registerCompany` → `createCompany`. Remove the `existing` check and `accountType: "COMPANY"` update from the `$transaction`. The `create` becomes a single statement. Drop the P2002 catch since the unique constraint is gone.
- Change `saveCompanyProfile(input)` → `saveCompanyProfile(companyId: string, input: CompanyProfileInput)`. Replace the `findUnique({ where: { ownerUserId: userId } })` with `findUnique({ where: { id: companyId } })` and assert `company.ownerUserId === userId`.
- Change `submitCompanyPoint(input)` → `submitCompanyPoint(companyId: string, input: ...)`. Same ownership check pattern.

Resulting file:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  validateCompanyProfile,
  validateCompanyPoint,
  type CompanyProfileInput,
  type CompanyPointInput,
} from "@/lib/company";
import { type PointType } from "@prisma/client";

const MAX_PENDING_POINTS = 20;

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function createCompany(input: { legalName: string; displayName: string }) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const v = validateCompanyProfile(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  const company = await prisma.company.create({
    data: {
      ownerUserId: userId,
      legalName: v.data.legalName,
      displayName: v.data.displayName,
      description: v.data.description,
      country: v.data.country,
      address: v.data.address,
      phone: v.data.phone,
      email: v.data.email,
      website: v.data.website,
      logoUrl: v.data.logoUrl,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, id: company.id };
}

export async function saveCompanyProfile(companyId: string, input: CompanyProfileInput) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.ownerUserId !== userId) return { ok: false as const, reason: "not_found" as const };
  const v = validateCompanyProfile(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  await prisma.company.update({ where: { id: company.id }, data: v.data });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function submitCompanyPoint(
  companyId: string,
  input: CompanyPointInput & { socials?: { network: string; url: string }[] },
) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.ownerUserId !== userId) return { ok: false as const, reason: "not_found" as const };
  const v = validateCompanyPoint(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  const pending = await prisma.companyPoint.count({
    where: { companyId: company.id, status: "PENDING" },
  });
  if (pending >= MAX_PENDING_POINTS) return { ok: false as const, reason: "too_many_pending" as const };
  await prisma.companyPoint.create({
    data: {
      companyId: company.id,
      type: v.data.type as PointType,
      name: v.data.name,
      description: v.data.description,
      lat: v.data.lat,
      lon: v.data.lon,
      address: v.data.address,
      acceptedCoinIds: v.data.acceptedCoinIds,
      logoUrl: v.data.logoUrl,
      openingHours: v.data.openingHours,
      phone: v.data.phone,
      website: v.data.website,
      socials: Array.isArray(input.socials) ? input.socials : undefined,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
```

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run tests/company.test.ts`
Expected: PASS (the validator hasn't changed; these tests test pure validation).

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: all green (so we see if anything else broke).

- [ ] **Step 5: Commit**

```bash
git add src/lib/business.ts src/app/actions/company.ts
git commit -m "refactor(company): N-companies-per-user, drop accountType flip"
```

---

## Task 6: Remove accountType from register endpoint

**Files:**
- Modify: `src/app/api/auth/password/register/route.ts:57`

- [ ] **Step 1: Edit the file**

Open `src/app/api/auth/password/register/route.ts`. Find the `prisma.user.create(...)` call (around line 57) and remove the line `accountType: "INDIVIDUAL",`.

- [ ] **Step 2: Grep for any remaining accountType references**

Run: `grep -rn "accountType" src/`
Expected: no matches. (If any remain, edit them out — they should be removable since the column is gone.)

- [ ] **Step 3: Type-check + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/password/register/route.ts
git commit -m "refactor(auth): drop accountType from register"
```

---

## Task 7: Cabinet page with new sections

**Files:**
- Create: `src/components/cabinet/companies-section.tsx`
- Create: `src/components/cabinet/exchanges-section.tsx`
- Modify: `src/app/[locale]/cabinet/page.tsx`

- [ ] **Step 1: Companies section component**

Create `src/components/cabinet/companies-section.tsx`:

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listViewerCompanies } from "@/lib/business";
import { CreateCompanyForm } from "@/components/cabinet/create-company-form";

export async function CompaniesSection({ locale }: { locale: string }) {
  const { companies } = await listViewerCompanies();
  const t = await getTranslations("cabinet.companies");
  return (
    <section id="companies" className="space-y-6">
      <h2 className="text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h2>
      {companies.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {companies.map((c) => (
            <li key={c.id} className="border border-hairline rounded-md p-4 hover:bg-card-alt">
              <Link href={`/${locale}/cabinet/companies/${c.id}`} className="block">
                <div className="font-medium">{c.displayName}</div>
                <div className="text-xs text-muted">{c.legalName}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateCompanyForm />
    </section>
  );
}
```

Create `src/components/cabinet/create-company-form.tsx` (client component) — a minimal form with legalName + displayName inputs that calls the `createCompany` server action and redirects to the new company's page on success. Use the existing `CompanyProfileForm` only if a minimal "register" mode exists; otherwise write a small client form. Pattern:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createCompany } from "@/app/actions/company";

export function CreateCompanyForm() {
  const t = useTranslations("cabinet.companies");
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [pending, startTransition] = useTransition();
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await createCompany({ legalName, displayName });
          if (r.ok) router.push(`/${locale}/cabinet/companies/${r.id}`);
          else setError(r.reason);
        });
      }}
    >
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{t("add")}</h3>
      <input value={legalName} onChange={(e) => setLegalName(e.target.value)}
        placeholder={t("legalName")} className="w-full px-3 py-2 rounded-md border border-hairline bg-card" />
      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
        placeholder={t("displayName")} className="w-full px-3 py-2 rounded-md border border-hairline bg-card" />
      {error && <p className="text-red-500 text-sm">{t(`errors.${error}`)}</p>}
      <button type="submit" disabled={pending}
        className="px-4 py-2 rounded-md bg-blue text-blue-foreground font-medium disabled:opacity-50">
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Exchanges section component**

Create `src/components/cabinet/exchanges-section.tsx` — mirror image of CompaniesSection, listing the user's exchanges with a status badge. Pulls from `listViewerExchanges()` (add this helper inline at top of the file, since it's tiny):

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CreateExchangeForm } from "@/components/cabinet/create-exchange-form";

async function listViewerExchanges() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return [];
  return prisma.exchange.findMany({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, legalName: true, status: true },
  });
}

const STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-500",
  APPROVED: "bg-green-500/15 text-green-500",
  REJECTED: "bg-red-500/15 text-red-500",
};

export async function ExchangesSection({ locale }: { locale: string }) {
  const exchanges = await listViewerExchanges();
  const t = await getTranslations("cabinet.exchanges");
  return (
    <section id="exchanges" className="space-y-6">
      <h2 className="text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h2>
      {exchanges.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {exchanges.map((x) => (
            <li key={x.id} className="border border-hairline rounded-md p-4 hover:bg-card-alt">
              <Link href={`/${locale}/cabinet/exchanges/${x.id}`} className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">{x.displayName}</div>
                  <div className="text-xs text-muted">{x.legalName}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${STATUS_CLASS[x.status]}`}>
                  {t(`status.${x.status}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateExchangeForm />
    </section>
  );
}
```

Create `src/components/cabinet/create-exchange-form.tsx` — a client component analogous to `CreateCompanyForm` that collects the full exchange profile fields and calls `createExchange`. Uses `useTranslations("exchange")` for labels.

- [ ] **Step 3: Update cabinet page**

Edit `src/app/[locale]/cabinet/page.tsx`:

- Remove the `user.accountType === "COMPANY"` redirect to `/business` (the field is gone).
- Add a render of `<CompaniesSection locale={locale} />` and `<ExchangesSection locale={locale} />` after the existing sections (`#profile`, `#settings`, `#alerts`).

Keep all other current behavior intact (the `ensureUsername` call, the existing components).

- [ ] **Step 4: Run build to catch type errors**

Run: `npm run build` (or at minimum `npx tsc --noEmit`)
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/cabinet/companies-section.tsx \
        src/components/cabinet/exchanges-section.tsx \
        src/components/cabinet/create-company-form.tsx \
        src/components/cabinet/create-exchange-form.tsx \
        src/app/[locale]/cabinet/page.tsx
git commit -m "feat(cabinet): #companies + #exchanges sections"
```

---

## Task 8: Per-company management page

**Files:**
- Create: `src/app/[locale]/cabinet/companies/[id]/page.tsx`

- [ ] **Step 1: Create the page (rehoused from `/business/page.tsx`)**

Create `src/app/[locale]/cabinet/companies/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getViewerCompanyById } from "@/lib/business";
import { readTop100 } from "@/lib/snapshot";
import { CompanyProfileForm } from "@/components/business/company-profile-form";
import { PointForm } from "@/components/business/point-form";
import { PointsList, type PointListItem } from "@/components/business/points-list";

export const dynamic = "force-dynamic";

export default async function CompanyManagementPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("business");
  const { userId, company } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();

  const [points, coins] = await Promise.all([
    prisma.companyPoint.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    readTop100(),
  ]);
  const items: PointListItem[] = points.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    status: p.status,
    rejectReason: p.rejectReason,
  }));
  const coinOpts = coins.map((c) => ({ id: c.id, symbol: c.symbol }));

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-12 space-y-12">
      <section>
        <h1 className="text-[36px] font-bold tracking-[-0.03em] mb-1">{company.displayName}</h1>
        <p className="text-muted mb-6">{t("profileIntro")}</p>
        <CompanyProfileForm
          mode="edit"
          companyId={company.id}
          initial={{
            legalName: company.legalName, displayName: company.displayName,
            description: company.description ?? "", website: company.website ?? "",
            logoUrl: company.logoUrl ?? "", address: company.address ?? "",
            phone: company.phone ?? "", email: company.email ?? "", country: company.country ?? "",
          }}
        />
      </section>
      <section>
        <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">{t("yourPoints")}</h2>
        <PointsList points={items} />
      </section>
      <section>
        <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">{t("addPoint")}</h2>
        <PointForm companyId={company.id} coins={coinOpts} />
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Thread `companyId` through `CompanyProfileForm` and `PointForm`**

Open `src/components/business/company-profile-form.tsx`. Add a `companyId?: string` prop. In its `onSubmit`, change the `saveCompanyProfile(input)` call to `saveCompanyProfile(companyId, input)` when in `edit` mode. The `register` mode call site goes away (no more first-time registration in /business).

Open `src/components/business/point-form.tsx`. Add a `companyId: string` prop. Pass it as the first arg to `submitCompanyPoint`.

- [ ] **Step 3: Build to catch type errors**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/cabinet/companies/[id]/page.tsx \
        src/components/business/company-profile-form.tsx \
        src/components/business/point-form.tsx
git commit -m "feat(cabinet): /cabinet/companies/[id] management page"
```

---

## Task 9: Per-exchange management page

**Files:**
- Create: `src/app/[locale]/cabinet/exchanges/[id]/page.tsx`
- Create: `src/components/business/exchange-profile-form.tsx`

- [ ] **Step 1: Exchange profile form (client)**

Create `src/components/business/exchange-profile-form.tsx`. Read `src/components/business/company-profile-form.tsx` first for the styling and field-row pattern (input classes, label markup, error message rendering) and apply it identically here. Code skeleton:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { saveExchangeProfile } from "@/app/actions/exchange";
import type { ExchangeProfileInput } from "@/lib/exchange";

type Initial = {
  legalName: string; displayName: string; description: string; website: string;
  country: string; email: string; phone: string; address: string; logoUrl: string;
};

export function ExchangeProfileForm({
  exchangeId,
  initial,
}: { exchangeId: string; initial: Initial }) {
  const t = useTranslations("exchange");
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<Initial>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onChange = (k: keyof Initial) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((s) => ({ ...s, [k]: e.target.value }));
    setSaved(false);
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await saveExchangeProfile(exchangeId, form as ExchangeProfileInput);
          if (r.ok) setSaved(true);
          else setError(r.reason);
        });
      }}
    >
      {(["legalName","displayName","website","country","email","phone","address","logoUrl"] as const).map((k) => (
        <label key={k} className="block">
          <span className="text-xs uppercase tracking-wider text-muted">{t(k)}</span>
          <input
            value={form[k]}
            onChange={onChange(k)}
            className="mt-1 w-full px-3 py-2 rounded-md border border-hairline bg-card"
          />
        </label>
      ))}
      <label className="block">
        <span className="text-xs uppercase tracking-wider text-muted">{t("description")}</span>
        <textarea
          value={form.description}
          onChange={onChange("description")}
          rows={4}
          className="mt-1 w-full px-3 py-2 rounded-md border border-hairline bg-card"
        />
      </label>
      {error && <p className="text-red-500 text-sm">{t(`errors.${error}`)}</p>}
      {saved && <p className="text-green-500 text-sm">{t("saved")}</p>}
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 rounded-md bg-blue text-blue-foreground font-medium disabled:opacity-50"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Management page**

Create `src/app/[locale]/cabinet/exchanges/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ExchangeProfileForm } from "@/components/business/exchange-profile-form";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-500",
  APPROVED: "bg-green-500/15 text-green-500",
  REJECTED: "bg-red-500/15 text-red-500",
};

export default async function ExchangeManagementPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinet.exchanges");
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect(`/${locale}/login`);
  const exchange = await prisma.exchange.findUnique({ where: { id } });
  if (!exchange || exchange.ownerUserId !== userId) notFound();

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-12 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[36px] font-bold tracking-[-0.03em]">{exchange.displayName}</h1>
        <span className={`text-xs px-3 py-1 rounded ${STATUS_CLASS[exchange.status]}`}>
          {t(`status.${exchange.status}`)}
        </span>
      </header>
      {exchange.status === "REJECTED" && exchange.rejectionReason && (
        <p className="text-sm text-red-400">
          {t("rejectedReason")}: {exchange.rejectionReason}
        </p>
      )}
      <ExchangeProfileForm
        exchangeId={exchange.id}
        initial={{
          legalName: exchange.legalName,
          displayName: exchange.displayName,
          description: exchange.description ?? "",
          website: exchange.website,
          country: exchange.country,
          email: exchange.email,
          phone: exchange.phone ?? "",
          address: exchange.address ?? "",
          logoUrl: exchange.logoUrl ?? "",
        }}
      />
    </main>
  );
}
```

- [ ] **Step 3: Build to catch type errors**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/business/exchange-profile-form.tsx \
        src/app/[locale]/cabinet/exchanges/[id]/page.tsx
git commit -m "feat(cabinet): /cabinet/exchanges/[id] management page"
```

---

## Task 10: Redirect `/business` to `/cabinet#companies`

**Files:**
- Modify: `src/app/[locale]/business/page.tsx`

- [ ] **Step 1: Replace the page with a redirect**

Overwrite `src/app/[locale]/business/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default async function BusinessLegacyRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/cabinet#companies`);
}
```

- [ ] **Step 2: Build**

Run: `npx tsc --noEmit`
Expected: clean. Warnings about unused imports — clean up.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/business/page.tsx
git commit -m "refactor(business): 301 /business to /cabinet#companies"
```

---

## Task 11: Admin exchange moderation page

**Files:**
- Create: `src/app/[locale]/admin/exchanges/page.tsx`
- Create: `src/components/admin/exchange-row.tsx`
- Modify: `src/components/admin/nav.tsx`

- [ ] **Step 1: Read the existing admin business page for pattern**

Read `src/app/[locale]/admin/business/page.tsx` to copy the status filter + row layout pattern.

- [ ] **Step 2: Add "exchanges" tab to admin nav**

In `src/components/admin/nav.tsx`, add a new tab entry between `business` and `coins`:

```tsx
{ href: "/admin/exchanges", labelKey: "tabs.exchanges" }
```

(Match the actual shape of the existing tab definitions — read the file before editing.)

- [ ] **Step 3: Create the moderation page**

Create `src/app/[locale]/admin/exchanges/page.tsx`:

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { ExchangeRow } from "@/components/admin/exchange-row";
import type { ExchangeStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUSES: ExchangeStatus[] = ["PENDING", "APPROVED", "REJECTED"];

export default async function AdminExchangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations("admin.exchanges");
  const status = (STATUSES as string[]).includes(sp.status ?? "")
    ? (sp.status as ExchangeStatus)
    : "PENDING";

  const rows = await prisma.exchange.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    include: { owner: { select: { username: true } } },
    take: 200,
  });

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-10 space-y-6">
      <h1 className="text-[28px] font-bold tracking-[-0.02em]">{t("title")}</h1>
      <nav className="flex gap-3 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${locale}/admin/exchanges?status=${s}`}
            className={`px-3 py-1 rounded-md border ${
              s === status ? "bg-card-alt border-foreground" : "border-hairline text-muted hover:text-foreground"
            }`}
          >
            {t(`filters.${s.toLowerCase()}`)}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <ExchangeRow
              key={r.id}
              id={r.id}
              displayName={r.displayName}
              legalName={r.legalName}
              ownerUsername={r.owner.username ?? "—"}
              country={r.country}
              website={r.website}
              logoUrl={r.logoUrl}
              status={r.status}
              rejectionReason={r.rejectionReason}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Create `ExchangeRow` client component**

Create `src/components/admin/exchange-row.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { approveExchange, rejectExchange } from "@/app/actions/admin-exchange";
import type { ExchangeStatus } from "@prisma/client";

export function ExchangeRow(props: {
  id: string;
  displayName: string;
  legalName: string;
  ownerUsername: string;
  country: string;
  website: string;
  logoUrl: string | null;
  status: ExchangeStatus;
  rejectionReason: string | null;
}) {
  const t = useTranslations("admin.exchanges");
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onApprove = () => {
    setError(null);
    startTransition(async () => {
      const r = await approveExchange(props.id);
      if (!r.ok) setError(r.reason);
    });
  };

  const onReject = () => {
    setError(null);
    if (reason.trim().length < 3) {
      setError("rejectReasonTooShort");
      return;
    }
    startTransition(async () => {
      const r = await rejectExchange(props.id, reason);
      if (!r.ok) setError(r.reason);
    });
  };

  return (
    <li className="border border-hairline rounded-md p-4 space-y-3">
      <div className="flex items-center gap-4">
        {props.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.logoUrl} alt="" className="w-10 h-10 rounded-md object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-md bg-card-alt" />
        )}
        <div className="flex-1">
          <div className="font-medium">{props.displayName}</div>
          <div className="text-xs text-muted">
            {props.legalName} · {props.country} · @{props.ownerUsername}
          </div>
          <a href={props.website} target="_blank" rel="noopener noreferrer" className="text-xs text-accent">
            {props.website}
          </a>
        </div>
        {props.status === "PENDING" && (
          <div className="flex gap-2">
            <button onClick={onApprove} disabled={pending}
              className="px-3 py-1 rounded-md bg-green-500/15 text-green-500 text-sm disabled:opacity-50">
              {t("approve")}
            </button>
            <button onClick={() => setShowReject((s) => !s)} disabled={pending}
              className="px-3 py-1 rounded-md bg-red-500/15 text-red-500 text-sm disabled:opacity-50">
              {t("reject")}
            </button>
          </div>
        )}
      </div>
      {showReject && props.status === "PENDING" && (
        <div className="space-y-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("rejectReasonPlaceholder")}
            className="w-full px-3 py-2 rounded-md border border-hairline bg-card text-sm"
          />
          <button onClick={onReject} disabled={pending}
            className="px-3 py-1 rounded-md bg-red-500 text-white text-sm disabled:opacity-50">
            {t("reject")}
          </button>
        </div>
      )}
      {props.status === "REJECTED" && props.rejectionReason && (
        <p className="text-xs text-red-400">{props.rejectionReason}</p>
      )}
      {error && <p className="text-xs text-red-500">{t(error)}</p>}
    </li>
  );
}
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/[locale]/admin/exchanges/page.tsx \
        src/components/admin/exchange-row.tsx \
        src/components/admin/nav.tsx
git commit -m "feat(admin): exchanges moderation queue"
```

---

## Task 12: Simplify navbar

**Files:**
- Modify: `src/components/navbar.tsx`

- [ ] **Step 1: Edit `src/components/navbar.tsx`**

Remove these blocks (and their references later in the file):

```tsx
const accountType = userId
  ? (await prisma.user.findUnique({ where: { id: userId }, select: { accountType: true } }))?.accountType
  : null;
const cabinetHref =
  accountType === "COMPANY" ? `/${locale}/business` : `/${locale}/cabinet`;
const cabinetLabel =
  accountType === "COMPANY" ? t("business") : t("cabinet");
```

Replace with:

```tsx
const cabinetHref = `/${locale}/cabinet`;
const cabinetLabel = t("cabinet");
```

Also remove the `import { prisma } from "@/lib/prisma";` line if no other code in the file uses it (check first).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/navbar.tsx
git commit -m "refactor(navbar): single cabinet link (no accountType branching)"
```

---

## Task 13: i18n — English first, then 9 locales

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/{ru,de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json`

- [ ] **Step 1: Add English keys**

In `messages/en.json`:

Add under `cabinet`:
```json
"companies": {
  "title": "My companies",
  "empty": "You have no companies yet.",
  "add": "Add company",
  "legalName": "Legal name",
  "displayName": "Display name",
  "submit": "Create company",
  "submitting": "Creating…",
  "errors": {
    "unauth": "Please sign in first.",
    "legal_name_required": "Legal name is required.",
    "display_name_required": "Display name is required.",
    "website_invalid": "Website must be http or https."
  }
},
"exchanges": {
  "title": "My exchanges",
  "empty": "You have no exchanges yet.",
  "add": "Add exchange",
  "submit": "Create exchange",
  "submitting": "Creating…",
  "status": {
    "PENDING": "Pending review",
    "APPROVED": "Approved",
    "REJECTED": "Rejected"
  },
  "rejectedReason": "Reason"
}
```

Add a new top-level `exchange` namespace with the form labels (legalName, displayName, description, website, country, email, phone, address, logoUrl, submit, submitting, plus an `errors.*` map covering every reason returned by the validator).

Under `admin.tabs`, add `"exchanges": "Exchanges"`.

Add a new `admin.exchanges` namespace:
```json
"exchanges": {
  "title": "Exchanges",
  "filters": { "pending": "Pending", "approved": "Approved", "rejected": "Rejected" },
  "empty": "No exchanges in this status.",
  "approve": "Approve",
  "reject": "Reject",
  "rejectReasonPlaceholder": "Reason (at least 3 characters)",
  "rejectReasonTooShort": "Reason must be at least 3 characters."
}
```

Remove `business.registerIntro` (no longer used).

- [ ] **Step 2: Run the build to confirm structural validity**

Run: `npm run build`
Expected: clean (missing-key warnings would show up here).

- [ ] **Step 3: Translate to 9 other locales**

For each of `ru, de, es, fr, ja, ko, pt-BR, tr, zh-CN`, copy the new keys to the respective file and translate the values. Use the existing translations in each file as a tone reference (same formality, capitalization, terminology). The status labels `PENDING / APPROVED / REJECTED` reuse the existing `business.status.*` translation conventions in each locale.

Verify all 10 locale files have the same set of keys:

Run: `node -e "const k=p=>Object.keys(require(p));const en=k('./messages/en.json');for(const l of ['ru','de','es','fr','ja','ko','pt-BR','tr','zh-CN']){const o=k('./messages/'+l+'.json');console.log(l,JSON.stringify({missing:en.filter(x=>!o.includes(x)),extra:o.filter(x=>!en.includes(x))}))}"`
Expected: `missing: [], extra: []` for every locale.

- [ ] **Step 4: Commit**

```bash
git add messages/*.json
git commit -m "i18n: cabinet.companies, cabinet.exchanges, exchange, admin.exchanges (10 locales)"
```

---

## Task 14: Final build, test, deploy

- [ ] **Step 1: Full type-check + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: clean. No warnings about missing message keys.

- [ ] **Step 3: Restart web (worker untouched)**

Run: `pm2 restart trientes-web && pm2 save`
Expected: web back online, healthy.

Verify worker is **NOT** restarted: per `CLAUDE.md`, worker only needs a restart when a file under `src/lib` that the worker imports has changed. The changes here are confined to `src/lib/exchange.ts` (new file, not imported by worker), and edits to `src/lib/business.ts` (not imported by worker either — confirm with `grep -r "from.*lib/business" trientes-worker/ src/` or equivalent before deploy). If it IS imported, also run `pm2 restart trientes-worker`.

- [ ] **Step 4: Manual smoke test in browser**

On `https://trientes.org`:

1. Open `/en/register` in a private window → create a new account → land on `/en/cabinet`.
2. Confirm the cabinet page shows `#profile`, `#settings`, `#alerts`, `#companies`, `#exchanges`.
3. Add a company via the inline form → confirm redirect to `/en/cabinet/companies/<id>` with the existing CompanyProfileForm + Points list + add-point form.
4. Add a point → confirm it shows in the points list as PENDING.
5. Back at `/en/cabinet`, add an exchange via the inline form → confirm redirect to `/en/cabinet/exchanges/<id>` with PENDING badge.
6. Open `/en/business` → confirm it 301s to `/en/cabinet#companies`.
7. As an admin user, open `/en/admin/exchanges` → confirm the new exchange appears under PENDING; approve it; confirm the cabinet page shows APPROVED badge.
8. Open `/en/exchanges` (public exchange catalog) → confirm it works exactly as before (no UI changes, same data).
9. Open `/en/navigator` → confirm map loads, POI overlay still works.

- [ ] **Step 5: Push**

```bash
git push origin main
```

---

## Self-review checklist (verify before declaring done)

- [ ] Spec section "Hard rule: public-facing pages stay untouched" — verified in Step 4 of Task 14 (smoke tests 8 and 9).
- [ ] User.accountType — verified absent via `grep -rn "accountType" src/` in Task 6 Step 2.
- [ ] Worker not stale — `grep -r "from.*lib/business\|from.*lib/exchange" trientes-worker/` should return nothing.
- [ ] All 10 locales have matching key sets — verified by the node one-liner in Task 13 Step 3.
- [ ] No `console.log` debugging statements left in committed code.
- [ ] No "TODO" or "FIXME" comments added by this work.
