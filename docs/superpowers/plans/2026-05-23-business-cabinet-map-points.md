# Business Cabinet + Company Map Points — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let legal-entity (company) accounts register a profile and submit crypto-accepting locations (shops/ATMs/POS/sales offices) that, once an admin approves them, appear on the coin Crypto Navigator.

**Architecture:** New `Company` and `CompanyPoint` Prisma models + a `User.accountType` flag. Companies self-serve via a `/business` cabinet; submissions are `PENDING` and never public until an admin Approves them in a new `/admin/business` queue (mirrors the existing `CoinRequest` → approve/reject + `AdminAuditLog` flow). Approved points are merged into the `/api/crypto-map/poi` response by bounding box (like the RichAmster curated-exchange merge) and rendered by the existing POI card.

**Tech Stack:** Next.js 16, Prisma 5 + PostgreSQL 16, Auth.js v5, next-intl, MapLibre GL, Tailwind v4, vitest.

**Spec:** `docs/superpowers/specs/2026-05-23-business-cabinet-map-points-design.md`

**Reused types/helpers (do not redefine):**
- `Poi`, `Social`, `PoiLayer`, `Bbox`, `parseBbox`, `coinPaymentTags`, `fetchPois` — `src/lib/crypto-map.ts`
- `checkAdmin()` → `{ ok: true; userId } | { ok: false; reason }` — `src/lib/is-admin.ts`
- `logAdminAction({actorId, action, targetType, targetId, details})` — `src/lib/admin/audit.ts`
- `auth()` — `src/auth.ts`; user id is `(session?.user as { id?: string }).id`
- `redis` — `src/lib/redis.ts`; `prisma` — `src/lib/prisma.ts`

**Deploy note (every commit that touches `src/lib` imported by the worker):** worker does NOT import these new modules, so deploy is web-only unless stated. Final deploy: `prisma migrate deploy` + `prisma generate` + `npm run build` + `pm2 restart trientes-web` + `pm2 save` + `git push`. Run all node/npm/prisma commands with `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` first.

---

## File Structure

- `prisma/schema.prisma` — modify: `AccountType`/`PointType` enums, `Company`, `CompanyPoint`, `AdminAction` += `APPROVE_POINT`/`REJECT_POINT`, `User` relations.
- `prisma/migrations/20260523180000_business_cabinet/migration.sql` — create.
- `src/lib/company.ts` — create: pure validation (`validateCompanyProfile`, `validateCompanyPoint`).
- `src/lib/company-points.ts` — create: `companyPointToPoi` (pure map), `fetchApprovedPointsInBbox` (DB).
- `src/app/actions/company.ts` — create: `registerCompany`, `saveCompanyProfile`, `submitCompanyPoint`.
- `src/app/actions/admin-points.ts` — create: `approvePoint`, `rejectPoint`.
- `src/lib/business.ts` — create: `getViewerCompany()` server helper.
- `src/app/[locale]/business/page.tsx` — create: cabinet (profile + points list + new-point form).
- `src/components/business/company-profile-form.tsx` — create (client).
- `src/components/business/point-form.tsx` — create (client, map pin-picker).
- `src/components/business/points-list.tsx` — create (server-rendered list; status badges).
- `src/app/[locale]/admin/business/page.tsx` — create: moderation queue.
- `src/components/admin/point-row.tsx` — create (client, approve/reject).
- `src/components/admin/nav.tsx` — modify: add `business` tab.
- `src/app/api/crypto-map/poi/route.ts` — modify: merge approved company points.
- `src/components/navbar.tsx` — modify: add "Business" link.
- `messages/*.json` (10) — add `common.business` + `business` namespace + `admin.tabs.business`.
- Tests: `tests/company.test.ts`, `tests/company-points.test.ts`.

---

## Task 1: Data model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260523180000_business_cabinet/migration.sql`

- [ ] **Step 1: Add enums + models to `prisma/schema.prisma`**

Add the `accountType` field to `model User` (after `role`):
```prisma
  accountType       AccountType @default(INDIVIDUAL)
```
Add to `model User` relation block (near `watchlist`):
```prisma
  company        Company?
  reviewedPoints CompanyPoint[] @relation("PointReviewer")
```
Add `APPROVE_POINT` and `REJECT_POINT` to `enum AdminAction`.
Add at end of file:
```prisma
enum AccountType {
  INDIVIDUAL
  COMPANY
}

enum PointType {
  SHOP
  ATM
  POS
  SALES_OFFICE
}

model Company {
  id          String   @id @default(cuid())
  ownerUserId String   @unique
  owner       User     @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  legalName   String
  displayName String
  logoUrl     String?
  description String?  @db.Text
  country     String?
  address     String?
  phone       String?
  email       String?
  website     String?
  socials     Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  points      CompanyPoint[]
}

model CompanyPoint {
  id              String        @id @default(cuid())
  companyId       String
  company         Company       @relation(fields: [companyId], references: [id], onDelete: Cascade)
  type            PointType
  name            String
  description     String?       @db.Text
  lat             Float
  lon             Float
  address         String?
  acceptedCoinIds String[]
  logoUrl         String?
  openingHours    String?
  phone           String?
  website         String?
  socials         Json?
  status          RequestStatus @default(PENDING)
  reviewedById    String?
  reviewer        User?         @relation("PointReviewer", fields: [reviewedById], references: [id])
  reviewedAt      DateTime?
  rejectReason    String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@index([status])
  @@index([companyId])
  @@index([lat, lon])
}
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260523180000_business_cabinet/migration.sql`:
```sql
-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('INDIVIDUAL', 'COMPANY');
CREATE TYPE "PointType" AS ENUM ('SHOP', 'ATM', 'POS', 'SALES_OFFICE');

-- AlterEnum
ALTER TYPE "AdminAction" ADD VALUE 'APPROVE_POINT';
ALTER TYPE "AdminAction" ADD VALUE 'REJECT_POINT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "accountType" "AccountType" NOT NULL DEFAULT 'INDIVIDUAL';

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "description" TEXT,
    "country" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "socials" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Company_ownerUserId_key" ON "Company"("ownerUserId");

CREATE TABLE "CompanyPoint" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "PointType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "acceptedCoinIds" TEXT[],
    "logoUrl" TEXT,
    "openingHours" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "socials" JSONB,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyPoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CompanyPoint_status_idx" ON "CompanyPoint"("status");
CREATE INDEX "CompanyPoint_companyId_idx" ON "CompanyPoint"("companyId");
CREATE INDEX "CompanyPoint_lat_lon_idx" ON "CompanyPoint"("lat", "lon");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPoint" ADD CONSTRAINT "CompanyPoint_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPoint" ADD CONSTRAINT "CompanyPoint_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply + generate**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx prisma migrate status`
Expected: lists `20260523180000_business_cabinet` as not applied.
Run: `npx prisma migrate deploy && npx prisma generate`
Expected: "All migrations have been successfully applied."

