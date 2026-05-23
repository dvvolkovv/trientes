# Crypto Navigator — "Окрестности" street-level approach preview

**Date:** 2026-05-23
**Status:** approved (user: "Выполняй")

## Goal

Let a navigator user preview the **street-level surroundings of a destination POI** —
a flythrough of geolocated street photos near the point — so they can recognize the
place and how to approach it on foot. Honest framing: not continuous video; open
crowdsourced street imagery, played as an auto-advancing sequence. Coverage is patchy.

## Sources (dual; key-optional)

Normalized to a single `StreetShot` shape so the UI is source-agnostic.

- **Panoramax** (default, **no key**): `GET https://api.panoramax.xyz/api/search?bbox=…&limit=…`
  → STAC `features[]`: `geometry.coordinates [lon,lat]`, `properties.datetime`,
  `properties["view:azimuth"]`, `assets.{sd,thumb,hd}.href`. Ships working immediately.
- **Mapillary** (best global coverage, **optional `MAPILLARY_TOKEN` env**):
  `GET https://graph.mapillary.com/images?access_token&fields=id,geometry,captured_at,compass_angle,thumb_1024_url,sequence&bbox&limit`
  → `{ data:[…] }`. bbox must be < 0.01° square. Token stays **server-side**; only
  finished image URLs reach the browser. When the token is set the endpoint prefers
  Mapillary and falls back to Panoramax when it returns nothing.

## Files

- `src/lib/streetview.ts` — pure: `StreetShot` type, `bboxAround(lat,lon,m)`,
  `haversineMeters`, `parseMapillaryImages`, `parsePanoramax`, `sortByDistance`
  (returns shots + `distanceM`); network: `fetchMapillary`, `fetchPanoramax`,
  `fetchStreetShots(lat,lon)` (picks source, sorts, trims to ~15 nearest). No node deps.
- `src/app/api/crypto-map/streetview/route.ts` — `GET ?lat&lon` → `{ shots, source }`,
  Redis-cached by rounded coords (TTL 7d, incl. empty). Mirrors the `/preview` route.
- `src/components/coin-detail/street-view-overlay.tsx` — React modal player.
- `crypto-navigator.tsx` — "👁 Окрестности" button on the POI popup + overlay state;
  proximity highlight on the button when the user's known location is ≤150 m from the POI.
- `tests/streetview.test.ts` — unit tests for the pure functions.
- i18n: `cryptoMap` gets `streetview`, `streetviewTitle`, `noStreetview`,
  `streetviewNear`, `streetviewSource`, `photoDistance` (en + ru; others English).

## UX

- POI popup gains **👁 Окрестности**. If the viewer's location is known and the POI is
  within ~150 m, the button is highlighted (badge) — the realistic stand-in for
  "150 m before the target" (no background GPS in a web page).
- Click → full-screen overlay: large image, **auto-advance ~1.2 s** played
  **farthest→nearest** (approach feel, ending at the closest shot), prev/next arrows,
  index counter, caption (date + distance to target), source attribution link, close.
- Empty state: "съёмки этого места пока нет". Loading + error states.
- Remote `<img loading="lazy" referrerpolicy="no-referrer">`; collapse/skip on error.

## Error handling

Every external call is timeout-wrapped and degrades to `{ shots: [] }`. The endpoint
never throws. Missing token simply means Panoramax-only.

## Out of scope (v1)

- Interactive 360° pano viewer (mapillary-js) — needs the token in the browser; the
  sequence player keeps the token server-side and is lighter.
- Continuous background "turn-by-turn" triggering.
- Native translations for the 8 non-en/ru locales.
