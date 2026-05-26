import { redis } from "@/lib/redis";

export type WikipediaSummary = {
  title: string;
  extract: string;
  url: string;
  locale: string;
};

const WIKI_LOCALE: Record<string, string> = {
  "en": "en",
  "ru": "ru",
  "de": "de",
  "es": "es",
  "fr": "fr",
  "ja": "ja",
  "ko": "ko",
  "pt-BR": "pt",
  "tr": "tr",
  "zh-CN": "zh",
};

const TTL_SECONDS = 60 * 60 * 24; // 24h
const NEG_TTL_SECONDS = 60 * 60 * 6; // 6h for "not found"

function wikiLocale(appLocale: string): string {
  return WIKI_LOCALE[appLocale] ?? "en";
}

async function fetchOnce(lang: string, title: string): Promise<WikipediaSummary | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "trientes.org (https://trientes.org)" },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as {
    type?: string;
    title?: string;
    extract?: string;
    content_urls?: { desktop?: { page?: string } };
  };
  if (json.type === "disambiguation") return null;
  const extract = (json.extract ?? "").trim();
  if (!extract) return null;
  return {
    title: json.title ?? title,
    extract,
    url: json.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    locale: lang,
  };
}

/**
 * Fetches a Wikipedia summary for `title` in the locale's Wikipedia,
 * falling back to English if the localized page is missing.
 * Cached in Redis (24h hit, 6h miss).
 */
export async function fetchWikipediaSummary(
  title: string,
  appLocale: string,
): Promise<WikipediaSummary | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const lang = wikiLocale(appLocale);
  const cacheKey = `wiki:${lang}:${trimmed.toLowerCase()}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      if (cached === "") return null;
      return JSON.parse(cached) as WikipediaSummary;
    }
  } catch {
    // ignore redis errors, fall through to fetch
  }

  let result = await fetchOnce(lang, trimmed);
  if (!result && lang !== "en") {
    result = await fetchOnce("en", trimmed);
  }

  try {
    if (result) {
      await redis.set(cacheKey, JSON.stringify(result), "EX", TTL_SECONDS);
    } else {
      await redis.set(cacheKey, "", "EX", NEG_TTL_SECONDS);
    }
  } catch {
    // ignore
  }

  return result;
}
