# Cabinet — Structured address, auto-geocode, COMPANY-type points

**Date:** 2026-05-30
**Scope:** Profile + add-point form in `/cabinet/companies/[id]`.

## Goals

Owner pain points in the existing form (single `address` input, no logos, no stablecoins, no online-only company type, click-to-place map):

1. Address is one field — should be structured (country → city → street → house-no → postal code).
2. After address is entered, map marker should auto-place via geocoder (still draggable).
3. Website input only accepts `https://…` — should accept `www.x.com` and `x.com` too (normalize to https).
4. Accepted-coin chips are monochrome text — should show coin logos.
5. USDT / USDC / DAI not selectable — they aren't in the Top-100 L1 list.
6. No "просто компания" (online-only) point type. A company with no physical store but with crypto acquiring on its website still wants a map pin at its HQ.
7. Adding the company's HQ as a point requires re-entering the address — need a "use company address" checkbox.

## Decisions

- **Schema:** add `countryCode`, `city`, `street`, `houseNumber`, `postalCode` to both `Company` and `CompanyPoint`. Keep existing `address` as denormalized display (auto-built from structured parts when omitted). Add `COMPANY` to `PointType` enum.
- **Geocoding:** reuse existing `/api/crypto-map/geocode?q=…` (Nominatim, cached). Form debounces (~600 ms) and fires on blur of any address field; result places marker at returned (lon, lat). Marker remains draggable for fine adjustment.
- **Website normalization:** in `validateCompanyProfile` (and point version) accept `www.x.com` / `x.com` / `http://…` / `https://…`; store as `https://…`. Reject anything else (no protocol other than http/https, no spaces).
- **Stablecoins:** add `tether` (USDT), `usd-coin` (USDC), `dai` (DAI) as `ADMIN_ADDED` Coin rows via the existing `scripts/add-coin.ts` path — they then flow into `readTop100()` via the admin-added Redis list. No new infra.
- **Coin chips:** picker fetches `{id, symbol, logoUrl}`; chip renders a 16px `<img>` + symbol.
- **COMPANY point type:** behaves like other types except (a) shown in type chips with "Просто компания / Online" label, (b) when selected, the "use company address" checkbox is checked by default.
- **Use-company-address checkbox:** when on, copies the company's structured address fields into the point's address fields (and geocodes them). Editing any point field unticks the checkbox.
- **POI merge:** `/api/crypto-map/poi` already merges approved CompanyPoints; COMPANY type is included verbatim (it has lat/lon like any other point), so no merge-side change needed beyond ensuring the type is whitelisted.

## Out of scope

- Logo upload (only URL).
- Multi-branch UI batching (each branch is still a separate point row).
- Country verification beyond ISO-3166 list (no live address validation against postal databases).
- Currency-specific acquiring metadata.

## i18n keys (new)

`business.country`, `business.city`, `business.street`, `business.houseNumber`, `business.postalCode`, `business.useCompanyAddress`, `business.type.COMPANY`, `business.geocoding`, `business.geocodingFailed`, `business.websiteHint`.

All 10 locales: en, ru, de, es, fr, ja, ko, pt-BR, tr, zh-CN.
