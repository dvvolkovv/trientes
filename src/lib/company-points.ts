import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PUBLIC_COMPANY } from "@/lib/company-visibility";
import { readPointPromos } from "@/lib/promos/read";
import { readPointOffers } from "@/lib/products/offers-read";
import { localizedProse } from "@/lib/localized-prose";
import type { AcceptedCoin, Bbox, CoinSelector, Poi, PoiLayer, Social } from "@/lib/crypto-map";
import { effectiveCategory } from "@/lib/merchant-categories";
import { inheritedCoins, inheritedHours } from "@/lib/company-inherit";
import { parsePublicFields, type PublicFields } from "@/lib/company-public-fields";

// Shape returned by the prisma query in fetchApprovedPointsInBbox (point + its company).
export type PointWithCompany = Prisma.CompanyPointGetPayload<{
  include: {
    company: {
      select: {
        displayName: true; logoUrl: true; website: true; socials: true;
        description: true; email: true; phone: true; category: true;
        hours: true; timezone: true; publicFields: true;
        acceptedCoinIds: true; acceptedCardIds: true;
        returnPolicy: true; returnDays: true;
        registrationNumber: true; taxNumber: true;
      };
    };
  };
}>;

/**
 * Что из предприятия выбирает фид (слайс BX). Один список на оба места, где он
 * нужен, — иначе запрос кадра и запрос одной точки разошлись бы по полям, и
 * карточка, открытая по ссылке, отличалась бы от открытой с карты.
 */
export const POI_COMPANY_SELECT = {
  displayName: true, logoUrl: true, website: true, socials: true,
  description: true, email: true, phone: true, category: true,
  hours: true, timezone: true, publicFields: true,
  acceptedCoinIds: true, acceptedCardIds: true,
  returnPolicy: true, returnDays: true,
  registrationNumber: true, taxNumber: true,
} as const;

/** Пометка «проверяется» — отдельное поле, а не статус: точка остаётся одобренной. */
export function pointUnderReview(p: { underReviewAt: Date | null }): boolean {
  return p.underReviewAt !== null;
}

function layerFor(type: PointWithCompany["type"]): PoiLayer {
  return type === "ATM" ? "atm" : "merchant";
}
function asSocials(raw: unknown): Social[] {
  if (!Array.isArray(raw)) return [];
  const out: Social[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const network = (item as { network?: unknown }).network;
    const url = (item as { url?: unknown }).url;
    if (typeof network !== "string" || !network.trim()) continue;
    if (typeof url !== "string") continue;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    } catch {
      continue;
    }
    out.push({ network: network.trim(), url });
  }
  return out;
}

/** Тикеры, имена и логотипы для чипсов — один справочник на весь ответ фида. */
export type CoinRegistry = {
  coins: Map<string, { symbol: string; name: string; logoUrl: string | null; slug: string }>;
  cards: Map<string, { symbol: string; name: string; logoUrl: string | null; slug: string }>;
};

export const EMPTY_COIN_REGISTRY: CoinRegistry = { coins: new Map(), cards: new Map() };

/** Не больше пяти, как в форме точки, и только http(s) — те же правила, что у `socials`. */
function asPhotos(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const url = (item as { url?: unknown }).url;
    if (typeof url !== "string") continue;
    // Загрузки точек лежат под /uploads/points/, то есть приходят путём, а не
    // абсолютным адресом: база нужна только чтобы отсечь javascript: и data:.
    try {
      const u = new URL(url, "https://trientes.org");
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    } catch {
      continue;
    }
    out.push(url);
    if (out.length === 5) break;
  }
  return out;
}

/**
 * Монеты, которые компания заявила у этой точки. Монета, которой нет в
 * справочнике, выпадает молча: чипс без тикера и логотипа ничего не сообщает.
 */
function acceptedCoinsFor(sets: { coins: string[]; cards: string[] }, registry: CoinRegistry): AcceptedCoin[] {
  const out: AcceptedCoin[] = [];
  for (const id of sets.coins) {
    const row = registry.coins.get(id);
    if (!row) continue;
    out.push({
      key: id,
      symbol: row.symbol.toUpperCase(),
      name: row.name,
      logoUrl: row.logoUrl,
      slug: row.slug,
      own: false,
    });
  }
  for (const id of sets.cards) {
    const row = registry.cards.get(id);
    if (!row) continue;
    out.push({
      key: id,
      symbol: row.symbol.toUpperCase(),
      name: row.name,
      logoUrl: row.logoUrl,
      slug: row.slug,
      own: true,
    });
  }
  return out;
}

