/**
 * Биржи каталога, относящиеся к стране.
 *
 * Важная оговорка, из которой вытекает формулировка в интерфейсе:
 * `Exchange.country` у CoinGecko — **страна регистрации** биржи, а не страна,
 * где она доступна. Поэтому полоса над картой говорит «зарегистрированы
 * в стране», а не «доступны»: выдавать юрисдикцию за доступность нельзя.
 *
 * Страна в каталоге записана словами («Austria»), а код страны у нас приходит
 * от обратного геокодирования («AT»), поэтому имя сопоставляется обратным
 * разбором `COUNTRIES`. Живой прогон по базе: из 59 написаний имя не нашлось
 * у трёх — «Turkey» (у нас «Türkiye», лечится псевдонимом), «Panama Canal
 * Zone» и «Unknown or Invalid Region» (страной не являются).
 */

import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { COUNTRIES } from "@/lib/countries";

const TTL = 3600; // 1h

// Написания фида, которых нет в ISO-списке дословно.
const ALIASES: Record<string, string[]> = {
  TR: ["Turkey"],
  US: ["United States of America", "USA"],
  GB: ["United Kingdom of Great Britain and Northern Ireland", "UK"],
  KR: ["South Korea", "Korea, Republic of"],
  VN: ["Viet Nam"],
  HK: ["Hong Kong SAR China"],
  AE: ["UAE"],
};

/** Все написания имени страны, которые в каталоге могут означать этот код. */
export function countryNamesForCode(cc: string): string[] {
  const code = cc.toUpperCase();
  const iso = COUNTRIES.find((c) => c.code === code);
  const out = new Set<string>();
  if (iso) out.add(iso.name);
  for (const alias of ALIASES[code] ?? []) out.add(alias);
  return [...out];
}

export type AvailableExchange = {
  id: string;
  name: string;
  logoUrl: string | null;
  exchangeType: string | null;
  trustScore: number | null;
};

export function availableExchangesCacheKey(cc: string): string {
  return `exchange:country:${cc.toUpperCase()}`;
}

export async function exchangesRegisteredIn(cc: string): Promise<AvailableExchange[]> {
  const code = cc.toUpperCase();
  const names = countryNamesForCode(code);
  if (names.length === 0) return [];

  const key = availableExchangesCacheKey(code);
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as AvailableExchange[];
  } catch {
    // cache miss / redis down — fall through to DB
  }

  const rows = await prisma.exchange.findMany({
    where: { country: { in: names } },
    select: { id: true, name: true, logoUrl: true, exchangeType: true, trustScore: true },
    orderBy: [{ trustScoreRank: "asc" }, { volume24hUsd: "desc" }],
    take: 20,
  });

  try {
    await redis.set(key, JSON.stringify(rows), "EX", TTL);
  } catch {
    // best-effort cache write
  }
  return rows;
}
