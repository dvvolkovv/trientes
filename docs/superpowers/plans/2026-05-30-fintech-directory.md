# Fintech Directory (Phase 10, Slice 7) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public catalog of fintech companies that integrate crypto into financial products (Revolut, Wirex, Mercuryo, Crypto.com, Nexo, …), with two ingestion paths (admin-curated + user self-registration) and Crypto Navigator integration (HQ pin + "available here" contextual list).

**Architecture:** New Prisma model `FintechCompany` + enums `FintechService`, `FintechKyc`. Mirror the `RegisteredExchange` pattern for self-registration with `@unique` on `ownerUserId`; mirror the `Exchange` pattern's `source` field for the curated/registered distinction. Reuse existing `RequestStatus` and `AdminAction` (extending the latter with four new actions). Navigator integration is two surfaces: a third POI source merged in `/api/crypto-map/poi` for HQ pins (alongside OSM + company-points), and a new `/api/fintech/available?cc=XX` endpoint feeding a side panel keyed off the navigator's map-center → reverse-geocoded country.

**Tech Stack:** Next.js 16 (app router), Prisma 5 + PostgreSQL 16, Auth.js v5 (database session strategy, unchanged), next-intl, Tailwind v4, MapLibre GL (navigator), vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-05-30-fintech-directory-design.md`

**Reused helpers (do NOT redefine):**
- `prisma` — `src/lib/prisma.ts`
- `auth()` — `src/auth.ts`. User id: `(session?.user as { id?: string }).id`.
- `Bbox`, `parseBbox`, `Poi`, `PoiLayer`, `Social` — `src/lib/crypto-map.ts`
- `companyPointToPoi`, `fetchApprovedPointsInBbox` (pattern) — `src/lib/company-points.ts`
- `SUPPORTED_LOCALES`, `LOCALE_LABELS`, `Locale` — `src/lib/locales.ts`
- `RequestStatus` enum, `AdminAction` enum — `prisma/schema.prisma`
- `recordAdminAudit` (if exists) or direct `prisma.adminAuditLog.create` — match what `/api/admin/business` does
- `enforceRateLimit` (or whatever the existing helper is called) — `src/lib/rate-limit.ts`
- Country reverse-geocode — `/api/crypto-map/geocode` (already in production)

**Deploy note:** Worker (`trientes-worker`) does NOT import any of the new files (`src/lib/fintech.ts`, `fintech-pois.ts`, `available-fintech.ts`). Web-only restart suffices for deploy. Final deploy in Task 17.

---

## File Structure

**New files:**
- `prisma/migrations/20260530180000_fintech_directory/migration.sql`
- `src/lib/fintech.ts` — Zod schemas, ISO-3166/ISO-4217 constants, social sanitizer, slug check
- `src/lib/fintech-pois.ts` — `fetchApprovedFintechHqInBbox(bbox)` + `fintechToPoi(row)` mapper
- `src/lib/available-fintech.ts` — `fintechsAvailableIn(cc)` + 1h Redis cache
- `src/app/api/business/fintech/route.ts` — `POST` (create/update own)
- `src/app/api/admin/fintech/route.ts` — `GET` (list), `POST` (create curated)
- `src/app/api/admin/fintech/[id]/route.ts` — `PATCH` (edit/approve/reject), `DELETE`
- `src/app/api/fintech/available/route.ts` — `GET ?cc=XX`
- `src/app/[locale]/fintech/page.tsx` — public catalog
- `src/app/[locale]/fintech/[slug]/page.tsx` — public detail
- `src/app/[locale]/business/fintech/page.tsx` — self-registration form
- `src/app/[locale]/admin/fintech/page.tsx` — moderation queue + CRUD
- `src/components/fintech/fintech-card.tsx` — directory grid card
- `src/components/fintech/fintech-filters.tsx` — filter UI (client)
- `src/components/fintech/fintech-form.tsx` — shared form for business + admin
- `src/components/crypto-map/available-fintech-panel.tsx` — navigator side panel (client)
- `tests/fintech-validation.test.ts`
- `tests/fintech-pois.test.ts`
- `tests/available-fintech.test.ts`

**Modified files:**
- `prisma/schema.prisma` — add model + enums + 2 back-relations on `User`
- `src/app/api/crypto-map/poi/route.ts` — merge HQ POIs
- `src/components/crypto-map/map.tsx` (or equivalent navigator UI entry) — `FINTECH_HQ` marker style + popup; mount `<AvailableFintechPanel/>`
- `src/components/navbar.tsx` (or `site-header.tsx`) — add "Fintech" nav link
- `src/app/[locale]/admin/layout.tsx` — add Fintech tab to admin sub-nav
- `src/app/[locale]/business/layout.tsx` (if exists; otherwise nothing) — add Fintech tab for COMPANY users
- 10 × `messages/<locale>.json` — new keys

---

## Task 1: Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260530180000_fintech_directory/migration.sql`

- [ ] **Step 1.1: Add enums and model to schema**

Add after the existing `enum PointType` block in `prisma/schema.prisma`:

```prisma
enum FintechService {
  CARD
  IBAN
  SEPA
  SWIFT
  SAVINGS
  CRYPTO_LOANS
  STAKING
  EXCHANGE
  CUSTODY
  PAYMENTS
  ONRAMP
  OFFRAMP
}

enum FintechKyc {
  NONE
  BASIC
  FULL
}

model FintechCompany {
  id              String           @id @default(cuid())
  slug            String           @unique
  displayName     String
  legalName       String?
  logoUrl         String?
  description     String?          @db.Text
  website         String
  socials         Json?
  foundedYear     Int?

  countryCode     String?
  city            String?
  address         String?
  hqLat           Float?
  hqLon           Float?

  services        FintechService[]
  supportedCoinIds String[]
  supportedFiats  String[]
  availableIn     String[]

  kycLevel        FintechKyc?
  feesSummary     String?          @db.Text
  appStoreUrl     String?
  playStoreUrl    String?

  source          String           @default("curated")
  ownerUserId     String?          @unique
  owner           User?            @relation("FintechOwner", fields: [ownerUserId], references: [id], onDelete: Cascade)

  status          RequestStatus    @default(APPROVED)
  rejectionReason String?
  reviewedById    String?
  reviewer        User?            @relation("FintechReviewer", fields: [reviewedById], references: [id])
  reviewedAt      DateTime?

  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@index([status, displayName])
  @@index([source])
}
```

- [ ] **Step 1.2: Add back-relations on `User`**

In the `model User` block, append to the list of relations:

```prisma
  ownedFintech       FintechCompany?    @relation("FintechOwner")
  reviewedFintechs   FintechCompany[]   @relation("FintechReviewer")
```

- [ ] **Step 1.3: Extend `AdminAction` enum**

In `enum AdminAction`, append:

```prisma
  APPROVE_FINTECH
  REJECT_FINTECH
  EDIT_FINTECH
  CREATE_FINTECH
  DELETE_FINTECH
```

- [ ] **Step 1.4: Generate the migration**

Run: `npx prisma migrate dev --name fintech_directory --create-only`

Expected: a new directory `prisma/migrations/20260530XXXXXX_fintech_directory/` is created. Rename the timestamp portion to `20260530180000` (`mv prisma/migrations/2026053*_fintech_directory prisma/migrations/20260530180000_fintech_directory`).

- [ ] **Step 1.5: Inspect the generated SQL**

Open `prisma/migrations/20260530180000_fintech_directory/migration.sql`. Verify:
- `CREATE TYPE "FintechService" AS ENUM (...)` with all 12 values
- `CREATE TYPE "FintechKyc" AS ENUM ('NONE', 'BASIC', 'FULL')`
- `ALTER TYPE "AdminAction" ADD VALUE 'APPROVE_FINTECH'` (and others)
- `CREATE TABLE "FintechCompany"` with all columns
- `CREATE UNIQUE INDEX "FintechCompany_slug_key"` and `CREATE UNIQUE INDEX "FintechCompany_ownerUserId_key"`
- Foreign keys to `User`

- [ ] **Step 1.6: Apply the migration**

Run: `npx prisma migrate dev` (no flags — applies the renamed migration)
Expected: "Database is now in sync" message; `node_modules/.prisma/client` regenerated.

