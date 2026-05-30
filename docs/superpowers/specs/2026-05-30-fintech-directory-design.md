# Fintech directory — design

Date: 2026-05-30
Phase: 10, slice 7

## Goal

Add a public catalog of fintech companies that integrate crypto into their financial products — neobanks, crypto-friendly card issuers, payment processors, on/off-ramps, custodians (Revolut, Wirex, Crypto.com Card, Mercuryo, Nexo, etc.). Two paths into the catalog (admin-curated entries + user self-registration), full detail pages per company, and integration with the Crypto Navigator (HQ pin + a "available here" contextual list).

## Non-goals (this slice)

- User reviews / ratings.
- Affiliate-link tracking.
- Automated coverage sync from external lists.
- Service-status / uptime monitoring.
- Team accounts (multiple users editing one fintech).

These may be future slices; explicitly excluded here to keep scope bounded.

## Data model

New Prisma model `FintechCompany` + two enums.

```prisma
enum FintechService {
  CARD           // debit/credit card
  IBAN           // dedicated IBAN
  SEPA
  SWIFT
  SAVINGS        // interest-bearing accounts
  CRYPTO_LOANS   // borrow against crypto
  STAKING
  EXCHANGE       // built-in swap/trade
  CUSTODY
  PAYMENTS       // P2P / merchant payments
  ONRAMP         // fiat → crypto
  OFFRAMP        // crypto → fiat
}

enum FintechKyc {
  NONE
  BASIC
  FULL
}

model FintechCompany {
  id              String         @id @default(cuid())
  slug            String         @unique               // /fintech/[slug]
  displayName     String
  legalName       String?
  logoUrl         String?
  description     String?        @db.Text
  website         String
  socials         Json?
  foundedYear     Int?

  // HQ — optional; if present and APPROVED, becomes a navigator pin.
  countryCode     String?                              // ISO-3166 alpha-2
  city            String?
  address         String?
  hqLat           Float?
  hqLon           Float?

  // Products
  services        FintechService[]
  supportedCoinIds String[]                            // FK-by-convention to Coin.id
  supportedFiats  String[]                             // ISO-4217
  availableIn     String[]                             // ISO-3166 alpha-2 country codes

  // Disclosures
  kycLevel        FintechKyc?
  feesSummary     String?        @db.Text
  appStoreUrl     String?
  playStoreUrl    String?

  // Curation
  source          String         @default("curated")   // "curated" | "registered"
  ownerUserId     String?        @unique               // null for curated; required for registered
  owner           User?          @relation("FintechOwner", fields: [ownerUserId], references: [id], onDelete: Cascade)
  status          RequestStatus  @default(APPROVED)    // curated → APPROVED; registered → PENDING
  rejectionReason String?
  reviewedById    String?
  reviewer        User?          @relation("FintechReviewer", fields: [reviewedById], references: [id])
  reviewedAt      DateTime?

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([status, displayName])
  @@index([source])
}
```

Migration: `20260530180000_fintech_directory`.

Defaults:
- `source = "curated"`, `status = APPROVED` for entries created by admin (no `ownerUserId`).
- Self-registration flow sets `source = "registered"`, `ownerUserId = userId`, `status = PENDING`. Admin approval flips `status` to APPROVED and stamps `reviewedById/reviewedAt`. Rejection requires `rejectionReason` (≥3 chars).

`@unique` on `ownerUserId` enforces one registered fintech per user (matches `Company` pattern); P2002 surfaces as `already_registered`.

## Routes & pages

Public:

- `GET /{locale}/fintech` — directory listing.
  - Filters (URL params): `service`, `country` (in `availableIn`), `coin` (in `supportedCoinIds`), `fiat`, `kyc`.
  - Sort: `name` (default), `featured` (curated first, then registered; alphabetical within each group), `newest`.
  - Server-paginated, 24/page.
  - Only `status = APPROVED` shown.

