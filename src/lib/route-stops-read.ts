/**
 * Места по пути: три источника фида, отобранные коридором маршрута и интересами
 * человека. Геометрия — в `route-corridor.ts`, ось интересов — в `interests.ts`;
 * здесь только выборка и числа мерчанта (кэшбэк и цена).
 *
 * Спека: `docs/superpowers/specs/2026-11-20-route-interests-stops-design.md`, § 3.
 */
import { prisma } from "@/lib/prisma";
import {
  GENERIC_CRYPTO_TAGS,
  parseCoinSelector,
  parseOverpassElements,
  type Bbox,
  type Poi,
} from "@/lib/crypto-map";
import { PUBLIC_COMPANY } from "@/lib/company-visibility";
import { companyPointToPoi } from "@/lib/company-points";
import { fetchApprovedFintechHqInBbox } from "@/lib/fintech-pois";
import { interestOf, type InterestKey } from "@/lib/interests";
import {
  projectOnRoute,
  rankStops,
  routeChunks,
  sampleLine,
  MIN_ROUTE_METERS,
  routeLength,
} from "@/lib/route-corridor";
import { readProductOffers } from "@/lib/products/offers-read";
import { readCompanyRates } from "@/lib/loyalty/read";
import { cashbackSummary } from "@/lib/loyalty/rates";
import { VISIBLE_PRODUCT } from "@/lib/products/read";

/** Шаг прореживания линии: сто метров точности «через 42 км» ничего не меняют. */
const SAMPLE_METERS = 250;

/**
 * Потолок строк зеркала за один запрос. Коснулись потолка — об этом говорится вслух
 * (`truncated`), а не выдаётся за полный ответ.
 */
const OSM_LIMIT = 2000;

export type RouteStop = {
  poi: Poi;
  interest: InterestKey;
  alongMeters: number;
  offsetMeters: number;
  /** Ставка кэшбэка заведения; у точки зеркала её нет и быть не может. */
  cashbackPercent: number | null;
  /** Ставка относится к лучшей категории, а не ко всему: на экране это «до N %». */
  cashbackUpTo: boolean;
  /** Цена товара в этой точке — только когда в навигаторе включён фильтр по товару. */
  offer: { price: number; currency: string; unit: string } | null;
};

export type RouteStopsResult = { stops: RouteStop[]; hidden: number; truncated: boolean };

const EMPTY: RouteStopsResult = { stops: [], hidden: 0, truncated: false };

function toRanges(chunks: readonly Bbox[]) {
  return chunks.map((b) => ({
    lat: { gte: b.minLat, lte: b.maxLat },
    lon: { gte: b.minLon, lte: b.maxLon },
  }));
}

function outerBbox(chunks: readonly Bbox[]): Bbox {
  return chunks.reduce((acc, b) => ({
    minLat: Math.min(acc.minLat, b.minLat),
    maxLat: Math.max(acc.maxLat, b.maxLat),
    minLon: Math.min(acc.minLon, b.minLon),
    maxLon: Math.max(acc.maxLon, b.maxLon),
  }));
}

export async function findStopsAlongRoute(i: {
  coords: readonly [number, number][];
  interests: readonly InterestKey[];
  corridorMeters: number;
  productSlug?: string | null;
  /** Точка, ради которой маршрут построен: она не «по пути», она цель. */
  excludeIds?: readonly string[];
}): Promise<RouteStopsResult> {
  if (i.coords.length < 2 || i.interests.length === 0) return EMPTY;
  if (routeLength(i.coords) < MIN_ROUTE_METERS) return EMPTY;

  const sampled = sampleLine(i.coords, SAMPLE_METERS);
  const chunks = routeChunks(i.coords, i.corridorMeters);
  if (chunks.length === 0) return EMPTY;
  const ranges = toRanges(chunks);
  const wanted = new Set(i.interests);
  const skip = new Set(i.excludeIds ?? []);

  // Фильтр по товару считается первым: пустой список полок значит «ни одной», и
  // предлагать по пути точки без товара было бы ложью о нём.
  let productPoints: Map<string, { price: number; currency: string; unit: string; cashback: number | null }> | null =
    null;
  if (i.productSlug) {
    productPoints = await readProductPrices(i.productSlug);
    if (productPoints.size === 0) return EMPTY;
  }

  // Фильтр по товару сужает список так же, как фид карты в слайсе BC: зеркало BTC Map и
  // каталог финтеха о товарах не знают, и показывать их рядом с ценой значило бы
  // предлагать по пути места, где товара нет.
  const [osm, points, fintech] = productPoints
    ? await Promise.all([
        Promise.resolve({ pois: [] as Poi[], truncated: false }),
        readCompanyStops(ranges, [...productPoints.keys()]),
        Promise.resolve([] as Poi[]),
      ])
    : await Promise.all([readOsmStops(ranges), readCompanyStops(ranges, null), readFintechStops(chunks)]);

  const rates = await readRatesFor(points.map((p) => p.companyId));

  const raw: RouteStop[] = [];
  const truncated = osm.truncated;
  for (const entry of [
    ...osm.pois.map((poi) => ({ poi, companyId: null as string | null, pointId: null as string | null })),
    ...points.map((p) => ({ poi: p.poi, companyId: p.companyId, pointId: p.pointId })),
    ...fintech.map((poi) => ({ poi, companyId: null as string | null, pointId: null as string | null })),
  ]) {
    if (skip.has(entry.poi.id)) continue;
    const interest = interestOf(entry.poi);
    if (!interest || !wanted.has(interest)) continue;
    const projection = projectOnRoute(sampled, entry.poi);
    if (!projection || projection.offsetMeters > i.corridorMeters) continue;
    const offerRow = entry.pointId ? (productPoints?.get(entry.pointId) ?? null) : null;
    const summary = entry.companyId ? rates.get(entry.companyId) : undefined;
    // Ставка товара старше ставки предприятия: её и обещает продавец на этот товар
    // (`effectiveCashback`, слайс BD). Иначе показываем «на всё» или лучшую категорию.
    const cashbackPercent = offerRow?.cashback ?? summary?.max ?? summary?.base ?? null;
    raw.push({
      poi: entry.poi,
      interest,
      alongMeters: Math.round(projection.alongMeters),
      offsetMeters: Math.round(projection.offsetMeters),
      cashbackPercent,
      cashbackUpTo: offerRow?.cashback == null && summary?.max != null,
      offer: offerRow
        ? { price: offerRow.price, currency: offerRow.currency, unit: offerRow.unit }
        : null,
    });
  }

  const { shown, hidden } = rankStops(raw);
  return { stops: shown, hidden, truncated };
}