- [ ] **Step 1.7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260530180000_fintech_directory
git commit -m "feat(fintech): add FintechCompany model + migration"
```

---

## Task 2: Validation library

**Files:**
- Create: `src/lib/fintech.ts`
- Create: `tests/fintech-validation.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `tests/fintech-validation.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  fintechCreateSchema,
  sanitizeFintechSocials,
  isValidCountryCode,
  isValidFiat,
  SLUG_RE,
} from "@/lib/fintech";

describe("SLUG_RE", () => {
  it("accepts lowercase + digits + hyphen, 2-40 chars", () => {
    expect(SLUG_RE.test("revolut")).toBe(true);
    expect(SLUG_RE.test("crypto-com")).toBe(true);
    expect(SLUG_RE.test("a")).toBe(false);
    expect(SLUG_RE.test("UPPER")).toBe(false);
    expect(SLUG_RE.test("with space")).toBe(false);
    expect(SLUG_RE.test("a".repeat(41))).toBe(false);
  });
});

describe("isValidCountryCode", () => {
  it("accepts ISO-3166-1 alpha-2 codes", () => {
    expect(isValidCountryCode("US")).toBe(true);
    expect(isValidCountryCode("GB")).toBe(true);
    expect(isValidCountryCode("XX")).toBe(false);
    expect(isValidCountryCode("us")).toBe(false);
  });
});

describe("isValidFiat", () => {
  it("accepts known ISO-4217 codes", () => {
    expect(isValidFiat("USD")).toBe(true);
    expect(isValidFiat("EUR")).toBe(true);
    expect(isValidFiat("XYZ")).toBe(false);
  });
});

describe("sanitizeFintechSocials", () => {
  it("drops non-http(s) urls", () => {
    expect(
      sanitizeFintechSocials([
        { network: "twitter", url: "https://x.com/revolut" },
        { network: "evil", url: "javascript:alert(1)" },
      ]),
    ).toEqual([{ network: "twitter", url: "https://x.com/revolut" }]);
  });
  it("drops empty network or non-string url", () => {
    expect(
      sanitizeFintechSocials([
        { network: "", url: "https://x.com/" },
        { network: "tg", url: 123 as unknown as string },
        { network: "tg", url: "https://t.me/x" },
      ]),
    ).toEqual([{ network: "tg", url: "https://t.me/x" }]);
  });
  it("returns [] for non-array input", () => {
    expect(sanitizeFintechSocials({} as unknown)).toEqual([]);
    expect(sanitizeFintechSocials(null)).toEqual([]);
  });
  it("caps at 10 entries", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ network: `n${i}`, url: `https://x/${i}` }));
    expect(sanitizeFintechSocials(many)).toHaveLength(10);
  });
});

describe("fintechCreateSchema", () => {
  const valid = {
    slug: "revolut",
    displayName: "Revolut",
    website: "https://revolut.com",
    services: ["CARD", "IBAN"],
    availableIn: ["GB", "US"],
    supportedCoinIds: ["bitcoin", "ethereum"],
    supportedFiats: ["USD", "EUR"],
  };

  it("accepts a minimal valid payload", () => {
    expect(fintechCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects bad slug", () => {
    expect(fintechCreateSchema.safeParse({ ...valid, slug: "Bad Slug" }).success).toBe(false);
  });

  it("rejects non-http website", () => {
    expect(fintechCreateSchema.safeParse({ ...valid, website: "ftp://x" }).success).toBe(false);
  });

  it("rejects (0,0) HQ coords", () => {
    expect(fintechCreateSchema.safeParse({ ...valid, hqLat: 0, hqLon: 0 }).success).toBe(false);
  });

  it("requires both hqLat and hqLon if either is provided", () => {
    expect(fintechCreateSchema.safeParse({ ...valid, hqLat: 51.5 }).success).toBe(false);
    expect(fintechCreateSchema.safeParse({ ...valid, hqLat: 51.5, hqLon: -0.1 }).success).toBe(true);
  });

  it("caps array sizes", () => {
    const big = Array.from({ length: 31 }, () => "US");
    expect(fintechCreateSchema.safeParse({ ...valid, availableIn: big }).success).toBe(false);
  });

  it("rejects unknown country code in availableIn", () => {
    expect(fintechCreateSchema.safeParse({ ...valid, availableIn: ["ZZ"] }).success).toBe(false);
  });
});
```

- [ ] **Step 2.2: Run test to verify failure**

Run: `npx vitest run tests/fintech-validation.test.ts`
Expected: FAIL — module `@/lib/fintech` does not exist.

- [ ] **Step 2.3: Implement `src/lib/fintech.ts`**

```typescript
import { z } from "zod";

export const SLUG_RE = /^[a-z0-9-]{2,40}$/;

// ISO-3166-1 alpha-2. Sourced from Unicode CLDR. Kept inline as a Set for O(1) check.
const ISO_3166_ALPHA2 = new Set<string>([
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ",
  "CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ",
  "DE","DJ","DK","DM","DO","DZ",
  "EC","EE","EG","EH","ER","ES","ET",
  "FI","FJ","FK","FM","FO","FR",
  "GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY",
  "HK","HM","HN","HR","HT","HU",
  "ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT",
  "JE","JM","JO","JP",
  "KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ",
  "LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY",
  "MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ",
  "NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ",
  "OM",
  "PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY",
  "QA",
  "RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ",
  "TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ",
  "UA","UG","UM","US","UY","UZ",
  "VA","VC","VE","VG","VI","VN","VU",
  "WF","WS",
  "YE","YT",
  "ZA","ZM","ZW",
]);

// ISO-4217. Limited to currencies fintechs realistically support.
const ISO_4217 = new Set<string>([
  "USD","EUR","GBP","CHF","JPY","CNY","HKD","SGD","AUD","CAD","NZD",
  "SEK","NOK","DKK","PLN","CZK","HUF","RON","BGN","HRK","ISK",
  "TRY","UAH","RUB","KZT","GEL",
  "AED","SAR","QAR","ILS",
  "INR","IDR","THB","VND","MYR","PHP","KRW","TWD",
  "BRL","MXN","ARS","CLP","COP","PEN",
  "ZAR","NGN","KES","EGP",
]);

export const FINTECH_SERVICES = [
  "CARD","IBAN","SEPA","SWIFT","SAVINGS","CRYPTO_LOANS",
  "STAKING","EXCHANGE","CUSTODY","PAYMENTS","ONRAMP","OFFRAMP",
] as const;

export const FINTECH_KYC = ["NONE","BASIC","FULL"] as const;

export function isValidCountryCode(cc: string): boolean {
  return ISO_3166_ALPHA2.has(cc);
}

export function isValidFiat(code: string): boolean {
  return ISO_4217.has(code);
}

export type FintechSocial = { network: string; url: string };

export function sanitizeFintechSocials(raw: unknown): FintechSocial[] {
  if (!Array.isArray(raw)) return [];
  const out: FintechSocial[] = [];
  for (const item of raw) {
    if (out.length >= 10) break;
    if (!item || typeof item !== "object") continue;
    const network = (item as { network?: unknown }).network;
    const url = (item as { url?: unknown }).url;
    if (typeof network !== "string" || !network.trim()) continue;
    if (typeof url !== "string") continue;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    } catch {
      continue;
    }
    out.push({ network: network.trim(), url });
  }
  return out;
}

const httpUrl = z.string().url().refine((s) => {
  try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}, "must be http(s) URL");

const optionalHttpUrl = httpUrl.optional().nullable();

export const fintechCreateSchema = z
  .object({
    slug: z.string().regex(SLUG_RE, "invalid slug"),
    displayName: z.string().min(2).max(80),
    legalName: z.string().max(120).optional().nullable(),
    logoUrl: optionalHttpUrl,
    description: z.string().max(4000).optional().nullable(),
    website: httpUrl,
    socials: z.array(z.object({ network: z.string().min(1).max(40), url: httpUrl })).max(10).optional().nullable(),
    foundedYear: z.number().int().min(1900).max(2100).optional().nullable(),

    countryCode: z.string().refine(isValidCountryCode, "unknown country").optional().nullable(),
    city: z.string().max(80).optional().nullable(),
    address: z.string().max(200).optional().nullable(),
    hqLat: z.number().min(-90).max(90).optional().nullable(),
    hqLon: z.number().min(-180).max(180).optional().nullable(),

    services: z.array(z.enum(FINTECH_SERVICES)).max(FINTECH_SERVICES.length),
    supportedCoinIds: z.array(z.string().min(1).max(60)).max(30),
    supportedFiats: z.array(z.string().refine(isValidFiat, "unknown fiat")).max(20),
    availableIn: z.array(z.string().refine(isValidCountryCode, "unknown country")).max(30),

    kycLevel: z.enum(FINTECH_KYC).optional().nullable(),
    feesSummary: z.string().max(2000).optional().nullable(),
    appStoreUrl: optionalHttpUrl,
    playStoreUrl: optionalHttpUrl,
  })
  .superRefine((v, ctx) => {
    const hasLat = v.hqLat !== undefined && v.hqLat !== null;
    const hasLon = v.hqLon !== undefined && v.hqLon !== null;
    if (hasLat !== hasLon) {
      ctx.addIssue({ code: "custom", message: "hqLat and hqLon must both be provided", path: ["hqLat"] });
    }
    if (hasLat && hasLon && v.hqLat === 0 && v.hqLon === 0) {
      ctx.addIssue({ code: "custom", message: "(0,0) is not a valid location", path: ["hqLat"] });
    }
  });