- [ ] **Step 4: Commit**
```bash
git add prisma/schema.prisma prisma/migrations/20260523180000_business_cabinet
git commit -m "feat(db): company + company point models, account type"
```

---

## Task 2: Company + point validation (pure)

**Files:**
- Create: `src/lib/company.ts`
- Test: `tests/company.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/company.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { validateCompanyProfile, validateCompanyPoint } from "@/lib/company";

describe("validateCompanyProfile", () => {
  it("accepts a minimal valid profile and trims", () => {
    const r = validateCompanyProfile({ legalName: " ACME LLC ", displayName: " ACME " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.legalName).toBe("ACME LLC");
  });
  it("requires legalName and displayName", () => {
    expect(validateCompanyProfile({ legalName: "", displayName: "x" })).toMatchObject({ ok: false, reason: "legal_name_required" });
    expect(validateCompanyProfile({ legalName: "x", displayName: "" })).toMatchObject({ ok: false, reason: "display_name_required" });
  });
  it("rejects a non-http website", () => {
    expect(validateCompanyProfile({ legalName: "a", displayName: "b", website: "javascript:alert(1)" }))
      .toMatchObject({ ok: false, reason: "website_invalid" });
  });
});

describe("validateCompanyPoint", () => {
  const base = { type: "SHOP", name: "Shop", lat: 50.08, lon: 14.42 };
  it("accepts a valid point", () => {
    const r = validateCompanyPoint(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.type).toBe("SHOP");
  });
  it("rejects an unknown type", () => {
    expect(validateCompanyPoint({ ...base, type: "BANK" })).toMatchObject({ ok: false, reason: "type_invalid" });
  });
  it("requires a name", () => {
    expect(validateCompanyPoint({ ...base, name: " " })).toMatchObject({ ok: false, reason: "name_required" });
  });
  it("rejects out-of-range coordinates", () => {
    expect(validateCompanyPoint({ ...base, lat: 100 })).toMatchObject({ ok: false, reason: "coords_invalid" });
    expect(validateCompanyPoint({ ...base, lon: 999 })).toMatchObject({ ok: false, reason: "coords_invalid" });
  });
  it("normalizes acceptedCoinIds to lowercase unique slugs", () => {
    const r = validateCompanyPoint({ ...base, acceptedCoinIds: ["Bitcoin", "bitcoin", "ETH"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.acceptedCoinIds).toEqual(["bitcoin", "eth"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx vitest run tests/company.test.ts`
Expected: FAIL — cannot find module `@/lib/company`.

