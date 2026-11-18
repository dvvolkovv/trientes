import type { PointType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PUBLIC_COMPANY } from "@/lib/company-visibility";
import type { MapArea } from "@/lib/map-start";

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
  /**
   * Прямоугольник всех точек с координатами: с него открывается карта этой
   * монеты. Ноль точек с координатами — `null`: обещать место нечем.
   */
  area: MapArea | null;
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
 * Прямоугольник точек: крайние широта и долгота среди строк с координатами.
 *
 * Точка без координат («онлайн») выпадает молча, а не считается нулём: ноль
 * широты и долготы — это Гвинейский залив, и одна такая строка увела бы карту
 * с настоящих точек в океан.
 *
 * Точки по обе стороны 180-го меридиана дают прямоугольник во весь мир. Это
 * честный вид: видны все, просто далеко.
 */
export function areaOf(rows: readonly AcceptanceRow[]): MapArea | null {
  let area: MapArea | null = null;
  for (const r of rows) {
    if (r.lat === null || r.lon === null) continue;
    area = area
      ? {
          minLat: Math.min(area.minLat, r.lat),
          maxLat: Math.max(area.maxLat, r.lat),
          minLon: Math.min(area.minLon, r.lon),
          maxLon: Math.max(area.maxLon, r.lon),
        }
      : { minLat: r.lat, maxLat: r.lat, minLon: r.lon, maxLon: r.lon };
  }
  return area;
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
    // По всей выборке, а не по шести строкам превью: на карте человек должен
    // увидеть все точки, а не те, что попали в список.
    area: areaOf(rows),
  };
}

/**
 * Точки, которые монете можно приписать: одобренные, живой компании, не снятые
 * надзором. Те же правила, что в POI-фиде (`fetchApprovedPointsInBbox`):
 * карточка не должна называть место, которого на карте нет.
 */
function visiblePointsWhere(cardId: string) {
  return {
    status: "APPROVED" as const,
    company: { ...PUBLIC_COMPANY },
    deletedAt: null,
    suspendedAt: null,
    acceptedCardIds: { has: cardId },
  };
}

/**
 * Прямоугольник точек карточки — один дешёвый запрос ради камеры карты.
 * Отдельно от сводки: карте не нужны ни страны, ни типы, ни превью, а сводка
 * считается внутри карточки и наружу не выходит.
 */
export async function getAcceptanceArea(cardId: string): Promise<MapArea | null> {
  const rows = await prisma.companyPoint.findMany({
    where: { ...visiblePointsWhere(cardId), lat: { not: null }, lon: { not: null } },
    take: ACCEPTANCE_SCAN_LIMIT,
    select: { lat: true, lon: true },
  });
  // `areaOf` ждёт строку превью целиком, а здесь читаются только координаты:
  // остальные поля в прямоугольник не входят и подставляются пустыми.
  return areaOf(
    rows.map((r) => ({
      id: "", name: "", city: null, countryCode: null,
      type: "SHOP" as PointType, lat: r.lat, lon: r.lon,
    })),
  );
}

/**
 * Только APPROVED-точки одобренных компаний: непроверенная точка — не
 * доказательство приёма. Без кеша и без Redis — одобрение модератором должно
 * быть видно на карточке сразу, как и в POI-фиде.
 */
export async function getAcceptanceSummary(cardId: string): Promise<AcceptanceSummary> {
  const where = visiblePointsWhere(cardId);
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