export type FintechCreateInput = z.infer<typeof fintechCreateSchema>;
```

- [ ] **Step 2.4: Run tests to verify pass**

Run: `npx vitest run tests/fintech-validation.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/fintech.ts tests/fintech-validation.test.ts
git commit -m "feat(fintech): validation schema + ISO constants + socials sanitizer"
```

---

## Task 3: HQ POI mapper

**Files:**
- Create: `src/lib/fintech-pois.ts`
- Create: `tests/fintech-pois.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `tests/fintech-pois.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { fintechToPoi } from "@/lib/fintech-pois";

const row = {
  id: "ckft1",
  slug: "revolut",
  displayName: "Revolut",
  logoUrl: "https://x/r.png",
  description: "Neobank with crypto",
  website: "https://revolut.com",
  hqLat: 51.5074,
  hqLon: -0.1278,
  address: "7 Westferry Circus, London",
  services: ["CARD", "IBAN", "EXCHANGE"],
  socials: [{ network: "twitter", url: "https://x.com/revolut" }],
};

describe("fintechToPoi", () => {
  it("maps a fintech HQ to a Poi with a fintech/ id prefix", () => {
    const p = fintechToPoi(row as never);
    expect(p.id).toBe("fintech/ckft1");
    expect(p.lat).toBe(51.5074);
    expect(p.lon).toBe(-0.1278);
    expect(p.layer).toBe("fintech");
    expect(p.name).toBe("Revolut");
    expect(p.image).toBe("https://x/r.png");
    expect(p.website).toBe("https://revolut.com");
    expect(p.address).toBe("7 Westferry Circus, London");
  });
  it("drops malicious socials (XSS guard)", () => {
    const dirty = { ...row, socials: [{ network: "evil", url: "javascript:alert(1)" }] };
    const p = fintechToPoi(dirty as never);
    expect(p.socials).toEqual([]);
  });
  it("returns coinSpecific=false (HQ pin is not coin-aware)", () => {
    expect(fintechToPoi(row as never).coinSpecific).toBe(false);
  });
});
```

- [ ] **Step 3.2: Run to verify failure**

Run: `npx vitest run tests/fintech-pois.test.ts`
Expected: FAIL — module `@/lib/fintech-pois` does not exist; layer "fintech" not in PoiLayer.

- [ ] **Step 3.3: Extend `PoiLayer` in `src/lib/crypto-map.ts`**

Locate `export type PoiLayer = ...` in `src/lib/crypto-map.ts`. Add `"fintech"` to the union. Example: if current value is `"atm" | "merchant"`, change to `"atm" | "merchant" | "fintech"`.

- [ ] **Step 3.4: Implement `src/lib/fintech-pois.ts`**

```typescript
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Bbox, Poi } from "@/lib/crypto-map";
import { sanitizeFintechSocials } from "@/lib/fintech";

export type FintechHqRow = Prisma.FintechCompanyGetPayload<{
  select: {
    id: true; slug: true; displayName: true; logoUrl: true; description: true;
    website: true; hqLat: true; hqLon: true; address: true; services: true; socials: true;
  };
}>;

export function fintechToPoi(row: FintechHqRow): Poi {
  return {
    id: `fintech/${row.id}`,
    lat: row.hqLat!,
    lon: row.hqLon!,
    name: row.displayName,
    layer: "fintech",
    category: row.services.join(", "),
    address: row.address,
    lightning: false,
    coinSpecific: false,
    website: row.website,
    openingHours: null,
    phone: null,
    email: null,
    socials: sanitizeFintechSocials(row.socials),
    image: row.logoUrl,
    description: row.description,
  };
}

export async function fetchApprovedFintechHqInBbox(bbox: Bbox): Promise<Poi[]> {
  const rows = await prisma.fintechCompany.findMany({
    where: {
      status: "APPROVED",
      hqLat: { gte: bbox.minLat, lte: bbox.maxLat, not: null },
      hqLon: { gte: bbox.minLon, lte: bbox.maxLon, not: null },
    },
    select: {
      id: true, slug: true, displayName: true, logoUrl: true, description: true,
      website: true, hqLat: true, hqLon: true, address: true, services: true, socials: true,
    },
    take: 200,
  });
  return rows.map(fintechToPoi);
}
```

- [ ] **Step 3.5: Run tests**

Run: `npx vitest run tests/fintech-pois.test.ts`
Expected: PASS.

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/fintech-pois.ts tests/fintech-pois.test.ts src/lib/crypto-map.ts
git commit -m "feat(fintech): HQ POI mapper + extend PoiLayer with 'fintech'"
```

---

## Task 4: Available-fintech helper

**Files:**
- Create: `src/lib/available-fintech.ts`
- Create: `tests/available-fintech.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `tests/available-fintech.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { availableFintechCacheKey } from "@/lib/available-fintech";

describe("availableFintechCacheKey", () => {
  it("upper-cases the country code in the key", () => {
    expect(availableFintechCacheKey("us")).toBe("fintech:avail:US");
    expect(availableFintechCacheKey("DE")).toBe("fintech:avail:DE");
  });
});
```

(The DB query function `fintechsAvailableIn` itself is not unit-tested here — it's an integration of prisma + redis exercised via the API route test plus manual verification. Keep the test surface to the pure helper.)

- [ ] **Step 4.2: Run to verify failure**

Run: `npx vitest run tests/available-fintech.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement `src/lib/available-fintech.ts`**

```typescript
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { isValidCountryCode } from "@/lib/fintech";

const TTL = 3600; // 1h

export function availableFintechCacheKey(cc: string): string {
  return `fintech:avail:${cc.toUpperCase()}`;
}

export type AvailableFintech = {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  services: string[];
  supportedCoinIds: string[];
  hqCountryCode: string | null;
};

export async function fintechsAvailableIn(cc: string): Promise<AvailableFintech[]> {
  const code = cc.toUpperCase();
  if (!isValidCountryCode(code)) return [];

  const key = availableFintechCacheKey(code);
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as AvailableFintech[];
  } catch {
    // cache miss / redis down — fall through to DB
  }

  const rows = await prisma.fintechCompany.findMany({
    where: { status: "APPROVED", availableIn: { has: code } },
    select: {
      id: true, slug: true, displayName: true, logoUrl: true,
      services: true, supportedCoinIds: true, countryCode: true,
    },
    orderBy: [{ source: "asc" }, { displayName: "asc" }],
    take: 100,
  });

  const out: AvailableFintech[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.displayName,
    logoUrl: r.logoUrl,
    services: r.services,
    supportedCoinIds: r.supportedCoinIds,
    hqCountryCode: r.countryCode,
  }));

  try {
    await redis.set(key, JSON.stringify(out), "EX", TTL);
  } catch {
    // best-effort cache write
  }

  return out;
}
```

- [ ] **Step 4.4: Run tests**

Run: `npx vitest run tests/available-fintech.test.ts`
Expected: PASS.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/available-fintech.ts tests/available-fintech.test.ts
git commit -m "feat(fintech): availability helper keyed by country code with 1h cache"
```

---

## Task 5: Extend `/api/crypto-map/poi` with HQ pins

**Files:**
- Modify: `src/app/api/crypto-map/poi/route.ts`

- [ ] **Step 5.1: Add import + merge call**

Open `src/app/api/crypto-map/poi/route.ts`. At the top, alongside the existing `company-points` import, add:

```typescript
import { fetchApprovedFintechHqInBbox } from "@/lib/fintech-pois";
```

After the existing `company = await fetchApprovedPointsInBbox(...)` block and before the `return NextResponse.json(...)`, insert:

```typescript
  let fintech: Poi[] = [];
  try {
    fintech = await fetchApprovedFintechHqInBbox(bbox);
  } catch {
    // DB hiccup — degrade silently.
  }
```

Change the final response to merge fintech HQs **first** (so they win on coincident-coords ties with OSM):

```typescript
  return NextResponse.json(
    { pois: [...fintech, ...company, ...osm] },
    { headers: { "x-cache": osmCache } },
  );
```

