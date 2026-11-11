// Перевод пользовательской прозы в локаль интерфейса, с кешем в Redis.
// Общая на три сущности: карточка монеты, компания, финтех-сервис — поэтому
// библиотека не знает ни про одну из них, а принимает набор полей.
//
// Образец поведения взят из coin-description.ts: мягкий дедлайн, тихая
// деградация до оригинала, ключ по хешу исходного текста.

import { redis } from "@/lib/redis";
import { detectSourceLocale, proseLanguageName, translateStrings } from "@/lib/translate";
import { collectProse, mergeProse, proseHash, type ProseMap } from "@/lib/prose-fields";

const TTL = 60 * 60 * 24 * 30; // 30d — проза меняется редко.
// Страница карточки рендерится на запрос, но перевод кешируется, поэтому
// холодный вызов платится один раз на (сущность, локаль, версию текста).
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
 * Язык источника с кешем: определять его на каждый рендер — платить за один и
 * тот же ответ. Кеш по хешу текста, поэтому правка текста переопределяет язык.
 */
export async function ensureSourceLocale(
  ns: string,
  id: string,
  sample: string,
  cacheOnly = false,
): Promise<string | null> {
  const key = `i18nsrc:${ns}:${id}:${proseHash({ sample })}`;
  const cached = await rGet(key);
  if (cached) return cached === "none" ? null : cached;
  if (cacheOnly) return null;
  const detected = await detectSourceLocale(sample);
  await rSet(key, detected ?? "none");
  return detected;
}

export type LocalizedProseResult<T> = {
  fields: T;
  /** true только когда перевод реально применён — иначе маркер врал бы. */
  translated: boolean;
  sourceLocale: string | null;
};

/**
 * Возвращает набор полей на языке интерфейса. Ранние выходы покрывают всё, что
 * не требует сети: пустая проза, совпадение языков, неподдерживаемая локаль и
 * явный отказ от перевода (`?orig=1`).
 */
export async function localizedProse<T extends Record<string, string | null>>(input: {
  ns: string;
  id: string;
  locale: string;
  sourceLocale: string | null;
  fields: T;
  /** Посетитель попросил оригинал — не переводим и не помечаем. */
  original?: boolean;
  /**
   * Только из кеша: промах отдаёт оригинал и не зовёт модель. Для списков, где
   * карточек на странице десятки, а мягкий дедлайн платится за каждую по
   * очереди — страница встала бы на минуту ради подписи в три строки. Кеш
   * наполняет прогрев воркера (`prose-warmup.ts`).
   */
  cacheOnly?: boolean;
}): Promise<LocalizedProseResult<T>> {
  const { ns, id, locale, fields, original, cacheOnly } = input;
  const prose = collectProse(fields);
  const nothing = { fields, translated: false, sourceLocale: input.sourceLocale };
  if (original || Object.keys(prose).length === 0) return nothing;
  if (!proseLanguageName(locale)) return nothing;

  // Язык источника: взят из записи или определён один раз по самому длинному полю.
  let source = input.sourceLocale;
  if (!source) {
    const longest = Object.values(prose).sort((a, b) => b.length - a.length)[0];
    source = await ensureSourceLocale(ns, id, longest, cacheOnly);
  }
  if (source === locale) return { fields, translated: false, sourceLocale: source };

  const key = `i18nprose:${ns}:${id}:${locale}:${proseHash(prose)}`;
  const cached = await rGet(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ProseMap;
      return { fields: mergeProse(fields, parsed), translated: true, sourceLocale: source };
    } catch {
      // битый кеш — переводим заново
    }
  }
  if (cacheOnly) return { fields, translated: false, sourceLocale: source };

  const job = (async () => {
    const out = await translateStrings(prose, locale);
    if (out) await rSet(key, JSON.stringify(out));
    return out;
  })();

  const winner = await Promise.race([
    job,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SOFT_DEADLINE_MS)),
  ]);
  if (!winner) return { fields, translated: false, sourceLocale: source };
  return { fields: mergeProse(fields, winner), translated: true, sourceLocale: source };
}