/**
 * Точка предприятия в том же виде `Poi`, что и точка зеркала BTC Map, — чтобы
 * карточка и булавки рисовали её без единой развилки.
 *
 * Слайс BX добавил сюда два правила, и оба про **одно предприятие, одну витрину**:
 *
 * 1. **Выключатели читаются здесь, а не в браузере.** Фид публичный, и спрятать
 *    телефон вёрсткой значит всё равно отдать его наружу. Выключенный модуль
 *    просто не приходит.
 * 2. **Пустота у точки означает «как у предприятия».** Часы и монеты точка
 *    наследует (`company-inherit.ts`): правило BN «часы принадлежат месту» цело —
 *    своё у точки по-прежнему сильнее, — но молчание больше не означает «нет».
 */
export function companyPointToPoi(
  p: PointWithCompany,
  selector: CoinSelector,
  registry: CoinRegistry = EMPTY_COIN_REGISTRY,
): Poi {
  const show: PublicFields = parsePublicFields(p.company.publicFields, {
    // У точки на карте адрес и так виден, поэтому контекст «точки есть»: иначе
    // умолчание точного адреса считалось бы как у онлайн-предприятия.
    hasPhysicalPoints: true,
  });
  const pointSocials = asSocials(p.socials);
  // Caller (fetchApprovedPointsInBbox) already filters by lat/lon bounds, which
  // implicitly excludes ONLINE-type points (their coords are null). The non-null
  // assertion here is documented by that invariant.
  const photos = show.photos ? asPhotos(p.photos) : [];
  const firstPhoto = photos[0];
  const hours = show.hours
    ? inheritedHours(
        { hours: p.hours, timezone: p.timezone },
        { hours: p.company.hours, timezone: p.company.timezone },
      )
    : ({ hours: null, timezone: null, from: null } as ReturnType<typeof inheritedHours>);
  const coins = show.coins
    ? inheritedCoins(
        { coins: p.acceptedCoinIds ?? [], cards: p.acceptedCardIds ?? [] },
        { coins: p.company.acceptedCoinIds ?? [], cards: p.company.acceptedCardIds ?? [] },
      )
    : ({ coins: [], cards: [], from: null } as ReturnType<typeof inheritedCoins>);
  const website = show.website ? (p.website ?? p.company.website ?? null) : null;
  const description = show.description ? (p.description ?? p.company.description ?? null) : null;
  return {
    id: `company/${p.id}`,
    companyId: p.companyId,
    lat: p.lat!,
    lon: p.lon!,
    name: p.name,
    layer: layerFor(p.type),
    category: p.company.displayName,
    // Вид заведения: уточнение точки сильнее категории предприятия. Текстовую
    // подпись не подменяем — она про то, с кем человек имеет дело.
    categoryKey: effectiveCategory(p.category, p.company.category),
    hours: hours.hours,
    timezone: hours.timezone,
    // Чьё это расписание — говорим прямо: часы конторы у точки без своих это не
    // то же самое, что часы торговли, и выдавать одно за другое молча нельзя.
    hoursFrom: hours.from,
    address: p.address,
    lightning: false,
    // Своя карточка и монета CoinGecko живут в разных пространствах id, поэтому
    // сверяются с разными массивами и никогда не путаются между собой.
    coinSpecific:
      selector.kind === "card"
        ? coins.cards.includes(selector.cardId)
        : coins.coins.includes(selector.coinId.toLowerCase()),
    acceptedCoins: acceptedCoinsFor(coins, registry),
    // Своя точка называет монеты по именам, поэтому «какая-то крипта» ей не нужна.
    acceptedGeneric: false,
    photos,
    website,
    openingHours: show.hours ? p.openingHours : null,
    phone: show.phone ? (p.phone ?? p.company.phone ?? null) : null,
    email: show.email ? (p.company.email ?? null) : null,
    socials: show.socials ? (pointSocials.length ? pointSocials : asSocials(p.company.socials)) : [],
    // Storefront photo wins over generic logo for navigator-popup imagery.
    image: firstPhoto ?? p.logoUrl ?? p.company.logoUrl ?? null,
    // А в шапке карточки стоит именно знак заведения: логотип точки, иначе
    // логотип компании. Фотография витрины сюда не годится.
    logoUrl: p.logoUrl ?? p.company.logoUrl ?? null,
    underReview: pointUnderReview(p),
    description,
    // Политика возврата и реквизиты — то же, что на витрине, и теми же
    // выключателями (BW и BV). Реквизиты выключателя не имеют по решению BV:
    // публичные реквизиты, которые не публичны, — противоречие в названии.
    returnPolicy: show.returnPolicy ? (p.company.returnPolicy ?? null) : null,
    returnDays: show.returnPolicy ? (p.company.returnDays ?? null) : null,
    requisites:
      p.company.registrationNumber || p.company.taxNumber
        ? { registrationNumber: p.company.registrationNumber, taxNumber: p.company.taxNumber }
        : null,
  };
}