- `GET /{locale}/fintech/[slug]` — detail page. All fields rendered. Linked coin chips → `/{locale}/coin/[id]`. Country chips show flag + name (i18n). External links (`website`, `appStoreUrl`, `playStoreUrl`, `socials`) get `rel="noopener noreferrer nofollow"`. 404 if slug not found or status ≠ APPROVED.

Business cabinet (auth-gated):

- `GET /{locale}/business/fintech` — registration form for the signed-in user.
  - If user already has a `FintechCompany` (any status): show current state + edit form. After APPROVED, edits are allowed but re-submission flips status back to PENDING (matches `CompanyPoint` behavior).
  - If none: show empty form.
- `POST /api/business/fintech` — create/update own entry. Re-submit sets status back to PENDING. Caught errors: P2002 on slug → `slug_taken`; P2002 on ownerUserId → `already_registered`.

Admin (ADMIN-gated via `admin/layout.tsx`):

- `GET /{locale}/admin/fintech` — moderation queue (PENDING first) + searchable list of all entries.
- `POST /api/admin/fintech` — create curated entry (status=APPROVED, source=curated, ownerUserId=null).
- `PATCH /api/admin/fintech/[id]` — edit any entry; approve/reject pending; write `AdminAuditLog` entries `APPROVE_FINTECH` / `REJECT_FINTECH` / `EDIT_FINTECH` / `CREATE_FINTECH`.
- `DELETE /api/admin/fintech/[id]` — hard-delete; audit `DELETE_FINTECH`.

Navigator-supporting API:

- `GET /api/fintech/available?cc=XX` — list of APPROVED fintechs where `availableIn` contains `XX`. Returns `{id, slug, displayName, logoUrl, services, supportedCoinIds, hqCountryCode}`. Cached in Redis with TTL 1h, keyed by `cc`. Empty list if `cc` invalid or no matches.

## Navigator integration (hybrid)

Two surfaces:

### 1. HQ pin (extends `/api/crypto-map/poi`)

Add a third POI source alongside OSM + company-points:

- New helper `fetchApprovedFintechHqInBbox(bbox)` in `src/lib/fintech-pois.ts`. Queries `FintechCompany` where `status=APPROVED`, `hqLat`/`hqLon` in bbox.
- Maps to existing `Poi` shape with `type: "FINTECH_HQ"` and `source: "fintech"`. Includes `slug`, `logoUrl`, `displayName`, `services`.
- Merged in `/api/crypto-map/poi` after company-points, before OSM. Fresh on every request (no separate cache — DB query is bounded by bbox + status filter + index).

Frontend (map component):
- New marker style for `FINTECH_HQ` — distinct icon (suggest: card/bank glyph) and color from the existing shop/ATM markers. **Visual styling spec is owned by the design phase, not this doc; implementer wires up the marker but does not invent the look.**
- Popup: logo, displayName, services list (chips), deep-link to `/fintech/[slug]`.

### 2. "Available here" panel

In the navigator UI, a collapsible side panel:

- On map center change (debounced 800ms), call `/api/crypto-map/geocode?lat=...&lon=...` (already exists) → country code.
- Then `GET /api/fintech/available?cc=XX`.
- Panel renders list: logo, displayName, services chips, click → `/{locale}/fintech/[slug]`.
- Empty state: "Нет финтех-сервисов, доступных в [country]".
- Panel collapsed by default on small screens; expanded on desktop.
- Country detection failures (geocode error) → panel hidden silently.

## Guards & validation