async function readOsmStops(
  ranges: ReturnType<typeof toRanges>,
): Promise<{ pois: Poi[]; truncated: boolean }> {
  const rows = await prisma.osmCryptoPoi.findMany({
    where: { OR: ranges },
    take: OSM_LIMIT,
    select: { type: true, osmId: true, lat: true, lon: true, tags: true },
  });
  const pois = parseOverpassElements(
    {
      elements: rows.map((r) => ({
        type: r.type,
        id: Number(r.osmId),
        lat: r.lat,
        lon: r.lon,
        tags: (r.tags ?? {}) as Record<string, string>,
      })),
    },
    // Зеркало крипто-принимающее целиком, и фильтр по выбранной монете здесь не к
    // месту: по пути человеку нужна заправка, а чем платить — вопрос её карточки.
    [...GENERIC_CRYPTO_TAGS],
  );
  return { pois, truncated: rows.length >= OSM_LIMIT };
}

async function readCompanyStops(
  ranges: ReturnType<typeof toRanges>,
  onlyPointIds: string[] | null,
): Promise<{ poi: Poi; companyId: string; pointId: string }[]> {
  if (onlyPointIds && onlyPointIds.length === 0) return [];
  const rows = await prisma.companyPoint.findMany({
    where: {
      status: "APPROVED",
      company: PUBLIC_COMPANY,
      deletedAt: null,
      suspendedAt: null,
      ...(onlyPointIds ? { id: { in: onlyPointIds } } : {}),
      OR: ranges,
    },
    take: 500,
    include: {
      company: {
        select: {
          displayName: true, logoUrl: true, website: true, socials: true,
          description: true, email: true, phone: true,
        },
      },
    },
  });
  const selector = parseCoinSelector(null);
  return rows
    .filter((r) => r.lat !== null && r.lon !== null)
    .map((r) => ({
      // Справочник монет не читаем: в списке по пути стоят расстояние, кэшбэк и цена,
      // а монеты человек увидит в карточке точки, когда её откроет.
      poi: companyPointToPoi(r, selector),
      companyId: r.companyId,
      pointId: r.id,
    }));
}

async function readFintechStops(chunks: readonly Bbox[]): Promise<Poi[]> {
  // Каталог финтеха — двадцать восемь записей на весь мир: один прямоугольник по всему
  // маршруту дешевле сорока восьми запросов, точный отбор всё равно идёт коридором.
  try {
    return await fetchApprovedFintechHqInBbox(outerBbox(chunks));
  } catch {
    return [];
  }
}

async function readRatesFor(
  companyIds: readonly string[],
): Promise<Map<string, { base: number | null; max: number | null }>> {
  const unique = Array.from(new Set(companyIds));
  const out = new Map<string, { base: number | null; max: number | null }>();
  // Предприятий в коридоре единицы: запрос на предприятие здесь не тот дефект, что
  // снимок на монету в слайсе AD, а список нарочно ограничен пятьюстами точками.
  await Promise.all(
    unique.map(async (id) => {
      try {
        const rates = await readCompanyRates(id);
        const summary = cashbackSummary({ base: rates.base, categories: Object.values(rates.byCategory) });
        if (summary) out.set(id, summary);
      } catch {
        // Нет ставки — нет строки: обещание кэшбэка выдумывать нельзя.
      }
    }),
  );
  return out;
}

/** Цена товара по полкам: та же выборка, что раздел «Где взять» на паспорте. */
async function readProductPrices(
  slug: string,
): Promise<Map<string, { price: number; currency: string; unit: string; cashback: number | null }>> {
  const out = new Map<string, { price: number; currency: string; unit: string; cashback: number | null }>();
  const product = await prisma.product.findFirst({
    where: { slug, ...VISIBLE_PRODUCT },
    select: { id: true },
  });
  if (!product) return out;
  const { offers } = await readProductOffers(product.id);
  for (const offer of offers) {
    for (const place of offer.places) {
      if (!place.pointId) continue;
      const prev = out.get(place.pointId);
      // У одной точки предложение одного продавца (@@unique companyId+productId), но
      // точка бывает полкой двух предприятий: показываем дешёвое.
      if (prev && prev.price <= offer.price) continue;
      out.set(place.pointId, {
        price: offer.price,
        currency: offer.currency,
        unit: offer.unit,
        cashback: offer.cashbackPercent,
      });
    }
  }
  return out;
}