- [ ] **Step 5.2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/app/api/crypto-map/poi/route.ts
git commit -m "feat(fintech): merge HQ pins into navigator POI feed"
```

---

## Task 6: Business-cabinet API (`POST /api/business/fintech`)

**Files:**
- Create: `src/app/api/business/fintech/route.ts`

- [ ] **Step 6.1: Implement the route**

```typescript
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { fintechCreateSchema, sanitizeFintechSocials } from "@/lib/fintech";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = fintechCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const socials = data.socials ? sanitizeFintechSocials(data.socials) : null;

  const baseData = {
    slug: data.slug,
    displayName: data.displayName,
    legalName: data.legalName ?? null,
    logoUrl: data.logoUrl ?? null,
    description: data.description ?? null,
    website: data.website,
    socials: socials as Prisma.InputJsonValue | undefined,
    foundedYear: data.foundedYear ?? null,
    countryCode: data.countryCode ?? null,
    city: data.city ?? null,
    address: data.address ?? null,
    hqLat: data.hqLat ?? null,
    hqLon: data.hqLon ?? null,
    services: data.services as Prisma.FintechCompanyCreateInput["services"],
    supportedCoinIds: data.supportedCoinIds,
    supportedFiats: data.supportedFiats,
    availableIn: data.availableIn,
    kycLevel: (data.kycLevel ?? null) as Prisma.FintechCompanyCreateInput["kycLevel"],
    feesSummary: data.feesSummary ?? null,
    appStoreUrl: data.appStoreUrl ?? null,
    playStoreUrl: data.playStoreUrl ?? null,
  };

  try {
    const existing = await prisma.fintechCompany.findUnique({ where: { ownerUserId: userId } });
    if (existing) {
      const row = await prisma.fintechCompany.update({
        where: { id: existing.id },
        data: {
          ...baseData,
          status: "PENDING",
          rejectionReason: null,
          reviewedById: null,
          reviewedAt: null,
        },
      });
      return NextResponse.json({ ok: true, id: row.id, status: row.status });
    }
    const row = await prisma.fintechCompany.create({
      data: {
        ...baseData,
        source: "registered",
        status: "PENDING",
        ownerUserId: userId,
      },
    });
    return NextResponse.json({ ok: true, id: row.id, status: row.status });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[] | undefined)?.join(",") ?? "";
      if (target.includes("slug")) return NextResponse.json({ error: "slug_taken" }, { status: 409 });
      if (target.includes("ownerUserId")) return NextResponse.json({ error: "already_registered" }, { status: 409 });
    }
    throw e;
  }
}
```

- [ ] **Step 6.2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6.3: Smoke test (curl)**

After Task 17 deploys, this will be exercised via the UI. For now, type-check is the gate.

- [ ] **Step 6.4: Commit**

```bash
git add src/app/api/business/fintech/route.ts
git commit -m "feat(fintech): business-cabinet self-registration API"
```

---

## Task 7: Admin API routes

**Files:**
- Create: `src/app/api/admin/fintech/route.ts`
- Create: `src/app/api/admin/fintech/[id]/route.ts`

- [ ] **Step 7.1: Implement `route.ts` (list + create)**

```typescript
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { fintechCreateSchema, sanitizeFintechSocials } from "@/lib/fintech";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (u?.role !== "ADMIN") return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { userId };
}

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const url = new URL(req.url);
  const status = url.searchParams.get("status"); // optional filter
  const where: Prisma.FintechCompanyWhereInput = status === "PENDING" || status === "APPROVED" || status === "REJECTED" ? { status } : {};
  const rows = await prisma.fintechCompany.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ rows });
}

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => null);
  const parsed = fintechCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const socials = data.socials ? sanitizeFintechSocials(data.socials) : null;

  try {
    const row = await prisma.fintechCompany.create({
      data: {
        slug: data.slug,
        displayName: data.displayName,
        legalName: data.legalName ?? null,
        logoUrl: data.logoUrl ?? null,
        description: data.description ?? null,
        website: data.website,
        socials: socials as Prisma.InputJsonValue | undefined,
        foundedYear: data.foundedYear ?? null,
        countryCode: data.countryCode ?? null,
        city: data.city ?? null,
        address: data.address ?? null,
        hqLat: data.hqLat ?? null,
        hqLon: data.hqLon ?? null,
        services: data.services as Prisma.FintechCompanyCreateInput["services"],
        supportedCoinIds: data.supportedCoinIds,
        supportedFiats: data.supportedFiats,
        availableIn: data.availableIn,
        kycLevel: (data.kycLevel ?? null) as Prisma.FintechCompanyCreateInput["kycLevel"],
        feesSummary: data.feesSummary ?? null,
        appStoreUrl: data.appStoreUrl ?? null,
        playStoreUrl: data.playStoreUrl ?? null,
        source: "curated",
        status: "APPROVED",
      },
    });
    await prisma.adminAuditLog.create({
      data: { actorId: gate.userId, action: "CREATE_FINTECH", targetType: "FintechCompany", targetId: row.id },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "slug_taken" }, { status: 409 });
    }
    throw e;
  }
}
```

- [ ] **Step 7.2: Implement `[id]/route.ts` (patch + delete)**

```typescript
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { fintechCreateSchema, sanitizeFintechSocials } from "@/lib/fintech";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (u?.role !== "ADMIN") return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { userId };
}

