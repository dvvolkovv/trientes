# Crypto Navigator — per-coin map of crypto acceptance & infrastructure

**Date:** 2026-05-23
**Status:** approved (user: "делай и выведи на фронт")

## Goal

Add an interactive map ("Crypto Navigator") to each coin detail page, rendered as a
new section **immediately after `Top exchanges`** (`<MarketsTable>`). It shows, around
the viewer, places that transact in crypto and lets the viewer route to them.

Requirements from the user:

1. Detailed navigator map with a **satellite** toggle and a **3D terrain / orientation** mode.
2. **Routing** from the user's current position (browser geolocation) or a typed address.
3. **Merchants / service providers** that accept crypto as payment, plotted on the map.
4. **Financial institutions** working with crypto, plus **buy/sell infrastructure** (crypto ATMs).

## Key data reality

Open, free data about on-the-ground crypto acceptance (BTCMap, OpenStreetMap payment
tags, CoinMap) is overwhelmingly **Bitcoin / Lightning**. Per-coin acceptance tags
(`payment:ethereum`, …) exist but are sparse. Therefore:

- **Coin-specificity:** global crypto-acceptance map shown identically on every coin
  page (always non-empty), but POIs whose OSM tags match the *current coin* get a
  distinct highlight ring (`coinSpecific`). This is honest about coverage.

## Architecture (mirrors the existing worker→Redis→API→client / fear-greed pattern)

Zero API keys. All free public sources. Heavier load can later move to MapTiler / self-hosted OSRM.

- **Map engine:** MapLibre GL JS (client-only, lazy-loaded via `next/dynamic` `ssr:false`).
  - Streets base: CARTO `dark_all` raster (dark, matches Ledger). © OSM © CARTO.
  - Satellite base: ESRI World Imagery raster. © Esri.
  - 3D terrain: AWS terrain tiles (`terrarium` raster-DEM) + `map.setTerrain` + pitch/bearing
    + `NavigationControl({ visualizePitch: true })` for orientation. Free.
- **POI source:** Overpass API, queried per map viewport (bbox), Redis-cached. Tags:
  `payment:bitcoin`, `currency:XBT`, `payment:lightning`, `payment:lightning_contactless`,
  `payment:cryptocurrencies`. Elements categorized into three layers:
  - `merchant` — shops/cafes/services accepting crypto.
  - `atm` — crypto ATMs / `vending=cryptocurrency` / bureau_de_change (buy/sell infra).
  - `financial` — banks / `office=financial` with crypto tags.
- **Geocoding:** Nominatim (typed address → coords), server-side with proper UA, Redis-cached.
- **Routing:** OSRM public demo (`driving`), server-side, short Redis cache. Draws line + distance/duration.

### New files

- `src/lib/crypto-map.ts` — pure logic (unit-tested) + network helpers:
  `parseBbox`, `coinPaymentTags`, `buildOverpassQuery`, `parseOverpassElements`,
  `parseNominatim`, `parseOsrm`, and `fetchPois` / `fetchGeocode` / `fetchRoute`.
- `src/app/api/crypto-map/poi/route.ts` — `GET ?bbox=&coin=` → `{ pois }`, Redis-cached by rounded bbox+coin.
- `src/app/api/crypto-map/geocode/route.ts` — `GET ?q=` → `{ results }`, Redis-cached.
- `src/app/api/crypto-map/directions/route.ts` — `GET ?from=&to=` → `{ distance, duration, geometry }`.
- `src/components/coin-detail/crypto-navigator.tsx` — the MapLibre client component.
- `src/components/coin-detail/crypto-map-section.tsx` — client wrapper, `dynamic(ssr:false)` + Ledger heading.
- `tests/crypto-map.test.ts` — unit tests for the pure parsers.
- i18n: `cryptoMap` namespace added to all 10 message files (en + ru native; others English fallback for v1).

### Wiring

`page.tsx` renders `<CryptoMapSection coinId symbol coinName />` after `<MarketsTable>`.

## UX

- Control bar: Streets ⇄ Satellite, 3D toggle, coin badge.
- Route panel: "My location" (geolocation) or address input → origin; pick a POI → destination;
  build route → line + distance/time; clear.
- Legend: three layer toggles with live counts; click a marker → popup (name, type, address, "Route here").
- Min-zoom guard: only query Overpass when zoomed in enough; otherwise prompt "zoom in".
- Default center: Prague (dense BTCMap coverage) until the viewer locates or searches.

## Error handling

Every external call is wrapped; API routes degrade to empty results / `{error}` and never throw.
Map renders without markers if the POI source is down (silent retry on next move).

## Out of scope (v1)

- Admin-curated financial-institution overlay (relies on OSM tags for now).
- Walking/cycling routes (OSRM demo = car only).
- Full native translations for the 8 non-en/ru locales.