- [ ] **Step 3: Implement `src/lib/company.ts`**
```ts
// Pure validation for company profiles and point submissions. No I/O.

const POINT_TYPES = ["SHOP", "ATM", "POS", "SALES_OFFICE"] as const;
export type PointTypeStr = (typeof POINT_TYPES)[number];

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

export type CompanyProfileInput = {
  legalName?: string | null;
  displayName?: string | null;
  description?: string | null;
  country?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
};
export type ValidatedProfile = {
  legalName: string; displayName: string; description: string | null; country: string | null;
  address: string | null; phone: string | null; email: string | null; website: string | null; logoUrl: string | null;
};
export type ProfileResult =
  | { ok: true; data: ValidatedProfile }
  | { ok: false; reason: "legal_name_required" | "display_name_required" | "website_invalid" | "logo_invalid" };

export function validateCompanyProfile(input: CompanyProfileInput): ProfileResult {
  const legalName = (input.legalName ?? "").trim();
  const displayName = (input.displayName ?? "").trim();
  if (!legalName) return { ok: false, reason: "legal_name_required" };
  if (!displayName) return { ok: false, reason: "display_name_required" };
  const website = httpOrNull(input.website);
  if (website === "invalid") return { ok: false, reason: "website_invalid" };
  const logoUrl = httpOrNull(input.logoUrl);
  if (logoUrl === "invalid") return { ok: false, reason: "logo_invalid" };
  const t = (v: string | null | undefined) => { const s = (v ?? "").trim(); return s ? s : null; };
  return {
    ok: true,
    data: { legalName, displayName, description: t(input.description), country: t(input.country),
      address: t(input.address), phone: t(input.phone), email: t(input.email), website, logoUrl },
  };
}

export type CompanyPointInput = {
  type?: string | null;
  name?: string | null;
  description?: string | null;
  lat?: number | null;
  lon?: number | null;
  address?: string | null;
  acceptedCoinIds?: string[] | null;
  logoUrl?: string | null;
  openingHours?: string | null;
  phone?: string | null;
  website?: string | null;
};
export type ValidatedPoint = {
  type: PointTypeStr; name: string; description: string | null; lat: number; lon: number;
  address: string | null; acceptedCoinIds: string[]; logoUrl: string | null;
  openingHours: string | null; phone: string | null; website: string | null;
};
export type PointResult =
  | { ok: true; data: ValidatedPoint }
  | { ok: false; reason: "type_invalid" | "name_required" | "coords_invalid" | "website_invalid" | "logo_invalid" };

export function validateCompanyPoint(input: CompanyPointInput): PointResult {
  const type = (input.type ?? "") as PointTypeStr;
  if (!POINT_TYPES.includes(type)) return { ok: false, reason: "type_invalid" };
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, reason: "name_required" };
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return { ok: false, reason: "coords_invalid" };
  const website = httpOrNull(input.website);
  if (website === "invalid") return { ok: false, reason: "website_invalid" };
  const logoUrl = httpOrNull(input.logoUrl);
  if (logoUrl === "invalid") return { ok: false, reason: "logo_invalid" };
  const acceptedCoinIds = Array.from(
    new Set((input.acceptedCoinIds ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean)),
  );
  const t = (v: string | null | undefined) => { const s = (v ?? "").trim(); return s ? s : null; };
  return {
    ok: true,
    data: { type, name, description: t(input.description), lat, lon, address: t(input.address),
      acceptedCoinIds, logoUrl, openingHours: t(input.openingHours), phone: t(input.phone), website },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/company.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/company.ts tests/company.test.ts
git commit -m "feat(business): company + point validation"
```

---

## Task 3: CompanyPoint → Poi mapping + bbox query

**Files:**
- Create: `src/lib/company-points.ts`
- Test: `tests/company-points.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/company-points.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { companyPointToPoi } from "@/lib/company-points";

const row = {
  id: "ckpoint1", type: "ATM", name: "BTC ATM", description: null,
  lat: 50.08, lon: 14.42, address: "Main St", acceptedCoinIds: ["bitcoin"],
  logoUrl: "https://x/y.png", openingHours: "24/7", phone: null, website: null,
  socials: [{ network: "telegram", url: "https://t.me/x" }],
  company: { displayName: "ACME", logoUrl: "https://x/c.png", website: "https://acme.co", socials: null },
};

describe("companyPointToPoi", () => {
  it("maps an ATM point to an atm-layer Poi with a company id prefix", () => {
    const p = companyPointToPoi(row as never, "bitcoin");
    expect(p.id).toBe("company/ckpoint1");
    expect(p.layer).toBe("atm");
    expect(p.lat).toBe(50.08);
    expect(p.coinSpecific).toBe(true);
    expect(p.image).toBe("https://x/y.png");
    expect(p.socials).toEqual([{ network: "telegram", url: "https://t.me/x" }]);
  });
  it("maps SHOP/POS/SALES_OFFICE to the merchant layer and reads coinSpecific per coin", () => {
    expect(companyPointToPoi({ ...row, type: "SHOP" } as never, "ethereum").layer).toBe("merchant");
    expect(companyPointToPoi({ ...row, type: "POS" } as never, "ethereum").coinSpecific).toBe(false);
  });
  it("falls back to the company logo + website when the point has none", () => {
    const p = companyPointToPoi({ ...row, logoUrl: null, website: null } as never, "bitcoin");
    expect(p.image).toBe("https://x/c.png");
    expect(p.website).toBe("https://acme.co");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/company-points.test.ts`
Expected: FAIL — cannot find module `@/lib/company-points`.

- [ ] **Step 3: Implement `src/lib/company-points.ts`**
```ts
import { prisma } from "@/lib/prisma";
import type { Bbox, Poi, PoiLayer, Social } from "@/lib/crypto-map";

// Shape returned by the prisma query in fetchApprovedPointsInBbox (point + its company).
export type PointWithCompany = {
  id: string; type: "SHOP" | "ATM" | "POS" | "SALES_OFFICE"; name: string; description: string | null;
  lat: number; lon: number; address: string | null; acceptedCoinIds: string[];
  logoUrl: string | null; openingHours: string | null; phone: string | null; website: string | null;
  socials: unknown;
  company: { displayName: string; logoUrl: string | null; website: string | null; socials: unknown };
};

function layerFor(type: PointWithCompany["type"]): PoiLayer {
  return type === "ATM" ? "atm" : "merchant";
}
function asSocials(raw: unknown): Social[] {
  return Array.isArray(raw) ? (raw as Social[]) : [];
}

// Convert a company-submitted point into the same Poi shape OSM points use, so the
// existing navigator card/markers render it unchanged. Company-level logo/website/
// socials are the fallback when the point omits its own.
export function companyPointToPoi(p: PointWithCompany, coinId: string): Poi {
  return {
    id: `company/${p.id}`,
    lat: p.lat,
    lon: p.lon,
    name: p.name,
    layer: layerFor(p.type),
    category: p.company.displayName,
    address: p.address,
    lightning: false,
    coinSpecific: p.acceptedCoinIds.includes(coinId.toLowerCase()),
    website: p.website ?? p.company.website ?? null,
    openingHours: p.openingHours,
    phone: p.phone,
    email: null,
    socials: asSocials(p.socials).length ? asSocials(p.socials) : asSocials(p.company.socials),
    image: p.logoUrl ?? p.company.logoUrl ?? null,
  };
}

// Approved company points whose coordinates fall inside the viewport bbox.
export async function fetchApprovedPointsInBbox(bbox: Bbox, coinId: string): Promise<Poi[]> {
  const rows = await prisma.companyPoint.findMany({
    where: {
      status: "APPROVED",
      lat: { gte: bbox.minLat, lte: bbox.maxLat },
      lon: { gte: bbox.minLon, lte: bbox.maxLon },
    },
    take: 500,
    include: { company: { select: { displayName: true, logoUrl: true, website: true, socials: true } } },
  });
  return rows.map((r) => companyPointToPoi(r as unknown as PointWithCompany, coinId));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/company-points.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/company-points.ts tests/company-points.test.ts
git commit -m "feat(business): map company points to navigator Poi shape"
```