async function bustAvailabilityCache(countryCodes: string[]) {
  try {
    for (const cc of countryCodes) {
      await redis.del(`fintech:avail:${cc.toUpperCase()}`);
    }
  } catch { /* best-effort */ }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const body = await req.json().catch(() => null);

  // Two modes: approve/reject (small body) or full edit (validated by fintechCreateSchema).
  if (body && typeof body === "object" && "action" in body) {
    const action = (body as { action?: string }).action;
    const before = await prisma.fintechCompany.findUnique({ where: { id }, select: { availableIn: true } });
    if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (action === "approve") {
      await prisma.fintechCompany.update({
        where: { id },
        data: { status: "APPROVED", rejectionReason: null, reviewedById: gate.userId, reviewedAt: new Date() },
      });
      await prisma.adminAuditLog.create({
        data: { actorId: gate.userId, action: "APPROVE_FINTECH", targetType: "FintechCompany", targetId: id },
      });
      await bustAvailabilityCache(before.availableIn);
      return NextResponse.json({ ok: true });
    }
    if (action === "reject") {
      const reason = (body as { reason?: string }).reason ?? "";
      if (reason.trim().length < 3) {
        return NextResponse.json({ error: "reason_too_short" }, { status: 400 });
      }
      await prisma.fintechCompany.update({
        where: { id },
        data: { status: "REJECTED", rejectionReason: reason.trim(), reviewedById: gate.userId, reviewedAt: new Date() },
      });
      await prisma.adminAuditLog.create({
        data: { actorId: gate.userId, action: "REJECT_FINTECH", targetType: "FintechCompany", targetId: id, details: { reason: reason.trim() } },
      });
      await bustAvailabilityCache(before.availableIn);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }

  const parsed = fintechCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const socials = data.socials ? sanitizeFintechSocials(data.socials) : null;
  const before = await prisma.fintechCompany.findUnique({ where: { id }, select: { availableIn: true } });
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    await prisma.fintechCompany.update({
      where: { id },
      data: {
        slug: data.slug,
        displayName: data.displayName,
        legalName: data.legalName ?? null,
        logoUrl: data.logoUrl ?? null,
        description: data.description ?? null,
        website: data.website,
        socials: socials as Prisma.InputJsonValue | undefined,
        foundedYear: data.foundedYear ?? null,
        countryCode: data.countryCode ?? null,
        city: data.city ?? null,
        address: data.address ?? null,
        hqLat: data.hqLat ?? null,
        hqLon: data.hqLon ?? null,
        services: data.services as Prisma.FintechCompanyUpdateInput["services"],
        supportedCoinIds: data.supportedCoinIds,
        supportedFiats: data.supportedFiats,
        availableIn: data.availableIn,
        kycLevel: (data.kycLevel ?? null) as Prisma.FintechCompanyUpdateInput["kycLevel"],
        feesSummary: data.feesSummary ?? null,
        appStoreUrl: data.appStoreUrl ?? null,
        playStoreUrl: data.playStoreUrl ?? null,
      },
    });
    await prisma.adminAuditLog.create({
      data: { actorId: gate.userId, action: "EDIT_FINTECH", targetType: "FintechCompany", targetId: id },
    });
    await bustAvailabilityCache([...before.availableIn, ...data.availableIn]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "slug_taken" }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const before = await prisma.fintechCompany.findUnique({ where: { id }, select: { availableIn: true } });
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.fintechCompany.delete({ where: { id } });
  await prisma.adminAuditLog.create({
    data: { actorId: gate.userId, action: "DELETE_FINTECH", targetType: "FintechCompany", targetId: id },
  });
  await bustAvailabilityCache(before.availableIn);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7.3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7.4: Commit**

```bash
git add src/app/api/admin/fintech
git commit -m "feat(fintech): admin CRUD + approve/reject API with audit log"
```

---

## Task 8: Available-fintech API endpoint

**Files:**
- Create: `src/app/api/fintech/available/route.ts`

- [ ] **Step 8.1: Implement the route**

```typescript
import { NextResponse } from "next/server";
import { fintechsAvailableIn } from "@/lib/available-fintech";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cc = url.searchParams.get("cc") ?? "";
  if (!cc) return NextResponse.json({ rows: [] });
  const rows = await fintechsAvailableIn(cc);
  return NextResponse.json({ rows }, { headers: { "cache-control": "public, max-age=300" } });
}
```

- [ ] **Step 8.2: Type check + commit**

```bash
npx tsc --noEmit
git add src/app/api/fintech/available
git commit -m "feat(fintech): public API for fintechs available in a country"
```

---

## Task 9: Public catalog page

**Files:**
- Create: `src/app/[locale]/fintech/page.tsx`
- Create: `src/components/fintech/fintech-card.tsx`
- Create: `src/components/fintech/fintech-filters.tsx`

- [ ] **Step 9.1: Implement `fintech-card.tsx` (server component)**

```tsx
import Link from "next/link";
import { useTranslations } from "next-intl";

export type FintechCardData = {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  description: string | null;
  services: string[];
  countryCode: string | null;
  supportedCoinIds: string[];
};

export function FintechCard({ row, locale }: { row: FintechCardData; locale: string }) {
  const t = useTranslations("fintech");
  return (
    <Link
      href={`/${locale}/fintech/${row.slug}`}
      className="block rounded-2xl border bg-card p-5 transition hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        {row.logoUrl ? (
          <img src={row.logoUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-muted" />
        )}
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{row.displayName}</h3>
          {row.countryCode ? (
            <p className="text-xs text-muted-foreground">{row.countryCode}</p>
          ) : null}
        </div>
      </div>
      {row.description ? (
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{row.description}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-1">
        {row.services.slice(0, 4).map((s) => (
          <span key={s} className="rounded-md bg-muted px-2 py-0.5 text-xs">
            {t(`services.${s}`)}
          </span>
        ))}
        {row.services.length > 4 ? (
          <span className="text-xs text-muted-foreground">+{row.services.length - 4}</span>
        ) : null}
      </div>
    </Link>
  );
}
```

- [ ] **Step 9.2: Implement `fintech-filters.tsx` (client component)**

```tsx
"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FINTECH_SERVICES, FINTECH_KYC } from "@/lib/fintech";

export function FintechFilters() {
  const t = useTranslations("fintech");
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  function setParam(key: string, val: string | null) {
    const next = new URLSearchParams(sp.toString());
    if (val) next.set(key, val);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-3">
      <select
        className="rounded-md border bg-background px-3 py-1.5 text-sm"
        value={sp.get("service") ?? ""}
        onChange={(e) => setParam("service", e.target.value || null)}
      >
        <option value="">{t("filters.allServices")}</option>
        {FINTECH_SERVICES.map((s) => (
          <option key={s} value={s}>{t(`services.${s}`)}</option>
        ))}
      </select>

      <select
        className="rounded-md border bg-background px-3 py-1.5 text-sm"
        value={sp.get("kyc") ?? ""}
        onChange={(e) => setParam("kyc", e.target.value || null)}
      >
        <option value="">{t("filters.allKyc")}</option>
        {FINTECH_KYC.map((k) => (
          <option key={k} value={k}>{t(`kyc.${k}`)}</option>
        ))}
      </select>

      <input
        className="rounded-md border bg-background px-3 py-1.5 text-sm"
        placeholder={t("filters.countryCode")}
        defaultValue={sp.get("country") ?? ""}
        maxLength={2}
        onBlur={(e) => setParam("country", e.target.value.toUpperCase() || null)}
      />

      <select
        className="rounded-md border bg-background px-3 py-1.5 text-sm"
        value={sp.get("sort") ?? "name"}
        onChange={(e) => setParam("sort", e.target.value)}
      >
        <option value="name">{t("sort.name")}</option>
        <option value="featured">{t("sort.featured")}</option>
        <option value="newest">{t("sort.newest")}</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 9.3: Implement `page.tsx` (server component, paginated, filtered)**

```tsx
import { prisma } from "@/lib/prisma";
import { FintechCard } from "@/components/fintech/fintech-card";
import { FintechFilters } from "@/components/fintech/fintech-filters";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const PER_PAGE = 24;

type SearchParams = {
  service?: string;
  country?: string;
  coin?: string;
  fiat?: string;
  kyc?: string;
  sort?: string;
  page?: string;
};

export default async function FintechIndex({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations("fintech");

  const where: Prisma.FintechCompanyWhereInput = { status: "APPROVED" };
  if (sp.service) where.services = { has: sp.service as Prisma.FintechCompanyWhereInput["services"] extends infer X ? X : never };
  if (sp.country) where.availableIn = { has: sp.country.toUpperCase() };
  if (sp.coin) where.supportedCoinIds = { has: sp.coin.toLowerCase() };
  if (sp.fiat) where.supportedFiats = { has: sp.fiat.toUpperCase() };
  if (sp.kyc) where.kycLevel = sp.kyc as Prisma.FintechCompanyWhereInput["kycLevel"];

  const orderBy: Prisma.FintechCompanyOrderByWithRelationInput[] =
    sp.sort === "newest"
      ? [{ createdAt: "desc" }]
      : sp.sort === "featured"
      ? [{ source: "asc" }, { displayName: "asc" }]
      : [{ displayName: "asc" }];

  const page = Math.max(1, Number(sp.page ?? "1"));
  const [total, rows] = await Promise.all([
    prisma.fintechCompany.count({ where }),
    prisma.fintechCompany.findMany({
      where,
      orderBy,
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true, slug: true, displayName: true, logoUrl: true, description: true,
        services: true, countryCode: true, supportedCoinIds: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      <div className="mt-6"><FintechFilters /></div>
      {rows.length === 0 ? (
        <p className="mt-10 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <FintechCard key={r.id} row={r} locale={locale} />
          ))}
        </div>
      )}
      {total > PER_PAGE ? (
        <Pagination total={total} page={page} perPage={PER_PAGE} />
      ) : null}
    </div>
  );
}

function Pagination({ total, page, perPage }: { total: number; page: number; perPage: number }) {
  const pages = Math.ceil(total / perPage);
  return (
    <div className="mt-8 flex items-center justify-center gap-2 text-sm">
      <span>Page {page} of {pages}</span>
    </div>
  );
}
```

- [ ] **Step 9.4: Type check + commit**

```bash
npx tsc --noEmit
git add src/app/\[locale\]/fintech src/components/fintech
git commit -m "feat(fintech): public catalog page with filters and pagination"
```

---

## Task 10: Public detail page

**Files:**
- Create: `src/app/[locale]/fintech/[slug]/page.tsx`

- [ ] **Step 10.1: Implement detail page**

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getTranslations } from "next-intl/server";
import { sanitizeFintechSocials } from "@/lib/fintech";

export const dynamic = "force-dynamic";

export default async function FintechDetail({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const row = await prisma.fintechCompany.findUnique({ where: { slug } });
  if (!row || row.status !== "APPROVED") notFound();

  const t = await getTranslations("fintech");
  const socials = sanitizeFintechSocials(row.socials);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-start gap-4">
        {row.logoUrl ? (
          <img src={row.logoUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
        ) : null}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{row.displayName}</h1>
          {row.legalName ? <p className="text-sm text-muted-foreground">{row.legalName}</p> : null}
          {row.countryCode ? <p className="text-xs text-muted-foreground mt-1">{row.countryCode}{row.city ? ` · ${row.city}` : ""}</p> : null}
        </div>
      </div>

      {row.description ? <p className="mt-6 whitespace-pre-wrap text-sm">{row.description}</p> : null}

      <Section title={t("section.services")}>
        <div className="flex flex-wrap gap-1">
          {row.services.map((s) => (
            <span key={s} className="rounded-md bg-muted px-2 py-0.5 text-xs">{t(`services.${s}`)}</span>
          ))}
        </div>
      </Section>

      <Section title={t("section.supportedCoins")}>
        <div className="flex flex-wrap gap-1">
          {row.supportedCoinIds.map((id) => (
            <Link key={id} href={`/${locale}/coin/${id}`} className="rounded-md bg-muted px-2 py-0.5 text-xs hover:bg-muted-foreground/10">
              {id}
            </Link>
          ))}
        </div>
      </Section>

      <Section title={t("section.supportedFiats")}>
        <div className="flex flex-wrap gap-1">
          {row.supportedFiats.map((f) => (
            <span key={f} className="rounded-md bg-muted px-2 py-0.5 text-xs">{f}</span>
          ))}
        </div>
      </Section>

      <Section title={t("section.availableIn")}>
        <div className="flex flex-wrap gap-1">
          {row.availableIn.map((c) => (
            <span key={c} className="rounded-md bg-muted px-2 py-0.5 text-xs">{c}</span>
          ))}
        </div>
      </Section>

      {row.kycLevel ? (
        <Section title={t("section.kyc")}>
          <p className="text-sm">{t(`kyc.${row.kycLevel}`)}</p>
        </Section>
      ) : null}

      {row.feesSummary ? (
        <Section title={t("section.fees")}>
          <p className="whitespace-pre-wrap text-sm">{row.feesSummary}</p>
        </Section>
      ) : null}

      <Section title={t("section.links")}>
        <div className="flex flex-col gap-1 text-sm">
          <Ext href={row.website} label={t("links.website")} />
          {row.appStoreUrl ? <Ext href={row.appStoreUrl} label={t("links.appStore")} /> : null}
          {row.playStoreUrl ? <Ext href={row.playStoreUrl} label={t("links.playStore")} /> : null}
          {socials.map((s) => (
            <Ext key={`${s.network}:${s.url}`} href={s.url} label={s.network} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Ext({ href, label }: { href: string; label: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-600 hover:underline">{label}</a>;
}
```

- [ ] **Step 10.2: Type check + commit**

```bash
npx tsc --noEmit
git add src/app/\[locale\]/fintech/\[slug\]
git commit -m "feat(fintech): public detail page (/fintech/[slug])"
```

---

## Task 11: Business cabinet page (self-registration form)

**Files:**
- Create: `src/app/[locale]/business/fintech/page.tsx`
- Create: `src/components/fintech/fintech-form.tsx`

- [ ] **Step 11.1: Implement shared form component (client)**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FINTECH_SERVICES, FINTECH_KYC } from "@/lib/fintech";

type Initial = Partial<{
  slug: string; displayName: string; legalName: string | null; logoUrl: string | null;
  description: string | null; website: string; foundedYear: number | null;
  countryCode: string | null; city: string | null; address: string | null;
  hqLat: number | null; hqLon: number | null;
  services: string[]; supportedCoinIds: string[]; supportedFiats: string[];
  availableIn: string[]; kycLevel: string | null; feesSummary: string | null;
  appStoreUrl: string | null; playStoreUrl: string | null;
}>;

export function FintechForm({ initial, endpoint, method }: { initial: Initial; endpoint: string; method: "POST" | "PATCH" }) {
  const t = useTranslations("fintech.form");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      slug: String(fd.get("slug") ?? ""),
      displayName: String(fd.get("displayName") ?? ""),
      legalName: (fd.get("legalName") as string) || null,
      logoUrl: (fd.get("logoUrl") as string) || null,
      description: (fd.get("description") as string) || null,
      website: String(fd.get("website") ?? ""),
      foundedYear: fd.get("foundedYear") ? Number(fd.get("foundedYear")) : null,
      countryCode: ((fd.get("countryCode") as string) || "").toUpperCase() || null,
      city: (fd.get("city") as string) || null,
      address: (fd.get("address") as string) || null,
      hqLat: fd.get("hqLat") ? Number(fd.get("hqLat")) : null,
      hqLon: fd.get("hqLon") ? Number(fd.get("hqLon")) : null,
      services: fd.getAll("services").map(String),
      supportedCoinIds: String(fd.get("supportedCoinIds") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
      supportedFiats: String(fd.get("supportedFiats") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
      availableIn: String(fd.get("availableIn") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
      kycLevel: (fd.get("kycLevel") as string) || null,
      feesSummary: (fd.get("feesSummary") as string) || null,
      appStoreUrl: (fd.get("appStoreUrl") as string) || null,
      playStoreUrl: (fd.get("playStoreUrl") as string) || null,
    };

    const res = await fetch(endpoint, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "error");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-4">
      <Field label={t("slug")}><input name="slug" required defaultValue={initial.slug ?? ""} className={inp} /></Field>
      <Field label={t("displayName")}><input name="displayName" required defaultValue={initial.displayName ?? ""} className={inp} /></Field>
      <Field label={t("legalName")}><input name="legalName" defaultValue={initial.legalName ?? ""} className={inp} /></Field>
      <Field label={t("logoUrl")}><input name="logoUrl" defaultValue={initial.logoUrl ?? ""} className={inp} /></Field>
      <Field label={t("website")}><input name="website" required defaultValue={initial.website ?? ""} className={inp} /></Field>
      <Field label={t("description")}><textarea name="description" rows={4} defaultValue={initial.description ?? ""} className={inp} /></Field>
      <Field label={t("foundedYear")}><input name="foundedYear" type="number" defaultValue={initial.foundedYear ?? ""} className={inp} /></Field>

      <Field label={t("services")}>
        <div className="flex flex-wrap gap-2">
          {FINTECH_SERVICES.map((s) => (
            <label key={s} className="text-sm">
              <input type="checkbox" name="services" value={s} defaultChecked={initial.services?.includes(s)} /> {s}
            </label>
          ))}
        </div>
      </Field>

      <Field label={t("supportedCoinIds")}><input name="supportedCoinIds" defaultValue={(initial.supportedCoinIds ?? []).join(",")} placeholder="bitcoin,ethereum" className={inp} /></Field>
      <Field label={t("supportedFiats")}><input name="supportedFiats" defaultValue={(initial.supportedFiats ?? []).join(",")} placeholder="USD,EUR" className={inp} /></Field>
      <Field label={t("availableIn")}><input name="availableIn" defaultValue={(initial.availableIn ?? []).join(",")} placeholder="US,GB,DE" className={inp} /></Field>

      <Field label={t("kycLevel")}>
        <select name="kycLevel" defaultValue={initial.kycLevel ?? ""} className={inp}>
          <option value="">—</option>
          {FINTECH_KYC.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Field>

      <Field label={t("feesSummary")}><textarea name="feesSummary" rows={3} defaultValue={initial.feesSummary ?? ""} className={inp} /></Field>
      <Field label={t("appStoreUrl")}><input name="appStoreUrl" defaultValue={initial.appStoreUrl ?? ""} className={inp} /></Field>
      <Field label={t("playStoreUrl")}><input name="playStoreUrl" defaultValue={initial.playStoreUrl ?? ""} className={inp} /></Field>

      <Field label={t("countryCode")}><input name="countryCode" maxLength={2} defaultValue={initial.countryCode ?? ""} className={inp} /></Field>
      <Field label={t("city")}><input name="city" defaultValue={initial.city ?? ""} className={inp} /></Field>
      <Field label={t("address")}><input name="address" defaultValue={initial.address ?? ""} className={inp} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("hqLat")}><input name="hqLat" type="number" step="any" defaultValue={initial.hqLat ?? ""} className={inp} /></Field>
        <Field label={t("hqLon")}><input name="hqLon" type="number" step="any" defaultValue={initial.hqLon ?? ""} className={inp} /></Field>
      </div>

      {error ? <p className="text-sm text-red-600">{t(`errors.${error}`, { default: error })}</p> : null}
      <button disabled={busy} type="submit" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
        {busy ? t("saving") : t("submit")}
      </button>
    </form>
  );
}

const inp = "w-full rounded-md border bg-background px-3 py-1.5 text-sm";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs text-muted-foreground">{label}</span><div className="mt-1">{children}</div></label>;
}
```

- [ ] **Step 11.2: Implement `business/fintech/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTranslations } from "next-intl/server";
import { FintechForm } from "@/components/fintech/fintech-form";

export const dynamic = "force-dynamic";

export default async function BusinessFintechPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect(`/${locale}/login?next=/${locale}/business/fintech`);

  const t = await getTranslations("business.fintech");
  const existing = await prisma.fintechCompany.findUnique({ where: { ownerUserId: userId } });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      {existing ? <StatusBanner status={existing.status} reason={existing.rejectionReason} /> : null}
      <FintechForm initial={existing ?? {}} endpoint="/api/business/fintech" method="POST" />
    </div>
  );
}

