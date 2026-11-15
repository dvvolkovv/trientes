import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { fetchGeocode, fetchReverseGeocode, type GeoResult } from "@/lib/crypto-map";
import { searchApprovedPointsByName } from "@/lib/company-points";
import { geocodeQueryOrder } from "@/lib/translit";

export const dynamic = "force-dynamic";

const TTL = 86400; // 1d — addresses don't move.

// Reverse branch: ?lat=&lon= resolves a dropped pin to an address.
async function reverse(latRaw: string, lonRaw: string) {
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ result: null }, { status: 400 });
  }
  // v2 bumps the key after we started returning countryCode in the result body.
  const cacheKey = `cmap:rgeo:v2:${lat.toFixed(4)},${lon.toFixed(4)}`;
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(cacheKey);
    if (cached) return NextResponse.json({ result: JSON.parse(cached) }, { headers: { "x-cache": "hit" } });
  } catch {
    // ignore
  }
  try {
    const result = await fetchReverseGeocode(lon, lat);
    try {
      await redis.set(cacheKey, JSON.stringify(result), "EX", TTL);
    } catch {
      // best-effort
    }
    return NextResponse.json({ result }, { headers: { "x-cache": "miss" } });
  } catch {
    return NextResponse.json({ result: null }, { headers: { "x-cache": "error" } });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  if (lat !== null && lon !== null) return reverse(lat, lon);

  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [], queried: q });

  const ccRaw = (url.searchParams.get("cc") ?? "").trim();
  const cc = /^[a-z]{2}$/i.test(ccRaw) ? ccRaw.toUpperCase() : null;
  const langRaw = (url.searchParams.get("lang") ?? "").trim();
  const lang = /^[a-z-]{2,8}$/i.test(langRaw) ? langRaw.toLowerCase() : null;

  // Two-source search: registered company points (by name / brand, looked up
  // fresh so new approvals appear instantly) + Nominatim addresses (cached).
  // Places rank first so typing a brand name finds the business, not a street.
  // v3 — после того как порядок запросов и разбор подписи поменялись:
  // записи прежней формы отдавали кириллический запрос как удачный.
  // Страна в ключе — не украшение: один и тот же запрос в Австрии и в Чехии
  // отдаёт разные адреса.
  const cacheKey = `cmap:geo:v3:${cc ?? "ww"}:${lang ?? "en"}:${q.toLowerCase()}`;
  let addressResults: GeoResult[] = [];
  let queried = q;
  let addressCache: "hit" | "miss" | "error" = "miss";
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { results: GeoResult[]; queried?: string };
      addressResults = parsed.results ?? [];
      queried = parsed.queried ?? q;
      addressCache = "hit";
    }
  } catch {
    // ignore
  }
  if (addressCache !== "hit") {
    // Кириллицей адрес в латинской стране не находится (живой прогон:
    // «Гемайндеберггассе 8» → 0), поэтому запросы идут списком — по одному, до
    // первого непустого ответа. Пауза между ними обязательна: у Nominatim
    // предел один запрос в секунду.
    const candidates = geocodeQueryOrder(q, cc);
    try {
      for (let i = 0; i < candidates.length; i += 1) {
        if (i > 0) await sleep(1100);
        const attempt = candidates[i]!;
        const found = await fetchGeocode(attempt, { countryCode: cc, lang });
        if (found.length > 0) {
          addressResults = found;
          queried = attempt;
          break;
        }
      }
      try {
        await redis.set(cacheKey, JSON.stringify({ results: addressResults, queried }), "EX", TTL);
      } catch {
        // best-effort
      }
    } catch {
      addressCache = "error";
    }
  }

  let places: { label: string; lat: number; lon: number }[] = [];
  try {
    places = await searchApprovedPointsByName(q, 5);
  } catch {
    // DB hiccup — fall back to address results only.
  }

  return NextResponse.json(
    { results: [...places, ...addressResults], queried },
    { headers: { "x-cache": addressCache } },
  );
}
