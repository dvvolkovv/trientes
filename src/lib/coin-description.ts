import { createHash } from "node:crypto";
import { redis } from "@/lib/redis";
import { translateHtml, targetLanguageName } from "@/lib/translate";

const TTL = 60 * 60 * 24 * 30; // 30d — descriptions barely change.
// The coin page is ISR (revalidate 3600), so a cold translation is paid once per
// (coin, locale) per hour, not per request — block long enough that the regenerated
// page is usually already localized; the background job covers any slower ones.
const SOFT_DEADLINE_MS = 8000;

async function rGet(key: string): Promise<string | null> {
  if (redis.status === "wait" || redis.status === "end") {
    try {
      await redis.connect();
    } catch {
      return null;
    }
  }
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

async function rSet(key: string, val: string): Promise<void> {
  try {
    await redis.set(key, val, "EX", TTL);
  } catch {
    // best-effort cache
  }
}

/**
 * The coin's "About" description in the interface locale. English and unsupported
 * locales pass the source through untouched. For a supported locale we serve a cached
 * machine translation; on a cache miss we start the translation (which caches itself)
 * and, if it lands within a short deadline, return it now — otherwise fall back to
 * English while the background job fills the cache for next time. Keyed by a hash of the
 * source so a refreshed English description invalidates stale translations automatically.
 */
export async function localizedDescription(
  coinId: string,
  locale: string,
  englishHtml: string | null,
): Promise<string | null> {
  if (!englishHtml || locale === "en" || !targetLanguageName(locale)) return englishHtml;

  const hash = createHash("sha1").update(englishHtml).digest("hex").slice(0, 8);
  const key = `i18ndesc:${coinId}:${locale}:${hash}`;

  const cached = await rGet(key);
  if (cached) return cached;

  const job = (async () => {
    const out = await translateHtml(englishHtml, locale);
    if (out) await rSet(key, out);
    return out;
  })();

  const winner = await Promise.race([
    job,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SOFT_DEADLINE_MS)),
  ]);
  return winner ?? englishHtml;
}