function StatusBanner({ status, reason }: { status: string; reason: string | null }) {
  return (
    <div className="mt-4 rounded-md border bg-muted px-3 py-2 text-sm">
      Status: <span className="font-medium">{status}</span>
      {reason ? <span className="ml-2 text-muted-foreground">— {reason}</span> : null}
    </div>
  );
}
```

- [ ] **Step 11.3: Type check + commit**

```bash
npx tsc --noEmit
git add src/app/\[locale\]/business/fintech src/components/fintech/fintech-form.tsx
git commit -m "feat(fintech): business-cabinet self-registration page"
```

---

## Task 12: Admin moderation page

**Files:**
- Create: `src/app/[locale]/admin/fintech/page.tsx`

- [ ] **Step 12.1: Implement admin page (list + quick actions)**

```tsx
import { prisma } from "@/lib/prisma";
import { getTranslations } from "next-intl/server";
import { AdminFintechRow } from "./row";

export const dynamic = "force-dynamic";

export default async function AdminFintechPage() {
  const t = await getTranslations("admin.fintech");
  const rows = await prisma.fintechCompany.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      {/* Create-curated form sits below the queue in a follow-up; for now the queue is enough. */}
      <div className="mt-6 grid gap-3">
        {rows.length === 0 ? <p className="text-muted-foreground">{t("empty")}</p> : null}
        {rows.map((r) => <AdminFintechRow key={r.id} row={r} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 12.2: Implement `row.tsx` (client component for approve/reject)**

Create `src/app/[locale]/admin/fintech/row.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  source: string;
  createdAt: Date;
  rejectionReason: string | null;
  availableIn: string[];
  services: string[];
};

export function AdminFintechRow({ row }: { row: Row }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function act(action: "approve" | "reject") {
    setBusy(true);
    const body = action === "approve" ? { action } : { action, reason };
    const res = await fetch(`/api/admin/fintech/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">{row.displayName} <span className="text-xs text-muted-foreground">({row.slug})</span></div>
          <div className="text-xs text-muted-foreground">{row.status} · {row.source} · {row.services.length} services · {row.availableIn.length} countries</div>
          {row.rejectionReason ? <div className="mt-1 text-xs text-red-600">{row.rejectionReason}</div> : null}
        </div>
        {row.status === "PENDING" ? (
          <div className="flex items-center gap-2">
            <button disabled={busy} onClick={() => act("approve")} className="rounded-md bg-green-600 px-3 py-1.5 text-sm text-white">Approve</button>
            <button disabled={busy} onClick={() => setReasonOpen((v) => !v)} className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white">Reject</button>
          </div>
        ) : null}
      </div>
      {reasonOpen ? (
        <div className="mt-3 flex gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (≥3 chars)" className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm" />
          <button disabled={busy || reason.trim().length < 3} onClick={() => act("reject")} className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">Confirm reject</button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 12.3: Type check + commit**

```bash
npx tsc --noEmit
git add src/app/\[locale\]/admin/fintech
git commit -m "feat(fintech): admin moderation queue with approve/reject"
```

---

## Task 13: Navigator UI — FINTECH_HQ marker + popup

**Files:**
- Modify: navigator map component (locate via `Grep`: `\"FINTECH_HQ\"|new maplibregl.Marker|PoiLayer`) — most likely `src/components/crypto-map/map.tsx` or `src/components/navigator/*`.

- [ ] **Step 13.1: Find the marker rendering code**

Run: `Grep` for `layer === "atm"` or `marker.setLngLat`. The site already styles ATM vs merchant markers — add a `fintech` branch in the same switch/ternary.

- [ ] **Step 13.2: Add a `fintech` branch**

For each place that styles a marker based on `poi.layer`, add the fintech case. Suggested distinct visuals — implementer wires up; spec says visuals are not invented here. Reasonable starting point: same shape as merchant marker, color `var(--color-fintech)` defaulting to indigo-600 if no token exists. Use the existing logo (`poi.image`) as the marker icon if present, just like company-points.

- [ ] **Step 13.3: Popup**

If popup content is rendered from a shared component, add a "Fintech" badge plus a link `View details → /{locale}/fintech/<slug-from-id>` (the id is `fintech/<id>`, but the popup carries `name`/`website` — surface a deep-link by hoisting the slug into `Poi`).

Update `Poi` in `src/lib/crypto-map.ts` to add an optional `slug?: string` field. Update `fintechToPoi` (Task 3) to set `slug: row.slug`. Update `companyPointToPoi` to leave it undefined.

Update the popup component to render a "View profile" link when `slug` is set and `layer === "fintech"`.

- [ ] **Step 13.4: Type check + commit**

```bash
npx tsc --noEmit
git add src/lib/crypto-map.ts src/lib/fintech-pois.ts src/components/
git commit -m "feat(fintech): navigator marker + popup for FINTECH_HQ"
```

---

## Task 14: Navigator UI — "Available here" panel

**Files:**
- Create: `src/components/crypto-map/available-fintech-panel.tsx`
- Modify: navigator entry component to mount the panel

- [ ] **Step 14.1: Implement panel**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Item = { id: string; slug: string; displayName: string; logoUrl: string | null; services: string[] };

export function AvailableFintechPanel({ center, locale }: { center: { lat: number; lon: number } | null; locale: string }) {
  const t = useTranslations("fintech.panel");
  const [cc, setCc] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!center) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const geoRes = await fetch(`/api/crypto-map/geocode?lat=${center.lat}&lon=${center.lon}`);
        if (!geoRes.ok) return;
        const geo = await geoRes.json();
        const country = geo.countryCode as string | undefined;
        if (!country) return;
        setCc(country);
        const r = await fetch(`/api/fintech/available?cc=${country}`);
        if (r.ok) {
          const j = await r.json();
          setItems(j.rows ?? []);
        }
      } catch { /* silent */ }
    }, 800);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [center?.lat, center?.lon]);

  if (!cc) return null;

  return (
    <div className="absolute right-3 top-3 z-10 w-72 rounded-xl border bg-background/95 shadow-lg backdrop-blur">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium">
        <span>{t("title", { country: cc })}</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="max-h-80 overflow-y-auto px-2 pb-2">
          {items.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t("empty", { country: cc })}</p>
          ) : items.map((it) => (
            <Link key={it.id} href={`/${locale}/fintech/${it.slug}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
              {it.logoUrl ? <img src={it.logoUrl} alt="" className="h-6 w-6 rounded" /> : <div className="h-6 w-6 rounded bg-muted" />}
              <span className="truncate text-sm">{it.displayName}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 14.2: Mount the panel in the navigator entry component**

In the navigator map component (same file modified in Task 13), pass current map center (likely already tracked in state) and the active locale to `<AvailableFintechPanel center={...} locale={...} />`. Mount it inside the map's relative-positioned container.

- [ ] **Step 14.3: Type check + commit**

```bash
npx tsc --noEmit
git add src/components/crypto-map/available-fintech-panel.tsx src/components/
git commit -m "feat(fintech): 'available here' panel on the navigator"
```

---

## Task 15: Navbar + admin/business sub-nav

**Files:**
- Modify: navbar/site-header component (locate via `Grep` for the existing "Exchanges" link)
- Modify: `src/app/[locale]/admin/layout.tsx`
- Modify: `src/app/[locale]/business/layout.tsx` (only if a sub-nav file exists)

- [ ] **Step 15.1: Add "Fintech" to the public navbar**

Find the element that renders the Exchanges nav link (e.g., `<Link href={`/${locale}/exchanges`}>{t("exchanges")}</Link>`). Add an analogous "Fintech" link right after it: `<Link href={`/${locale}/fintech`}>{t("fintech")}</Link>`. Use `useTranslations("common")`.

- [ ] **Step 15.2: Add Fintech tab to admin sub-nav**

In `src/app/[locale]/admin/layout.tsx`, locate the array of tabs (similar to `{ href: "/admin/business", label: t("tabs.business") }`). Add:

```tsx
{ href: `/${locale}/admin/fintech`, label: t("tabs.fintech") }
```

- [ ] **Step 15.3: (Optional) Add Fintech tab to business sub-nav**

If `src/app/[locale]/business/layout.tsx` has a sub-nav, add `{ href: ..../business/fintech, label: t("tabs.fintech") }` for COMPANY accounts. If no sub-nav exists, skip — users will reach the form via the navbar or direct URL.

- [ ] **Step 15.4: Type check + commit**

```bash
npx tsc --noEmit
git add src/components/ src/app/\[locale\]/admin/layout.tsx src/app/\[locale\]/business/layout.tsx
git commit -m "feat(fintech): navbar + admin/business sub-nav entries"
```

---

## Task 16: i18n keys across 10 locales

**Files:**
- Modify all of: `messages/en.json`, `ru.json`, `de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt-BR.json`, `tr.json`, `zh-CN.json`

- [ ] **Step 16.1: Add the full key tree to `messages/en.json`**

Merge into the existing file (do not replace):

```json
{
  "common": { "fintech": "Fintech" },
  "fintech": {
    "title": "Fintech directory",
    "subtitle": "Banking and financial services that work with crypto.",
    "empty": "No fintech companies match your filters yet.",
    "services": {
      "CARD": "Card", "IBAN": "IBAN", "SEPA": "SEPA", "SWIFT": "SWIFT",
      "SAVINGS": "Savings", "CRYPTO_LOANS": "Crypto loans", "STAKING": "Staking",
      "EXCHANGE": "Exchange", "CUSTODY": "Custody", "PAYMENTS": "Payments",
      "ONRAMP": "On-ramp", "OFFRAMP": "Off-ramp"
    },
    "kyc": { "NONE": "No KYC", "BASIC": "Basic KYC", "FULL": "Full KYC" },
    "filters": { "allServices": "All services", "allKyc": "Any KYC", "countryCode": "Country (e.g. US)" },
    "sort": { "name": "Name", "featured": "Featured", "newest": "Newest" },
    "section": {
      "services": "Products & services", "supportedCoins": "Supported coins",
      "supportedFiats": "Supported fiats", "availableIn": "Available in",
      "kyc": "KYC", "fees": "Fees", "links": "Links"
    },
    "links": { "website": "Website", "appStore": "App Store", "playStore": "Google Play" },
    "panel": { "title": "Available in {country}", "empty": "No fintech services available in {country}." },
    "form": {
      "slug": "URL slug", "displayName": "Display name", "legalName": "Legal name",
      "logoUrl": "Logo URL", "website": "Website", "description": "Description",
      "foundedYear": "Founded year", "services": "Services",
      "supportedCoinIds": "Supported coins (comma-separated ids)",
      "supportedFiats": "Supported fiats (comma-separated codes)",
      "availableIn": "Available in (comma-separated ISO-2 codes)",
      "kycLevel": "KYC level", "feesSummary": "Fees summary",
      "appStoreUrl": "App Store URL", "playStoreUrl": "Google Play URL",
      "countryCode": "HQ country (ISO-2)", "city": "HQ city", "address": "HQ address",
      "hqLat": "HQ latitude", "hqLon": "HQ longitude",
      "submit": "Submit", "saving": "Saving…",
      "errors": {
        "invalid": "Please check the fields and try again.",
        "slug_taken": "This URL slug is already in use.",
        "already_registered": "You already registered a fintech."
      }
    }
  },
  "admin": {
    "tabs": { "fintech": "Fintech" },
    "fintech": {
      "title": "Fintech moderation",
      "subtitle": "Review submitted fintech entries.",
      "empty": "Nothing to moderate."
    }
  },
  "business": {
    "fintech": {
      "title": "Register a fintech",
      "subtitle": "Describe your crypto-enabled financial service."
    }
  }
}
```

- [ ] **Step 16.2: Add the same key tree to the other 9 locales**

Translate the leaf strings into ru, de, es, fr, ja, ko, pt-BR, tr, zh-CN. Keep enum codes (`CARD`, `IBAN`, etc.) as identifiers, translate only the labels. Russian sample:

```json
"common": { "fintech": "Финтех" },
"fintech": {
  "title": "Финтех-каталог",
  "subtitle": "Банковские и финансовые сервисы, работающие с криптой.",
  "empty": "Под фильтры ничего не подошло.",
  "services": { "CARD": "Карта", "IBAN": "IBAN", "SEPA": "SEPA", "SWIFT": "SWIFT", "SAVINGS": "Сбережения", "CRYPTO_LOANS": "Крипто-кредиты", "STAKING": "Стейкинг", "EXCHANGE": "Обмен", "CUSTODY": "Кастоди", "PAYMENTS": "Платежи", "ONRAMP": "Ввод фиата", "OFFRAMP": "Вывод фиата" },
  "kyc": { "NONE": "Без KYC", "BASIC": "Базовый KYC", "FULL": "Полный KYC" },
  "panel": { "title": "Доступно в {country}", "empty": "В стране {country} нет доступных финтех-сервисов." }
  // … остальное аналогично
}
```

For the remaining 7 locales, mirror the same JSON tree.

- [ ] **Step 16.3: Verify next-intl picks up the keys**

Run: `npm run build`
Expected: build succeeds; no "missing message" warnings for `fintech.*`.

- [ ] **Step 16.4: Commit**

```bash
git add messages/
git commit -m "i18n(fintech): add fintech namespace across 10 locales"
```

---

## Task 17: Deploy + smoke test

**Files:** none

- [ ] **Step 17.1: Build production bundle**

Run: `npm run build`
Expected: Successful build; no TypeScript or lint errors.

- [ ] **Step 17.2: Restart web only (worker not touched)**

Run: `pm2 restart trientes-web && pm2 save`
Expected: PM2 reports `trientes-web` online.

- [ ] **Step 17.3: Smoke test (curl + browser)**

```bash
curl -fsS https://trientes.org/en/fintech | head -n 5     # expect 200 + page HTML
curl -fsS 'https://trientes.org/api/fintech/available?cc=US' | head -n 3   # expect {"rows":[]} initially
curl -fsS 'https://trientes.org/api/crypto-map/poi?bbox=-0.5,51.3,0.3,51.7&coin=bitcoin&symbol=btc' | head -n 3  # expect 200 with merged pois
```

In a browser: navigate to `https://trientes.org/en/fintech` (empty state expected before admin curates entries); sign in as admin and curate one entry via the admin UI; reload `/en/fintech` to see it.

- [ ] **Step 17.4: Push to remote**

```bash
git push origin main
```

- [ ] **Step 17.5: Final commit (only if any post-build tweaks)**

If smoke testing reveals a fix, commit it with a `fix(fintech): ...` message and re-deploy.

---

## Self-review checklist

1. **Spec coverage** — Verify each spec section maps to a task:
   - Data model (`FintechCompany` + enums) → Task 1.
   - Public catalog `/{locale}/fintech` → Task 9.
   - Detail page `/{locale}/fintech/[slug]` → Task 10.
   - Business cabinet `/{locale}/business/fintech` → Task 11.
   - Admin moderation `/{locale}/admin/fintech` → Task 12.
   - Business API → Task 6.
   - Admin API → Task 7.
   - Available API → Task 8.
   - Navigator HQ pin → Tasks 3, 5, 13.
   - "Available here" panel → Tasks 4, 8, 14.
   - Guards/validation (slug, country, fiat, coords, sanitize socials) → Task 2.
   - Rate limit on registration — **GAP**: not implemented in Task 6. Plan keeps spec lenient on this for slice 7; if you want it enforced, fold the `enforceRateLimit` call from `src/lib/rate-limit.ts` into Step 6.1 (`POST /api/business/fintech`) at the top, with a 3 attempts / 24h budget per user.
   - i18n across 10 locales → Task 16.
   - Navbar + admin tab → Task 15.
   - Worker untouched → covered by header note + Task 17 web-only restart.
   - Audit log entries (`APPROVE_FINTECH` / `REJECT_FINTECH` / `EDIT_FINTECH` / `CREATE_FINTECH` / `DELETE_FINTECH`) → Tasks 1 (enum) + 7 (writes).

2. **Placeholders** — None of the steps have "TBD"/"implement later"/"appropriate handling" wording. Visual marker styling in Task 13 explicitly defers shape/color to the implementer per the no-design-work convention; that is intentional and documented in the spec ("Visual styling spec is owned by the design phase").

3. **Type consistency** —
   - `Poi.layer` extended in Task 3.3; consumed in Task 13.
   - `Poi.slug?` field added in Task 13.3; produced by `fintechToPoi` in Task 13.3 (update), consumed in popup.
   - `FintechCreateInput` shape matches what `FintechForm` posts (Task 11) — both contain the same field set.
   - `fintechCreateSchema` accepts either object-or-null for optional URL fields; the form converts empty strings to `null` before posting. Match maintained.

4. **Ambiguity** — Spec said "socials = object"; resolved by spec edit (committed before this plan) to `Social[]` matching codebase. Plan uses the array shape throughout.

---

## Open follow-ups (post-deploy)

- Manually curate the initial fintech roster via `/admin/fintech` (Revolut, Wirex, Mercuryo, Crypto.com Card, Nexo, …). Suggest 10–20 entries to validate filters and panel UX.
- Decide whether the rate-limit gap (see self-review item 1) needs to land in this slice or in a follow-up.
- Once entries exist, smoke-test the navigator panel in 2-3 countries with differing coverage (US, GB, DE, BR, JP).
