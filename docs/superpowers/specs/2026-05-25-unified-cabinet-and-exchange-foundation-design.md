# Unified personal cabinet + exchange registration foundation

**Date:** 2026-05-25
**Status:** Design (awaiting plan)

## Problem

The current account model is awkward:

- `User.accountType` is `INDIVIDUAL | COMPANY` — registering a company *converts* the user's identity to "company", which doesn't match reality (a person owns a company, they don't become one).
- Company registration lives at `/business`, only reachable after login, and forces the type-flip.
- There is no place for a crypto exchange to register at all — neither in schema, UI, nor admin.
- Three different entry points (login → `/cabinet` for INDIVIDUAL, login → `/business` for COMPANY, no path for exchanges) means the navbar branches by account type and the flow is hard to extend.

## Goal

One unified personal cabinet per user. Companies and exchanges become **owned entities** the user manages from their cabinet, not identities the user takes on. This:

- Lets one person own multiple companies and/or multiple exchanges (matches reality — directors run several businesses).
- Removes account-type branching from navbar, registration, and routing.
- Lays the data + UI foundation for exchange registration without committing to public exchange pages or `/exchanges` integration yet.

## Non-goals (out of scope for this slice)

- Public exchange profile pages (`/exchange/[slug]`) — exchanges are visible only to their owner and admins.
- Integration with the existing `/exchanges` catalog (which is sourced from a public API).
- Exchange-specific fields beyond the basic business card: type (CEX/DEX), licenses, trading pairs, volumes, jurisdictions, verification badges — all later.
- Team accounts / multiple admins per company or exchange. Owner-only.
- Email or push notifications for moderation decisions.
- Self-serve account-type switching UI (it doesn't exist as a concept any more — there is no account type).

## Hard rule: public-facing pages stay untouched

This work adds a private cabinet experience for newly registered users. It MUST NOT change anything visible on the existing public site:

- The coin pages (`/`, `/{locale}`, `/{locale}/coin/[id]`, watchlist, request, markets) — untouched.
- The exchange catalog (`/{locale}/exchanges`, exchange detail pages, the CMC-sourced data and worker that feeds them) — untouched.
- The Crypto Navigator map (`/{locale}/navigator`) and its POI feed (`/api/crypto-map/poi`) — untouched, including the merge of approved `CompanyPoint`s.

If any plan task starts touching these areas to "make things consistent" or "while we're in here," stop and revisit the spec. The cabinet is additive: new tables, new routes, new admin tab. Public surfaces stay exactly as they are today.

## User flow

```
┌─────────────────────────────────────────────────────────────┐
│ Anonymous visitor                                            │
└────────────────────────────┬─────────────────────────────────┘
                             │ clicks "Sign in" in navbar
                             ▼
                  ┌──────────────────────┐
                  │ /login               │ ── OAuth (Google, GitHub, Telegram)
                  │ (login form only)    │ ── credentials
                  └──────┬───────────────┘
                         │ "Create account →"
                         ▼
                  ┌──────────────────────┐
                  │ /register            │ (single form: username + password + optional email)
                  └──────┬───────────────┘
                         │ submit → auto-login
                         ▼
                  ┌──────────────────────┐
                  │ /cabinet             │ ── #profile  (existing)
                  │ (unified)            │ ── #settings (existing)
                  │                      │ ── #alerts   (placeholder, existing)
                  │                      │ ── #companies (NEW: list + "Add company")
                  │                      │ ── #exchanges (NEW: list + "Add exchange")
                  └──────┬───────────────┘
                         │ click company / exchange card
                         ▼
                  ┌──────────────────────┐
                  │ /cabinet/companies/[id]   ── profile + points (was /business)
                  │ /cabinet/exchanges/[id]   ── profile + moderation status
                  └──────────────────────┘
```

**Registration is single-purpose**: there are no account-type cards, no chooser, no per-type forms. Everyone registers the same way. Owning entities is a post-registration cabinet action.

## Routes

| Route | Behavior |
|---|---|
| `/login` | Login form + OAuth. Bottom link: "Create account →" → `/register`. Unchanged from today except for the prominent register link. |
| `/register` | Single form (username, password, optional email). Auto-logs in on success → redirect to `/cabinet`. Same form as today. |
| `/cabinet` | Auth-gated. Tabs/anchors: `#profile`, `#settings`, `#alerts`, **`#companies`**, **`#exchanges`**. Each tab is its own section on the page. |
| `/cabinet/companies/[id]` | Manage one company (owner-only). Profile editor + points list + add-point form. This is what `/business` is today, scoped to one company. |
| `/cabinet/exchanges/[id]` | Manage one exchange (owner-only). Profile editor + moderation status badge + admin rejection reason if any. |
| `/business` | 301 → `/cabinet#companies` (legacy URL, keep working). |
| `/admin/business` | Unchanged. CompanyPoint moderation queue. |
| `/admin/exchanges` | NEW. Exchange moderation queue. Approve / Reject + reason. Writes `APPROVE_EXCHANGE` / `REJECT_EXCHANGE` to `AdminAuditLog`. |

## Data model

### Remove `User.accountType`

Drop the column. The enum `AccountType` and all references to it disappear. After migration, "is this user a company?" becomes "does this user own any Company?" — a relational question, not an identity field.

### `Company`: drop the 1:1 constraint

`Company.ownerUserId` was `@unique` (one company per user). Drop the unique — now a user may own N companies. All other Company fields and the `CompanyPoint` table are unchanged.

Add index: `@@index([ownerUserId])`.

### New table: `Exchange`

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
  country         String         // ISO 3166-1 alpha-2
  email           String
  phone           String?
  address         String?
  socials         Json?          // { twitter?, telegram?, discord?, ... } — http(s) only at mapper

  status          ExchangeStatus @default(PENDING)
  rejectionReason String?

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([ownerUserId])
  @@index([status, createdAt])
}
```

`User` gets the reverse relation: `exchanges Exchange[]` (and existing `companies Company[]` once the unique is dropped).

### Migration

Single migration file `20260525XXXXXX_unified_cabinet_and_exchange`:

1. Drop unique on `Company.ownerUserId`; add `@@index`.
2. Drop column `User.accountType`; drop enum `AccountType`.
3. Create enum `ExchangeStatus`.
4. Create table `Exchange` with indexes.

No data migration needed for company users — once `accountType` is gone, "owns a company" is the only signal that matters, and that relation already exists.

**Rollback path** (in the migration's down direction, for documentation):

1. Drop `Exchange` table; drop enum `ExchangeStatus`.
2. Recreate enum `AccountType`; add column `User.accountType` defaulting to `INDIVIDUAL`; set `COMPANY` for any user that owns a Company.
3. Re-add unique on `Company.ownerUserId` (will fail if any user now owns >1 company; document this as expected).

## API

Existing endpoints continue to work:

- `POST /api/auth/password/{register,login}` — unchanged.
- Existing company point CRUD routes keep their current paths and behavior, but accept a `companyId` (path or body) instead of looking up "the owner's single company". Plan task: enumerate today's company endpoints and add the scoping argument.

New endpoints:

| Method + path | Purpose |
|---|---|
| `POST /api/cabinet/companies` | Create a new company for the current user. Body: `{ legalName, displayName }`. Returns `{ id }`. |
| `GET /api/cabinet/companies` | List current user's companies. |
| `PATCH /api/cabinet/companies/[id]` | Update profile fields. Owner-only. |
| `POST /api/cabinet/exchanges` | Create a new exchange. Body: full exchange profile. Server sets `status: PENDING`. Returns `{ id }`. |
| `GET /api/cabinet/exchanges` | List current user's exchanges. |
| `PATCH /api/cabinet/exchanges/[id]` | Update profile. Owner-only. **Side effect:** if the exchange was `APPROVED`, any edit flips status back to `PENDING` and clears `rejectionReason`. (Mirrors how CompanyPoint edits re-trigger moderation.) |
| `POST /api/admin/exchanges/[id]/approve` | Admin sets `status: APPROVED`, clears `rejectionReason`, writes `APPROVE_EXCHANGE` to `AdminAuditLog`. |
| `POST /api/admin/exchanges/[id]/reject` | Body: `{ reason }` (≥3 chars). Sets `status: REJECTED`, stores reason, writes `REJECT_EXCHANGE`. |

All `/api/cabinet/*` routes require an authenticated session and check `ownerUserId === session.userId`.

`socials` is validated at the mapper (http/https only) — same defense-in-depth pattern as `CompanyPoint.socials` to prevent `javascript:` URL XSS in any future UI that renders them.

## Admin moderation UI

`/admin/exchanges` — a new admin page paralleling `/admin/business`:

- Tabs or status filter: Pending (default) / Approved / Rejected.
- Each row: exchange logo, display name, legal name, owner username, country, website, created date.
- Actions: **Approve** (one click) and **Reject** (opens a modal with a `reason` textarea, min 3 chars).
- Both write to `AdminAuditLog` with `action: 'APPROVE_EXCHANGE' | 'REJECT_EXCHANGE'`, `targetType: 'EXCHANGE'`, `targetId: exchange.id`.

Owner's `/cabinet/exchanges/[id]` page shows:

- A status badge: yellow "На модерации" / green "Одобрено" / red "Отклонено: <reason>".
- The profile form remains editable in all three states. Editing an `APPROVED` exchange returns it to `PENDING`.

## Navbar

Simplification:

- **Logged in:** single link "Кабинет" → `/cabinet`. The current accountType-based branching ("Cabinet" vs "Business") is removed.
- **Logged out:** unchanged — coin nav links + "Sign in" button.

The old `cabinetHref` / `cabinetLabel` computation in `src/components/navbar.tsx` is deleted along with the `User.accountType` lookup.

## i18n

Add strings across all 10 locales (en, ru, de, es, fr, ja, ko, pt-BR, tr, zh-CN):

- `cabinet.companies.*` — section title, empty state, "Add company" button, table headers.
- `cabinet.exchanges.*` — section title, empty state, "Add exchange" button, status badges, rejection reason label.
- `exchange.*` — form labels for the registration form (legalName, displayName, logoUrl, description, website, country, email, phone, address, socials, submit), validation errors.
- `admin.tabs.exchanges` and `admin.exchanges.*` — moderation page strings, approve / reject confirmations.

Remove from `business.*`: `registerIntro` and any other strings tied to the now-deleted "first-time company registration" form on `/business`. (The `/business` page no longer renders that form; it redirects.) Keep the rest of `business.*` since the per-company page reuses it.

## Risks and open notes

1. **Multi-company UX on `/cabinet/companies/[id]`** — the current `/business` page assumes the user has at most one company. When it moves under `/cabinet/companies/[id]` we need to make sure all its sub-features (points list, add-point form, profile editor) are scoped by `companyId` not "the owner's company". Worth a careful sweep during implementation.

2. **`/business` redirect** — currently `/business` does heavy work (auth, fetches company, etc.) before rendering. Replace its `page.tsx` with a thin `redirect()` to avoid hydration cost.

3. **Migration ordering** — drop the unique constraint **before** removing `accountType`. Otherwise nothing breaks, but the order matches "open up the data" before "remove the gate".

4. **Worker** — none of the new files (Exchange model usage, cabinet API routes, admin moderation) should be imported by `trientes-worker`. Web-only restart should suffice. Verify before deploying.

5. **Pre-existing data** — recent COMPANY-type users from the 2026-05-24 shipping. After the migration they appear in `/cabinet#companies` with their existing company listed. No user-facing breakage.