export type PlaceHit = { label: string; lat: number; lon: number };

// Name-search for approved company points (point name OR parent company displayName).
// Used by the navigator search bar so owners can find their own business by brand,
// not only by street address. Case-insensitive substring match; both name and
// company status must be APPROVED.
export async function searchApprovedPointsByName(q: string, limit = 5): Promise<PlaceHit[]> {
  const needle = q.trim();
  if (needle.length < 2) return [];
  const rows = await prisma.companyPoint.findMany({
    where: {
      status: "APPROVED",
      company: PUBLIC_COMPANY,
      deletedAt: null,
      // Exclude ONLINE-only points — search bar drives a map fly-to, useless
      // without coordinates.
      lat: { not: null },
      lon: { not: null },
      OR: [
        { name: { contains: needle, mode: "insensitive" } },
        { company: { displayName: { contains: needle, mode: "insensitive" } } },
      ],
    },
    take: limit,
    orderBy: { createdAt: "desc" },
    select: {
      lat: true, lon: true, name: true, address: true,
      company: { select: { displayName: true } },
    },
  });
  return rows
    .filter((r): r is typeof r & { lat: number; lon: number } => r.lat !== null && r.lon !== null)
    .map((r) => ({
      label: r.address ? `${r.name} — ${r.address}` : `${r.name} (${r.company.displayName})`,
      lat: r.lat, lon: r.lon,
    }));
}

// Approved company points whose coordinates fall inside the viewport bbox.
// Defense-in-depth: the parent Company must also be APPROVED — a rejected company
// shouldn't leak its previously-approved points onto the public map.
//
// В режиме карточки фид дополнительно фильтруется по acceptedCardIds: для своего
// листинга «все точки с флажком» бесполезны — его принимают единицы.
/**
 * Ключи точек зеркала BTC Map, которые уже забрали себе предприятия и чья
 * заявка одобрена. Фид прячет такие зеркальные точки: иначе одно заведение
 * стояло бы на карте двумя булавками — своей, с логотипом и рассказом, и
 * чужой, собранной из тегов OSM.
 *
 * Фильтр по выбранной монете здесь намеренно **не применяется**: точку
 * представляет её хозяин, и если он не заявил выбранную монету, то честный
 * ответ — «тут её не принимают», а не вторая булавка из чужих данных.
 */
export async function fetchClaimedOsmKeysInBbox(bbox: Bbox): Promise<Set<string>> {
  const rows = await prisma.companyPoint.findMany({
    where: {
      osmId: { not: null },
      status: "APPROVED",
      company: PUBLIC_COMPANY,
      deletedAt: null,
      suspendedAt: null,
      lat: { gte: bbox.minLat, lte: bbox.maxLat },
      lon: { gte: bbox.minLon, lte: bbox.maxLon },
    },
    take: 500,
    select: { osmId: true },
  });
  return new Set(rows.map((r) => r.osmId).filter((v): v is string => Boolean(v)));
}