---

## Task 4: Merge approved points into the POI API

**Files:**
- Modify: `src/app/api/crypto-map/poi/route.ts`

Approved points must appear immediately on approval, so they are queried fresh on every request and merged *after* the OSM cache lookup (only the OSM result stays cached).

- [ ] **Step 1: Edit the route**

Replace the body of `GET` from the `coinTags`/`cacheKey` block onward so OSM pois come from cache/fetch and company points are always merged fresh:
```ts
  const coinTags = coinPaymentTags(coin, symbol);
  const cacheKey = `cmap:poi:${coin}:${roundKey(bboxParam!)}`;

  let osm: Poi[] = [];
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(cacheKey);
    if (cached) {
      osm = JSON.parse(cached) as Poi[];
    } else {
      osm = await fetchPois(bbox, coinTags);
      try {
        await redis.set(cacheKey, JSON.stringify(osm), "EX", TTL);
      } catch {
        // best-effort cache write
      }
    }
  } catch {
    // OSM source/redis down — leave osm empty, still merge company points below.
  }

  let company: Poi[] = [];
  try {
    company = await fetchApprovedPointsInBbox(bbox, coin);
  } catch {
    // DB hiccup — degrade to OSM only.
  }

  return NextResponse.json({ pois: [...company, ...osm] });
```

- [ ] **Step 2: Update imports at the top of the file**
```ts
import { parseBbox, coinPaymentTags, fetchPois, type Poi } from "@/lib/crypto-map";
import { fetchApprovedPointsInBbox } from "@/lib/company-points";
```

- [ ] **Step 3: Verify build compiles**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx tsc --noEmit -p tsconfig.json` (or rely on `npm run build` in Task 11).
Expected: no type errors in `route.ts` / `company-points.ts`.

- [ ] **Step 4: Commit**
```bash
git add src/app/api/crypto-map/poi/route.ts
git commit -m "feat(navigator): merge approved company points into POI results"
```

---

## Task 5: Server helper + company actions

**Files:**
- Create: `src/lib/business.ts`
- Create: `src/app/actions/company.ts`

- [ ] **Step 1: Implement `src/lib/business.ts`**
```ts
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// The signed-in user's company (or null). Used to gate the /business cabinet.
export async function getViewerCompany() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { userId: null, company: null };
  const company = await prisma.company.findUnique({ where: { ownerUserId: userId } });
  return { userId, company };
}
```

- [ ] **Step 2: Implement `src/app/actions/company.ts`**
```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validateCompanyProfile, validateCompanyPoint } from "@/lib/company";
import type { PointType } from "@prisma/client";

const MAX_PENDING_POINTS = 20;

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