Server-side (Zod):
- `slug`: `^[a-z0-9-]{2,40}$`.
- `displayName`: 2–80 chars.
- `website`: must parse as `http:`/`https:` URL.
- `socials`: object `{ twitter?, facebook?, instagram?, linkedin?, telegram?, youtube?, github?, discord?, reddit?, ... }` — at most 10 keys; each value must be `http:`/`https:` URL (sanitize, do not trust client). Same pattern as `CompanyPoint`.
- `countryCode`, items in `availableIn`: ISO-3166-1 alpha-2 list (validate against a constant set).
- `supportedCoinIds`: each must exist in `Coin` (check at write).
- `supportedFiats`: ISO-4217 set.
- Length caps: `availableIn` ≤ 30, `supportedCoinIds` ≤ 30, `supportedFiats` ≤ 20, `services` ≤ all enum values.
- HQ coords: if either of `hqLat`/`hqLon` provided, both required; reject `(0, 0)`; reject lat outside `[-90, 90]` / lon outside `[-180, 180]`.

Rate limits (registration path, reuse existing `rate-limit.ts`):
- ≤3 fintech registrations/updates per user per 24h → 429.

## Auth / authorization

- `/business/fintech`: requires sign-in; users of any `accountType` can register a fintech (registering a fintech does not require having a `Company`).
- `/admin/fintech`: ADMIN role required (existing `admin/layout.tsx` already gates this).
- Public pages: no auth.

## Navbar

Add a top-level "Fintech" link visible to all users, next to "Exchanges" / "Markets". For COMPANY-type signed-in users, the existing per-cabinet sub-nav under `/business` gains a "Fintech" tab linking to `/business/fintech`.

## i18n

New keys across all 10 locales (en, ru, de, es, fr, ja, ko, pt-BR, tr, zh-CN):
- `common.fintech` — navbar label.
- `fintech.*` — public catalog and detail page strings (filters, sort labels, empty state, service names, KYC level labels).
- `admin.fintech.*` — queue and CRUD strings; audit log action labels.
- `business.fintech.*` — registration form labels, status banners, errors.

## Worker

Not touched. No external sync in this slice. None of the new files under `src/lib` (`fintech-pois.ts`, `available-fintech.ts`) are imported by `trientes-worker`.

## Migration / rollout

1. Prisma migration deploys the new model + enums.
2. Seed: empty (we'll curate the initial list from admin UI after deploy).
3. After web restart: nav link visible, pages return empty list until admin curates entries.
4. Worker: no restart needed.

## Open questions (acceptable to defer)

- **Featured ordering.** First cut: curated entries first, then alphabetical. If we want manual featured-ranking later, add `featuredRank Int?` in a follow-up.
- **Slug conflicts on rebrand.** First cut: admin can edit slug; old URL 404s (no permanent redirect table). Add `FintechSlugRedirect` table later if it becomes a problem.
- **Multilingual descriptions.** First cut: single description string in whatever language the curator wrote. Translate via locale-keyed JSON later if demand warrants.

## File-level scope (not exhaustive — informs the plan)

New:
- `prisma/migrations/20260530180000_fintech_directory/migration.sql`
- `src/lib/fintech.ts` (validation schemas, ISO constants)
- `src/lib/fintech-pois.ts` (bbox → HQ POI mapper)
- `src/lib/available-fintech.ts` (country → fintech list, cached)
- `src/app/[locale]/fintech/page.tsx`
- `src/app/[locale]/fintech/[slug]/page.tsx`
- `src/app/[locale]/business/fintech/page.tsx`
- `src/app/[locale]/admin/fintech/page.tsx`
- `src/app/api/business/fintech/route.ts`
- `src/app/api/admin/fintech/route.ts`
- `src/app/api/admin/fintech/[id]/route.ts`
- `src/app/api/fintech/available/route.ts`
- 10 × `src/messages/<locale>.json` — new keys.

Modified:
- `prisma/schema.prisma` — new model + enums; back-relations on `User`.
- `src/app/api/crypto-map/poi/route.ts` — merge fintech HQs.
- Navigator UI component(s) — add `FINTECH_HQ` marker handling + "Available here" panel.
- Navbar component — add "Fintech" link.
- `admin/layout.tsx` tabs — add Fintech tab.
- `business/layout.tsx` (or wherever sub-nav lives) — add Fintech tab for COMPANY users.