export async function fetchApprovedPointsInBbox(
  bbox: Bbox,
  selector: CoinSelector,
  /**
   * Фильтр карты по товару (слайс BC): точки, где товар лежит на полке. Пустой массив —
   * не «все точки», а «ни одной»: товара нет нигде, и карта обязана быть пустой.
   */
  onlyPointIds?: readonly string[],
  /** Язык страницы: описание берётся переведённым, если перевод уже в кеше. */
  locale?: string,
): Promise<Poi[]> {
  if (onlyPointIds && onlyPointIds.length === 0) return [];
  const rows = await prisma.companyPoint.findMany({
    where: {
      status: "APPROVED",
      company: PUBLIC_COMPANY,
      deletedAt: null,
      // Снятая надзором точка с карты уходит; статус APPROVED при этом цел.
      suspendedAt: null,
      lat: { gte: bbox.minLat, lte: bbox.maxLat },
      lon: { gte: bbox.minLon, lte: bbox.maxLon },
      ...(onlyPointIds ? { id: { in: [...onlyPointIds] } } : {}),
      // Монета при фильтре по товару не применяется: человек ищет товар, а чем за него
      // заплатить — отдельный вопрос, и ответ на него стоит в карточке точки.
      //
      // Слайс BX: точка **без своего набора** принимает то, что заявило предприятие,
      // — и отбор обязан это учитывать, иначе унаследованная монета видна в
      // карточке, но точка не попадает в выборку «показывать только с этой монетой».
      ...(selector.kind === "card" && !onlyPointIds
        ? {
            OR: [
              { acceptedCardIds: { has: selector.cardId } },
              {
                acceptedCardIds: { isEmpty: true },
                acceptedCoinIds: { isEmpty: true },
                company: { acceptedCardIds: { has: selector.cardId } },
              },
            ],
          }
        : {}),
    },
    take: 500,
    include: {
      company: {
        select: {
          ...POI_COMPANY_SELECT,
        },
      },
    },
  });
  // Один запрос на весь кадр, а не на точку: в кадре бывает двести точек, и
  // справочник на каждую превратил бы фид в двести запросов.
  // Справочник собирается по **унаследованному** набору: монета предприятия,
  // которой нет ни у одной точки своим списком, иначе выпала бы из справочника и
  // чипс в карточке не нарисовался бы вовсе.
  const sets = rows.map((r) =>
    inheritedCoins(
      { coins: r.acceptedCoinIds ?? [], cards: r.acceptedCardIds ?? [] },
      { coins: r.company.acceptedCoinIds ?? [], cards: r.company.acceptedCardIds ?? [] },
    ),
  );
  const coinIds = Array.from(new Set(sets.flatMap((s) => s.coins)));
  const cardIds = Array.from(new Set(sets.flatMap((s) => s.cards)));
  const [coinRows, cardRows] = await Promise.all([
    coinIds.length
      ? prisma.coin.findMany({
          where: { id: { in: coinIds } },
          select: { id: true, symbol: true, name: true, logoUrl: true, slug: true },
        })
      : Promise.resolve([]),
    cardIds.length
      ? prisma.coinCard.findMany({
          where: { id: { in: cardIds }, status: "APPROVED" },
          select: { id: true, symbol: true, name: true, logoUrl: true, slug: true },
        })
      : Promise.resolve([]),
  ]);
  const registry: CoinRegistry = {
    coins: new Map(
      coinRows.map((c) => [c.id, { symbol: c.symbol, name: c.name, logoUrl: c.logoUrl, slug: c.slug }]),
    ),
    cards: new Map(
      cardRows.map((c) => [c.id, { symbol: c.symbol, name: c.name, logoUrl: c.logoUrl, slug: c.slug }]),
    ),
  };
  const pois = rows.map((r) => companyPointToPoi(r, selector, registry));
  // Описание на языке страницы (слайс BX). Прежде карточка с карты показывала
  // немецкий текст там, где витрина того же предприятия показывала русский: один
  // текст не может быть переведён в одном месте и не переведён в другом. Берём
  // **только из кеша** — промах отдаёт оригинал и модель не зовёт: в кадре бывает
  // двести точек, и мягкий дедлайн на каждую остановил бы карту (правило
  // `localizedProse`, то же, что у списков).
  if (locale) {
    await Promise.all(
      pois.map(async (poi, i) => {
        if (!poi.description) return;
        const row = rows[i];
        // Чей это текст — того и ключ кеша: описание точки и описание
        // предприятия переводятся порознь и под своими именами.
        const own = row.description !== null && row.description !== undefined;
        try {
          const res = await localizedProse({
            ns: own ? "companyPoint" : "company",
            id: own ? row.id : row.companyId,
            locale,
            sourceLocale: null,
            fields: { description: poi.description },
            cacheOnly: true,
          });
          if (res.fields.description) poi.description = res.fields.description;
          poi.descriptionTranslated = res.translated;
        } catch {
          // Перевод — добавка: сбой оставляет оригинал, а не пустую карточку.
        }
      }),
    );
  }

  // Товары на полках этих точек (слайс BX) — одним запросом на кадр. Сбой чтения
  // оставляет карточку без списка товаров, но не без точки: товар — добавка.
  try {
    const offers = await readPointOffers(rows.map((r) => r.id));
    if (offers.size > 0) {
      for (const poi of pois) {
        const rowsForPoint = offers.get(poi.id.slice("company/".length));
        if (rowsForPoint && rowsForPoint.length > 0) poi.offers = rowsForPoint;
      }
    }
  } catch (error) {
    console.error("point_offers_failed", error);
  }
  // Акции точек — одним запросом на кадр, как справочник монет выше. Сбой чтения
  // оставляет карту без строки акции, но не без точек: акция — добавка, а не точка.
  try {
    const promos = await readPointPromos(rows.map((r) => r.id));
    if (promos.length > 0) {
      const byPoint = new Map(promos.map((p) => [p.pointId as string, p]));
      const promoShown = new Map(
        rows.map((r) => [r.id, parsePublicFields(r.company.publicFields, { hasPhysicalPoints: true }).promos]),
      );
      for (const poi of pois) {
        const pointId = poi.id.slice("company/".length);
        // Выключатель «акции» читается здесь же, где выключены остальные модули:
        // строка акции приходит отдельным запросом и мимо маппера.
        if (promoShown.get(pointId) === false) continue;
        const promo = byPoint.get(pointId);
        if (promo) poi.promo = { id: promo.id, title: promo.title };
      }
    }
  } catch (error) {
    console.error("point_promos_failed", error);
  }
  return pois;
}
