import type { PointType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Шесть точек превью — ровно столько, сколько требует спека F1. */
export const ACCEPTANCE_PREVIEW = 6;
export const ACCEPTANCE_TOP_COUNTRIES = 10;
/** Потолок выборки для разбивки. Общее число берётся отдельным count(). */
export const ACCEPTANCE_SCAN_LIMIT = 500;

export type AcceptanceRow = {
  id: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  type: PointType;
  lat: number | null;
  lon: number | null;
};

export type AcceptanceSummary = {
  /** Одобренных точек, принимающих монету. Может быть больше, чем rows.length. */
  total: number;
  /** Сколько разных стран встретилось в выборке. */
  countries: number;
  byCountry: { code: string; count: number }[];
  byType: { type: PointType; count: number }[];
  recent: AcceptanceRow[];
};

function countBy<K extends string>(keys: readonly (K | null)[]): Map<K, number> {
  const m = new Map<K, number>();
  for (const k of keys) {
    if (k === null || k === "") continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/**
 * Чистая часть: разбивка по странам и типам из уже прочитанных строк.
 * `total` передаётся отдельно, потому что выборка ограничена ACCEPTANCE_SCAN_LIMIT,
 * а счётчик на карточке должен быть настоящим.
 */
export function aggregateAcceptance(
  rows: readonly AcceptanceRow[],
  total: number,
): AcceptanceSummary {
  const countries = countBy(rows.map((r) => r.countryCode));
  const types = countBy(rows.map((r) => r.type));
  return {
    total,
    countries: countries.size,
    byCountry: [...countries.entries()]
      .map(([code, count]) => ({ code, count }))
      // Ничья по частоте решается кодом страны — иначе порядок пляшет между запросами.
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, ACCEPTANCE_TOP_COUNTRIES),
    byType: [...types.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    recent: rows.slice(0, ACCEPTANCE_PREVIEW),
  };
}

/**
 * Только APPROVED-точки одобренных компаний: непроверенная точка — не
 * доказательство приёма. Без кеша и без Redis — одобрение модератором должно
 * быть видно на карточке сразу, как и в POI-фиде.
 */
export async function getAcceptanceSummary(cardId: string): Promise<AcceptanceSummary> {
  const where = {
    status: "APPROVED" as const,
    company: { status: "APPROVED" as const, deletedAt: null },
    deletedAt: null,
    acceptedCardIds: { has: cardId },
  };
  const [total, rows] = await Promise.all([
    prisma.companyPoint.count({ where }),
    prisma.companyPoint.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: ACCEPTANCE_SCAN_LIMIT,
      select: {
        id: true, name: true, city: true, countryCode: true,
        type: true, lat: true, lon: true,
      },
    }),
  ]);
  return aggregateAcceptance(rows, total);
}