// Register the signed-in user as a COMPANY (Variant A: open, no pre-verification).
export async function registerCompany(input: { legalName: string; displayName: string }) {
  const userId = await requireUser();
  if (!userId) return { ok: false, reason: "unauth" };
  const existing = await prisma.company.findUnique({ where: { ownerUserId: userId } });
  if (existing) return { ok: false, reason: "already_company" };
  const v = validateCompanyProfile(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  await prisma.$transaction([
    prisma.company.create({
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
    }),
    prisma.user.update({ where: { id: userId }, data: { accountType: "COMPANY" } }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveCompanyProfile(input: Parameters<typeof validateCompanyProfile>[0]) {
  const userId = await requireUser();
  if (!userId) return { ok: false, reason: "unauth" };
  const company = await prisma.company.findUnique({ where: { ownerUserId: userId } });
  if (!company) return { ok: false, reason: "not_company" };
  const v = validateCompanyProfile(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  await prisma.company.update({ where: { id: company.id }, data: v.data });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function submitCompanyPoint(input: Parameters<typeof validateCompanyPoint>[0] & { socials?: { network: string; url: string }[] }) {
  const userId = await requireUser();
  if (!userId) return { ok: false, reason: "unauth" };
  const company = await prisma.company.findUnique({ where: { ownerUserId: userId } });
  if (!company) return { ok: false, reason: "not_company" };
  const v = validateCompanyPoint(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  const pending = await prisma.companyPoint.count({ where: { companyId: company.id, status: "PENDING" } });
  if (pending >= MAX_PENDING_POINTS) return { ok: false, reason: "too_many_pending" };
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
  return { ok: true };
}
```

- [ ] **Step 3: Verify it compiles** (covered by Task 11 build). No unit test — exercised manually + via build.

- [ ] **Step 4: Commit**
```bash
git add src/lib/business.ts src/app/actions/company.ts
git commit -m "feat(business): company registration + profile + point submission actions"
```

---

## Task 6: Admin moderation actions

**Files:**
- Create: `src/app/actions/admin-points.ts`

- [ ] **Step 1: Implement `src/app/actions/admin-points.ts`**
```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { logAdminAction } from "@/lib/admin/audit";

export async function approvePoint(input: { pointId: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const point = await prisma.companyPoint.findUnique({ where: { id: input.pointId } });
  if (!point) return { ok: false, reason: "not_found" };
  if (point.status !== "PENDING") return { ok: false, reason: "not_pending" };
  await prisma.companyPoint.update({
    where: { id: point.id },
    data: { status: "APPROVED", reviewedById: admin.userId, reviewedAt: new Date(), rejectReason: null },
  });
  await logAdminAction({
    actorId: admin.userId, action: "APPROVE_POINT", targetType: "CompanyPoint", targetId: point.id,
    details: { name: point.name, companyId: point.companyId },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectPoint(input: { pointId: string; rejectReason: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.rejectReason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };
  const point = await prisma.companyPoint.findUnique({ where: { id: input.pointId } });
  if (!point) return { ok: false, reason: "not_found" };
  if (point.status !== "PENDING") return { ok: false, reason: "not_pending" };
  await prisma.companyPoint.update({
    where: { id: point.id },
    data: { status: "REJECTED", reviewedById: admin.userId, reviewedAt: new Date(), rejectReason: reason },
  });
  await logAdminAction({
    actorId: admin.userId, action: "REJECT_POINT", targetType: "CompanyPoint", targetId: point.id,
    details: { reason },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 2: Commit**
```bash
git add src/app/actions/admin-points.ts
git commit -m "feat(admin): approve/reject company points"
```

---

## Task 7: Admin moderation queue page + row + nav tab

**Files:**
- Create: `src/app/[locale]/admin/business/page.tsx`
- Create: `src/components/admin/point-row.tsx`
- Modify: `src/components/admin/nav.tsx`

- [ ] **Step 1: Add the `business` tab** — `src/components/admin/nav.tsx`, in `TABS` after `requests`:
```ts
  { key: "business", path: "business" },
```

- [ ] **Step 2: Implement `src/components/admin/point-row.tsx`** (client)
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approvePoint, rejectPoint } from "@/app/actions/admin-points";

export type PointRowData = {
  id: string; type: string; name: string; description: string | null;
  lat: number; lon: number; address: string | null; acceptedCoinIds: string[];
  status: string; rejectReason: string | null; createdAt: string;
  companyName: string; website: string | null;
};

export function PointRow({ row }: { row: PointRowData }) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const router = useRouter();
  const act = (fn: () => Promise<{ ok: boolean }>) => start(async () => { await fn(); router.refresh(); });

  return (
    <div className="bg-card border border-hairline rounded-[16px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{row.name} <span className="num text-[11px] text-muted">· {row.type}</span></div>
          <div className="text-[13px] text-muted">{row.companyName}</div>
          {row.address && <div className="text-[12px] text-muted">{row.address}</div>}
          <div className="num text-[11px] text-muted">{row.lat.toFixed(5)}, {row.lon.toFixed(5)}</div>
          {row.acceptedCoinIds.length > 0 && (
            <div className="text-[11px] text-muted mt-1">coins: {row.acceptedCoinIds.join(", ")}</div>
          )}
          <a className="text-[12px] text-accent" target="_blank" rel="noopener noreferrer"
             href={`https://www.openstreetmap.org/?mlat=${row.lat}&mlon=${row.lon}#map=17/${row.lat}/${row.lon}`}>
            preview on map ↗
          </a>
        </div>
        {row.status === "PENDING" && (
          <div className="flex flex-col gap-2 shrink-0">
            <button type="button" disabled={pending} onClick={() => act(() => approvePoint({ pointId: row.id }))}
              className="text-[12px] px-3 py-1.5 rounded-md bg-up/15 text-up font-medium">Approve</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reject reason"
              className="text-[12px] bg-bg-tint border border-hairline rounded-md px-2 py-1" />
            <button type="button" disabled={pending || reason.trim().length < 3}
              onClick={() => act(() => rejectPoint({ pointId: row.id, rejectReason: reason }))}
              className="text-[12px] px-3 py-1.5 rounded-md bg-down/15 text-down font-medium">Reject</button>
          </div>
        )}
      </div>
      {row.status === "REJECTED" && row.rejectReason && (
        <div className="text-[12px] text-down mt-2">Rejected: {row.rejectReason}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement `src/app/[locale]/admin/business/page.tsx`** (mirror `admin/requests/page.tsx`)
```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { PointRow, type PointRowData } from "@/components/admin/point-row";

export const dynamic = "force-dynamic";

export default async function AdminBusinessPage({
  params, searchParams,
}: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { locale } = await params;
  const { tab } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const status = tab === "approved" ? "APPROVED" : tab === "rejected" ? "REJECTED" : "PENDING";

  const points = await prisma.companyPoint.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { company: { select: { displayName: true } } },
  });
  const rows: PointRowData[] = points.map((p) => ({
    id: p.id, type: p.type, name: p.name, description: p.description, lat: p.lat, lon: p.lon,
    address: p.address, acceptedCoinIds: p.acceptedCoinIds, status: p.status, rejectReason: p.rejectReason,
    createdAt: p.createdAt.toISOString(), companyName: p.company.displayName, website: p.website,
  }));

  return (
    <>
      <AdminNav locale={locale} active="business" />
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">Admin</div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">{t("business.title")}</h1>
        <p className="text-muted">{t("business.subtitle")}</p>
      </header>
      <div className="flex gap-2 mb-6">
        {(["pending", "approved", "rejected"] as const).map((s) => {
          const active = status.toLowerCase() === s;
          const href = s === "pending" ? "?" : `?tab=${s}`;
          return (
            <a key={s} href={href} className={active
              ? "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-foreground text-bg"
              : "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-card text-muted hover:text-foreground border border-hairline"}>
              {t(`status.${s.toUpperCase() as "PENDING" | "APPROVED" | "REJECTED"}`)}
            </a>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <div className="bg-card border border-hairline rounded-[20px] p-8 text-center text-muted">{t("business.empty")}</div>
      ) : (
        <div className="space-y-3">{rows.map((r) => <PointRow key={r.id} row={r} />)}</div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Commit**
```bash
git add src/components/admin/nav.tsx src/components/admin/point-row.tsx "src/app/[locale]/admin/business/page.tsx"
git commit -m "feat(admin): company-points moderation queue"
```

---

## Task 8: Business cabinet — point form (client, map pin-picker)

**Files:**
- Create: `src/components/business/point-form.tsx`

- [ ] **Step 1: Implement the form** — a minimal MapLibre pin-picker (mirror the navigator's draggable origin marker) plus fields; calls `submitCompanyPoint`.
```tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import maplibregl, { Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { submitCompanyPoint } from "@/app/actions/company";

const PRAGUE: [number, number] = [14.4212535, 50.0874654];
const TYPES = ["SHOP", "ATM", "POS", "SALES_OFFICE"] as const;

export function PointForm({ coins }: { coins: { id: string; symbol: string }[] }) {
  const t = useTranslations("business");
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<Marker | null>(null);
  const [pos, setPos] = useState<[number, number] | null>(null);
  const [type, setType] = useState<(typeof TYPES)[number]>("SHOP");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [accepted, setAccepted] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: { d: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OSM © CARTO" } }, layers: [{ id: "d", type: "raster", source: "d" }] },
      center: PRAGUE, zoom: 12,
    });
    const place = (lng: number, lat: number) => {
      setPos([lng, lat]);
      if (markerRef.current) markerRef.current.setLngLat([lng, lat]);
      else {
        const mk = new Marker({ color: "#FE5C04", draggable: true }).setLngLat([lng, lat]).addTo(map);
        mk.on("dragend", () => { const l = mk.getLngLat(); setPos([l.lng, l.lat]); });
        markerRef.current = mk;
      }
    };
    map.on("click", (e) => place(e.lngLat.lng, e.lngLat.lat));
    return () => map.remove();
  }, []);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await submitCompanyPoint({
        type, name, address, lat: pos?.[1] ?? null, lon: pos?.[0] ?? null, acceptedCoinIds: accepted,
      });
      if (res.ok) { setMsg(t("pointSubmitted")); setName(""); setAddress(""); setAccepted([]); router.refresh(); }
      else setMsg(t(`err.${res.reason}`) ?? t("err.generic"));
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TYPES.map((tp) => (
          <button key={tp} type="button" onClick={() => setType(tp)}
            className={`text-[12px] px-3 py-1.5 rounded-md border ${type === tp ? "bg-foreground text-bg" : "border-hairline text-muted"}`}>
            {t(`type.${tp}`)}
          </button>
        ))}
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("pointName")}
        className="w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]" />
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("pointAddress")}
        className="w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]" />
      <p className="text-[12px] text-muted">{t("clickMapToPlace")}</p>
      <div ref={containerRef} className="w-full h-[320px] rounded-md overflow-hidden border border-hairline" />
      <div className="text-[12px] text-muted">{t("acceptedCoins")}:</div>
      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
        {coins.map((c) => {
          const on = accepted.includes(c.id);
          return (
            <button key={c.id} type="button"
              onClick={() => setAccepted((a) => on ? a.filter((x) => x !== c.id) : [...a, c.id])}
              className={`text-[11px] px-2 py-1 rounded-md border ${on ? "bg-accent/15 text-accent border-accent/40" : "border-hairline text-muted"}`}>
              {c.symbol.toUpperCase()}
            </button>
          );
        })}
      </div>
      <button type="button" disabled={pending || !pos || !name.trim()} onClick={save}
        className="text-[13px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground disabled:opacity-50">
        {t("submitPoint")}
      </button>
      {msg && <p className="text-[13px] text-accent">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add src/components/business/point-form.tsx
git commit -m "feat(business): point submission form with map pin-picker"
```

---

## Task 9: Business cabinet — profile form, points list, page

**Files:**
- Create: `src/components/business/company-profile-form.tsx`
- Create: `src/components/business/points-list.tsx`
- Create: `src/app/[locale]/business/page.tsx`

- [ ] **Step 1: Implement `src/components/business/company-profile-form.tsx`** (client) — handles both register (no company yet) and edit.
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { registerCompany, saveCompanyProfile } from "@/app/actions/company";

type Initial = { legalName: string; displayName: string; description: string; website: string; logoUrl: string; address: string; phone: string; email: string; country: string };

export function CompanyProfileForm({ mode, initial }: { mode: "register" | "edit"; initial?: Partial<Initial> }) {
  const t = useTranslations("business");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState<Initial>({
    legalName: initial?.legalName ?? "", displayName: initial?.displayName ?? "", description: initial?.description ?? "",
    website: initial?.website ?? "", logoUrl: initial?.logoUrl ?? "", address: initial?.address ?? "",
    phone: initial?.phone ?? "", email: initial?.email ?? "", country: initial?.country ?? "",
  });
  const set = (k: keyof Initial) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  function save() {
    setMsg(null);
    start(async () => {
      const res = mode === "register"
        ? await registerCompany({ legalName: f.legalName, displayName: f.displayName })
        : await saveCompanyProfile(f);
      if (res.ok) { setMsg(t("profileSaved")); router.refresh(); }
      else setMsg(t(`err.${res.reason}`) ?? t("err.generic"));
    });
  }

  const input = "w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]";
  return (
    <div className="space-y-3">
      <input className={input} value={f.legalName} onChange={set("legalName")} placeholder={t("legalName")} />
      <input className={input} value={f.displayName} onChange={set("displayName")} placeholder={t("displayName")} />
      {mode === "edit" && (
        <>
          <textarea className={input} value={f.description} onChange={set("description")} placeholder={t("description")} rows={4} />
          <input className={input} value={f.logoUrl} onChange={set("logoUrl")} placeholder={t("logoUrl")} />
          <input className={input} value={f.website} onChange={set("website")} placeholder={t("website")} />
          <input className={input} value={f.address} onChange={set("address")} placeholder={t("address")} />
          <input className={input} value={f.phone} onChange={set("phone")} placeholder={t("phone")} />
          <input className={input} value={f.email} onChange={set("email")} placeholder={t("email")} />
          <input className={input} value={f.country} onChange={set("country")} placeholder={t("country")} />
        </>
      )}
      <button type="button" disabled={pending || !f.legalName.trim() || !f.displayName.trim()} onClick={save}
        className="text-[13px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground disabled:opacity-50">
        {mode === "register" ? t("registerCompany") : t("saveProfile")}
      </button>
      {msg && <p className="text-[13px] text-accent">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Implement `src/components/business/points-list.tsx`** (server, presentational)
```tsx
import { getTranslations } from "next-intl/server";

export type PointListItem = { id: string; name: string; type: string; status: string; rejectReason: string | null };

export async function PointsList({ points }: { points: PointListItem[] }) {
  const t = await getTranslations("business");
  if (points.length === 0) return <p className="text-muted text-[13px]">{t("noPoints")}</p>;
  const badge = (s: string) =>
    s === "APPROVED" ? "bg-up/15 text-up" : s === "REJECTED" ? "bg-down/15 text-down" : "bg-accent/15 text-accent";
  return (
    <div className="space-y-2">
      {points.map((p) => (
        <div key={p.id} className="bg-card border border-hairline rounded-[14px] p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium truncate">{p.name} <span className="num text-[11px] text-muted">· {t(`type.${p.type}`)}</span></div>
            {p.status === "REJECTED" && p.rejectReason && <div className="text-[12px] text-down">{p.rejectReason}</div>}
          </div>
          <span className={`num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium ${badge(p.status)}`}>
            {t(`status.${p.status}`)}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Implement `src/app/[locale]/business/page.tsx`**
```tsx
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getViewerCompany } from "@/lib/business";
import { readTop100 } from "@/lib/snapshot";
import { CompanyProfileForm } from "@/components/business/company-profile-form";
import { PointForm } from "@/components/business/point-form";
import { PointsList, type PointListItem } from "@/components/business/points-list";

export const dynamic = "force-dynamic";

export default async function BusinessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("business");
  const { userId, company } = await getViewerCompany();
  if (!userId) redirect(`/${locale}/login`);

  if (!company) {
    return (
      <main className="max-w-[720px] mx-auto px-4 md:px-12 py-12">
        <h1 className="text-[36px] font-bold tracking-[-0.03em] mb-2">{t("title")}</h1>
        <p className="text-muted mb-6">{t("registerIntro")}</p>
        <CompanyProfileForm mode="register" />
      </main>
    );
  }

  const [points, coins] = await Promise.all([
    prisma.companyPoint.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    readTop100(),
  ]);
  const items: PointListItem[] = points.map((p) => ({ id: p.id, name: p.name, type: p.type, status: p.status, rejectReason: p.rejectReason }));
  const coinOpts = coins.map((c) => ({ id: c.id, symbol: c.symbol }));

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-12 space-y-12">
      <section>
        <h1 className="text-[36px] font-bold tracking-[-0.03em] mb-1">{company.displayName}</h1>
        <p className="text-muted mb-6">{t("profileIntro")}</p>
        <CompanyProfileForm mode="edit" initial={{
          legalName: company.legalName, displayName: company.displayName, description: company.description ?? "",
          website: company.website ?? "", logoUrl: company.logoUrl ?? "", address: company.address ?? "",
          phone: company.phone ?? "", email: company.email ?? "", country: company.country ?? "",
        }} />
      </section>
      <section>
        <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">{t("yourPoints")}</h2>
        <PointsList points={items} />
      </section>
      <section>
        <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">{t("addPoint")}</h2>
        <PointForm coins={coinOpts} />
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Commit**
```bash
git add src/components/business "src/app/[locale]/business/page.tsx"
git commit -m "feat(business): company cabinet (profile, points list, add point)"
```

---

## Task 10: Navbar link + i18n

**Files:**
- Modify: `src/components/navbar.tsx`
- Modify: `messages/*.json` (10)

- [ ] **Step 1: Add a "Business" link** in `src/components/navbar.tsx` (both mobile and desktop `<nav>`), after the Markets link, using `{t("business")}` → `/${locale}/business`. Match the surrounding link markup exactly (copy the Markets `<Link>` and swap href/label).

- [ ] **Step 2: Add i18n keys** — run this script:
```bash
cd /home/dv/trientes
python3 - <<'PY'
import json
common = {"en":"Business","ru":"Бизнес","de":"Business","es":"Empresas","fr":"Entreprises","ja":"ビジネス","ko":"비즈니스","pt-BR":"Empresas","tr":"İşletme","zh-CN":"企业"}
admin_tab = {"en":"Business","ru":"Бизнес","de":"Business","es":"Empresas","fr":"Entreprises","ja":"ビジネス","ko":"비즈니스","pt-BR":"Empresas","tr":"İşletme","zh-CN":"企业"}
# business namespace — fill all locales (en shown; translate the rest similarly)
B = {
 "en": {"title":"Business cabinet","registerIntro":"Register your company to add crypto-accepting locations to the map.","profileIntro":"Your public company profile.","registerCompany":"Register company","saveProfile":"Save profile","profileSaved":"Saved","legalName":"Legal name","displayName":"Display name","description":"About the company","logoUrl":"Logo URL","website":"Website","address":"Address","phone":"Phone","email":"Email","country":"Country","yourPoints":"Your points","addPoint":"Add a point","noPoints":"No points yet.","pointName":"Point name","pointAddress":"Address","clickMapToPlace":"Click the map to place the point (drag to adjust).","acceptedCoins":"Accepted coins","submitPoint":"Submit for review","pointSubmitted":"Submitted for review",
   "type":{"SHOP":"Shop","ATM":"ATM","POS":"POS","SALES_OFFICE":"Sales office"},
   "status":{"PENDING":"Pending","APPROVED":"Approved","REJECTED":"Rejected"},
   "err":{"unauth":"Please sign in","already_company":"You already have a company","not_company":"Register a company first","legal_name_required":"Legal name is required","display_name_required":"Display name is required","website_invalid":"Invalid website URL","logo_invalid":"Invalid logo URL","type_invalid":"Pick a point type","name_required":"Name is required","coords_invalid":"Place the point on the map","too_many_pending":"Too many pending points","generic":"Something went wrong"}},
}
# NOTE for implementer: translate B["en"] into ru/de/es/fr/ja/ko/pt-BR/tr/zh-CN with the
# same keys/structure before running on all locales. Proper nouns (POS, ATM) may stay.
for loc, path in [(l, f"messages/{l}.json") for l in common]:
    d = json.load(open(path, encoding="utf-8"))
    d.setdefault("common", {})["business"] = common[loc]
    d.setdefault("admin", {}).setdefault("tabs", {})["business"] = admin_tab[loc]
    d.setdefault("admin", {})["business"] = {"title":{"en":"Company points","ru":"Точки компаний"}.get(loc,"Company points"),"subtitle":{"en":"Moderate submitted locations.","ru":"Модерация присланных точек."}.get(loc,"Moderate submitted locations."),"empty":{"en":"Nothing here.","ru":"Пусто."}.get(loc,"Nothing here.")}
    d["business"] = B.get(loc, B["en"])  # implementer: replace with per-locale translations
    open(path,"w",encoding="utf-8").write(json.dumps(d, ensure_ascii=False, indent=2)+"\n")
    print(loc,"ok")
PY
```
> **Implementer note:** the script above falls back to English for the `business` namespace on non-en locales. Before committing, translate `B["en"]` into each locale (ru/de/es/fr/ja/ko/pt-BR/tr/zh-CN), keeping identical keys, and the `admin.business` title/subtitle/empty for all 10. Mirror the tone of existing translations.

- [ ] **Step 3: Verify JSON validity**

Run: `for f in messages/*.json; do python3 -c "import json,sys; json.load(open('$f'))" || echo "BAD $f"; done`
Expected: no "BAD" output.

- [ ] **Step 4: Commit**
```bash
git add src/components/navbar.tsx messages/*.json
git commit -m "feat(business): navbar link + i18n (business namespace)"
```

---

## Task 11: Build, deploy, manual verification

- [ ] **Step 1: Full test suite**

Run: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" && npx vitest run`
Expected: all green (existing 293 + new company/company-points tests).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: completes; routes `/[locale]/business` and `/[locale]/admin/business` listed.

- [ ] **Step 3: Deploy (web only — worker imports none of the new modules)**
```bash
pm2 restart trientes-web --update-env && pm2 save
curl -s -o /dev/null -w "%{http_code}\n" https://trientes.org/api/health   # expect 200
git push origin main
```

- [ ] **Step 4: Manual verification**
1. Sign in → open `/en/business` → register a company → confirm cabinet shows profile + empty points.
2. Add a point: pick a type, name, click the map to drop the pin, select a coin, submit → appears in "Your points" as Pending.
3. As ADMIN open `/en/admin/business` → the point is in the Pending queue → Approve.
4. Open the coin's page whose coin you selected → Crypto Navigator, pan to the point's area → the company point shows with its card (logo, address, socials, "route here"); if the coin matches, it has the coin-specific white ring.
5. Reject flow: submit another point, Reject with a reason → it shows Rejected + reason in the cabinet and never appears on the map.

---

## Self-Review (completed by plan author)

- **Spec coverage:** account types (T1) ✓; Company profile + registration (T1,T5,T9) ✓; CompanyPoint submission with map pin (T2,T5,T8) ✓; per-point moderation + AdminAuditLog (T6,T7) ✓; publish approved points to navigator by bbox (T3,T4) ✓; rate limit (T5) ✓; admin notification queue (T7) ✓; i18n ×10 (T10) ✓; tests (T2,T3) ✓; deploy (T11) ✓. Out-of-scope items (online services, token listing, individual side, Telegram ping, KYB) intentionally not tasked — per spec.
- **Placeholders:** none in code; the only deferred work is per-locale translation of the `business` namespace in T10, explicitly flagged with the English source provided.
- **Type consistency:** `Poi`/`Social`/`Bbox` imported from `crypto-map`; `PointRowData`/`PointListItem` defined where used; action return shape `{ ok; reason? }` consistent across `company.ts`/`admin-points.ts`; `companyPointToPoi` signature matches its test and its caller in T4.
