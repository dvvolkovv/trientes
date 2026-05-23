# Crypto Navigator — richer POI detail card (hours, contacts, socials, media)

**Date:** 2026-05-23
**Status:** approved (user: "Применить, исполнить, вывести на фронт в лучшем современном стиле")

## Goal

Enrich the marker popup ("подробно") in the Crypto Navigator. Today it shows name,
type, ⚡Lightning, address, a website link and a "Route here" button. Add:

1. **Opening hours** — OSM `opening_hours` (shown verbatim).
2. **Contacts** — phone (`contact:phone`/`phone`), email (`contact:email`/`email`).
3. **Social networks** — `contact:{instagram,facebook,telegram,twitter,x,youtube,tiktok,vk,whatsapp,linkedin}`.
4. **Photo / video splash from the place's own source** — OpenGraph `og:image`/`og:video`
   scraped lazily from the POI's `website`, with OSM `image`/`wikimedia_commons` as a fallback.

## Data layer (`src/lib/crypto-map.ts`)

`Poi` gains: `openingHours`, `phone`, `email`, `socials: {network,url}[]`, `image`.
All come from OSM tags Overpass already returns (`out center tags`), so no extra POI
query cost — `parseOverpassElements` just reads more tags. These ride the existing
6 h Redis POI cache and the GeoJSON payload.

- `parseSocials(tags)` — pure: maps `contact:*` to `{network,url}`; bare handles get a
  network base URL prepended; full URLs pass through; unknown/empty skipped.
- `parseOsmImage(tags)` — pure: `image` if http(s); else build a Wikimedia Commons
  `Special:FilePath` thumb URL from `wikimedia_commons`.

### MapLibre nuance

`feature.properties` flattens non-primitive values to JSON strings. `socials` is
JSON-encoded into the GeoJSON feature and `JSON.parse`d when the popup opens.

## OpenGraph preview — new lazy endpoint

`GET /api/crypto-map/preview?url=<website>` → `{ image, video, title }`.

- Called **only when a popup opens** and the POI has a `website`. Never bulk-fetched.
- `parseOpenGraph(html, baseUrl)` — pure: extracts `og:image`, `og:video`, `og:title`
  (+ `twitter:image` fallback); resolves relative URLs against base; drops non-http(s).
- `fetchOgPreview(url)` — network: SSRF-guarded fetch (see below), reads ≤256 KB, parses.
- Redis cache `cmap:og:<url>` TTL 24 h, **including negative results** ("{}") so dead
  sites aren't re-scraped each open.

### Security (this checkout is the live prod box)

`assertPublicUrl(url)` (pure, tested):
- scheme must be `http`/`https`;
- reject credentials in URL;
- DNS-resolve the host and reject loopback / private / link-local / unspecified ranges
  (IPv4 `10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `0.0.0.0`; IPv6 `::1`,
  `fc00::/7`, `fe80::/10`, `::`), plus literal `localhost`.

Fetch uses a 6 s timeout, `redirect: "manual"`-style cap (max 2 manual hops, each
re-checked through `assertPublicUrl`), and a `user-agent`. Failures degrade to `{}`.

Video is **not embedded** (untrusted iframe/player = XSS/clickjacking). If `og:video`
exists we show the `og:image` poster + a "Watch" link to the website.

## UI (`crypto-navigator.tsx` popup)

Same Ledger popup, richer card (~260 px wide):
photo (skeleton while the preview request is in flight) → name → type/⚡ → 🕒 hours →
address → 📞 phone → ✉️ email → social icon-links row → website link → "Route here".
Empty fields are omitted. Remote `<img>` uses `loading="lazy" referrerpolicy="no-referrer"`.

## i18n

`cryptoMap` gains `hours`, `phone`, `email`, `social`, `photoLoading`, `watchVideo`
in **en + ru** (other 8 locales keep the English value, matching v1 of the navigator).

## Tests (`tests/crypto-map.test.ts`)

- `parseOverpassElements`: reads opening hours / phone / email; `socials` built and
  handles normalized; `image` from `image` and from `wikimedia_commons`.
- `parseSocials`: bare handle → URL, full URL passthrough, unknown skipped.
- `parseOpenGraph`: og:image/og:video/og:title, twitter:image fallback, relative-URL
  resolution, non-http rejected, missing → nulls.
- `assertPublicUrl`: passes a public host; rejects localhost, private/loopback IPs,
  non-http scheme, embedded credentials.

## Out of scope (v1)

- "Open now" computation (needs an `opening_hours` parser dependency).
- Embedded video player.
- Native translations for the 8 non-en/ru locales.
