/**
 * Модель представления карточки предприятия (слайс BY) — одна на две поверхности.
 *
 * Карточку рисуют витрина `/{locale}/companies/[id]` и страница «Место» в навигаторе.
 * До этого слайса они собирались порознь, и живой прогон BX уже показал цену второй
 * копии: выключатели «что видят покупатели» читал только фид карты, а витрина
 * показывала выключенное. Поэтому модель собирается здесь, а рисуют её одни и те же
 * компоненты `src/components/company-card/*`.
 *
 * Состояние часов считается **на сервере**: часовой пояс магазина — не пояс браузера
 * (разбор BN), и повторять его разбор на другой стороне значило бы завести вторую
 * правду о том, открыто ли сейчас.
 */

import { prisma } from "@/lib/prisma";
import { NOT_DELETED } from "@/lib/soft-delete";
import { openStateAt, parseWeekHours, type OpenState, type WeekHours } from "@/lib/opening-hours";
import { inheritedHours } from "@/lib/company-inherit";
import { parsePublicFields } from "@/lib/company-public-fields";
import { parsePaymentMethods, type PaymentMethodKey } from "@/lib/payment-methods";
import { effectiveCategory } from "@/lib/merchant-categories";
import { companyMode, type CompanyMode } from "@/lib/company-mode";
import { localizedProse } from "@/lib/localized-prose";
import { adInWindow } from "@/lib/ads/rules";
import { readCompanyOffers, type ShowcaseOffer } from "@/lib/products/offers-read";
import type { AcceptedCoin } from "@/lib/crypto-map";

export type CardHours = {
  week: WeekHours | null;
  timezone: string | null;
  state: OpenState;
  /** Часы взяты у предприятия, своих у точки нет (слайс BX). */
  inherited: boolean;
};

export type CardAd = {
  id: string;
  kind: "PROMO" | "EVENT" | "NEWS";
  title: string;
  body: string | null;
  language: string;
  mediaKind: "IMAGE" | "VIDEO";
  mediaUrl: string;
  posterUrl: string | null;
  audioUrl: string | null;
  promoCode: string | null;
  endsAt: string | null;
  eventAt: string | null;
  /** Конец события (слайс BZ). Пусто — событие одного дня. */
  eventEndAt: string | null;
  /** Место материала (BZ): объект рекламы, а не точка приёма — в фид карты не идёт. */
  place: CardAdPlace | null;
  /** Куда ведёт нажатие на кадр: отдельная страница материала. */
  href: string;
  /** Одно названное действие. Пусто — действия нет. */
  action: {
    kind: "PRODUCT" | "WEBSITE" | "POINT";
    href: string;
    label: string;
    /** Действие ведёт на место самого материала, а не на точку приёма. */
    fromPlace?: boolean;
  } | null;
};

export type CardAdPlace = {
  name: string | null;
  address: string | null;
  lat: number;
  lon: number;
  coins: AcceptedCoin[];
  payments: PaymentMethodKey[];
};

export type CardPoint = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  photo: string | null;
  categoryKey: string | null;
  hours: CardHours | null;
  /** Есть ли координаты: без них в навигатор вести некуда. */
  mappable: boolean;
};

export type CompanyCardView = {
  id: string;
  displayName: string;
  legalName: string | null;
  logoUrl: string | null;
  logoShape: string | null;
  logoFit: string | null;
  verified: boolean;
  city: string | null;
  country: string | null;
  categoryKey: string | null;
  industryKey: string | null;
  industryCustom: string | null;
  mode: CompanyMode;
  description: { text: string | null; translated: boolean };
  requisites: {
    legalName: string | null;
    registrationNumber: string | null;
    taxNumber: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    returnsShown: boolean;
    returnPolicy: string | null;
    returnDays: number | null;
  };
  hours: CardHours | null;
  points: CardPoint[];
  onlinePoints: { id: string; name: string; website: string | null; hours: CardHours | null }[];
  coins: AcceptedCoin[];
  payments: PaymentMethodKey[];
  ads: CardAd[];
  /** Акции (BG) читает свой блок — ему нужен только выключатель продавца. */
  showPromos: boolean;
  /** Товары предприятия (BC): их показывает «Витрина» — и на странице, и в навигаторе. */
  offers: ShowcaseOffer[];
  /** Публичные документы (BU/BV); группируются на отрисовке — там есть переводчик. */
  documents: { id: string; kind: string; kindCustom: string | null; title: string | null; url: string | null; linkUrl: string | null }[];
  offerCount: number;
  /** Куда ведёт «открыть на карте»: первая живая точка с координатами. */
  mapPointId: string | null;
};

const POINT_SELECT = {
  id: true, type: true, name: true, address: true, lat: true, lon: true,
  city: true, countryCode: true, openingHours: true, website: true, photos: true,
  hours: true, timezone: true, category: true, suspendedAt: true,
} as const;

function firstPhoto(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (const item of raw) {
    const url = (item as { url?: unknown } | null)?.url;
    if (typeof url === "string" && url) return url;
  }
  return null;
}

function hoursOf(week: WeekHours | null, timezone: string | null, now: Date, inherited: boolean): CardHours | null {
  if (!week) return null;
  return { week, timezone, state: openStateAt(week, timezone, now), inherited };
}

/**
 * Карточка целиком. `null` — предприятия нет, оно не залистовано или снято надзором:
 * то же правило видимости, что у страницы витрины (AR).
 */
export async function buildCompanyCard({
  companyId,
  locale,
  now = new Date(),
  original = false,
}: {
  companyId: string;
  locale: string;
  now?: Date;
  original?: boolean;
}): Promise<CompanyCardView | null> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, ...NOT_DELETED },
    include: {
      documents: {
        where: { publishedAt: { not: null } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, kind: true, kindCustom: true, title: true, url: true, linkUrl: true },
      },
      points: {
        where: { status: "APPROVED", ...NOT_DELETED },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: POINT_SELECT,
      },
      ads: {
        where: { status: "PUBLISHED" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        take: 20,
        select: {
          id: true, kind: true, title: true, body: true, language: true,
          mediaKind: true, mediaUrl: true, posterUrl: true, audioUrl: true,
          promoCode: true, startsAt: true, endsAt: true, eventAt: true, eventEndAt: true,
          placeName: true, placeAddress: true, placeLat: true, placeLon: true,
          placeAcceptedCoinIds: true, placeAcceptedCardIds: true, placePaymentMethods: true,
          action: true, actionUrl: true,
          product: { select: { slug: true, name: true, suspendedAt: true, mergedIntoId: true } },
          point: { select: { id: true, name: true, status: true, suspendedAt: true, deletedAt: true } },
        },
      },
    },
  });
  if (!company || company.status !== "APPROVED" || company.suspendedAt) return null;

  const physical = company.points.filter((p) => p.type !== "ONLINE");
  const online = company.points.filter((p) => p.type === "ONLINE");
  const show = parsePublicFields(company.publicFields, {
    hasPhysicalPoints: physical.some((p) => !p.suspendedAt),
  });

  // Монеты места материала (BZ) читаются тем же запросом, что монеты предприятия:
  // два запроса об одних и тех же строках стоили бы вдвое, а набор у места свой.
  const liveAds = company.ads.filter((a) => adInWindow(a, now)).slice(0, 5);
  const wantedCoinIds = [
    ...(show.coins ? company.acceptedCoinIds : []),
    ...liveAds.flatMap((a) => a.placeAcceptedCoinIds),
  ];
  const wantedCardIds = [
    ...(show.coins ? company.acceptedCardIds : []),
    ...liveAds.flatMap((a) => a.placeAcceptedCardIds),
  ];

  const [onlineStockShelves, offers, coinRows, cardRows] = await Promise.all([
    prisma.warehouse.count({
      where: {
        companyId: company.id, kind: "SHELF", online: true, archivedAt: null,
        balances: { some: { qty: { gt: 0 } } },
      },
    }),
    show.products ? readCompanyOffers(company.id) : Promise.resolve([] as ShowcaseOffer[]),
    wantedCoinIds.length
      ? prisma.coin.findMany({
          where: { id: { in: [...new Set(wantedCoinIds)] } },
          select: { id: true, symbol: true, name: true, logoUrl: true, slug: true },
        })
      : Promise.resolve([]),
    wantedCardIds.length
      ? prisma.coinCard.findMany({
          where: { id: { in: [...new Set(wantedCardIds)] }, status: "APPROVED" },
          select: { id: true, symbol: true, name: true, logoUrl: true, slug: true },
        })
      : Promise.resolve([]),
  ]);

  const about = await localizedProse({
    ns: "company",
    id: company.id,
    locale,
    sourceLocale: null,
    fields: { description: show.description ? company.description : null },
    original,
  });

  const officeWeek = show.hours ? parseWeekHours(company.hours) : null;
  const hours = hoursOf(officeWeek, company.timezone, now, false);

  const points: CardPoint[] = physical
    .filter((p) => !p.suspendedAt)
    .map((p) => {
      const inherit = inheritedHours(
        { hours: p.hours, timezone: p.timezone },
        { hours: company.hours, timezone: company.timezone },
      );
      return {
        id: p.id,
        name: p.name,
        address: show.preciseAddress ? p.address : (p.city ?? null),
        city: p.city,
        photo: show.photos ? firstPhoto(p.photos) : null,
        categoryKey: effectiveCategory(p.category, company.category),
        hours: show.hours ? hoursOf(inherit.hours, inherit.timezone, now, inherit.from === "company") : null,
        mappable: p.lat !== null && p.lon !== null,
      };
    });

  /** Монета словами по ключу: один набор строк на предприятие и на места материалов. */
  const coinsByIds = (coinIds: string[], cardIds: string[]): AcceptedCoin[] => [
    ...coinRows
      .filter((c) => coinIds.includes(c.id))
      .map((c) => ({
        key: c.id, symbol: c.symbol.toUpperCase(), name: c.name, logoUrl: c.logoUrl, slug: c.slug, own: false,
      })),
    ...cardRows
      .filter((c) => cardIds.includes(c.id))
      .map((c) => ({
        key: c.id, symbol: c.symbol.toUpperCase(), name: c.name, logoUrl: c.logoUrl, slug: c.slug, own: true,
      })),
  ];

  const coins: AcceptedCoin[] = show.coins
    ? coinsByIds(company.acceptedCoinIds, company.acceptedCardIds)
    : [];

  // Материалы баннера: опубликованные и идущие сейчас. Привязка к снятому товару или
  // снятой точке гасит **действие**, а не материал (правило BG).
  const ads: CardAd[] = liveAds
    .map((a) => {
      let action: CardAd["action"] = null;
      if (a.action === "PRODUCT" && a.product && !a.product.suspendedAt && !a.product.mergedIntoId) {
        action = { kind: "PRODUCT", href: `/${locale}/product/${a.product.slug}`, label: a.product.name };
      } else if (a.action === "POINT" && a.point && a.point.status === "APPROVED" && !a.point.suspendedAt && !a.point.deletedAt) {
        action = { kind: "POINT", href: `/${locale}/crypto-map?point=${a.point.id}`, label: a.point.name };
      } else if (a.action === "POINT" && a.placeLat !== null && a.placeLon !== null) {
        // «Показать на карте» ведёт и на место самого материала: объект рекламы
        // точкой приёма не является, и карточке его открывать нечему — поэтому
        // навигатор просто становится на координату (тот же `?at=`, что на
        // странице материала).
        action = {
          kind: "POINT",
          href: `/${locale}/crypto-map?at=${a.placeLat},${a.placeLon}`,
          // Подпись короткая: полный адрес из реестра бывает в четыре строки с
          // названием страны на четырёх языках, и кнопка перестаёт быть кнопкой.
          label: a.placeName ?? (a.placeAddress ?? "").split(",")[0]?.trim() ?? "",
          fromPlace: true,
        };
      } else if (a.action === "WEBSITE" && a.actionUrl) {
        action = { kind: "WEBSITE", href: a.actionUrl, label: a.actionUrl.replace(/^https:\/\//, "") };
      }
      return {
        id: a.id,
        kind: a.kind,
        title: a.title,
        body: a.body,
        language: a.language,
        mediaKind: a.mediaKind,
        mediaUrl: a.mediaUrl,
        posterUrl: a.posterUrl,
        audioUrl: a.audioUrl,
        promoCode: a.promoCode,
        endsAt: a.endsAt ? a.endsAt.toISOString() : null,
        eventAt: a.eventAt ? a.eventAt.toISOString() : null,
        eventEndAt: a.eventEndAt ? a.eventEndAt.toISOString() : null,
        // Место материала выключателями витрины не гасится: это часть самого
        // объявления, а не раздел карточки (монеты предприятия — другое дело).
        place:
          a.placeLat !== null && a.placeLon !== null
            ? {
                name: a.placeName,
                address: a.placeAddress,
                lat: a.placeLat,
                lon: a.placeLon,
                coins: coinsByIds(a.placeAcceptedCoinIds, a.placeAcceptedCardIds),
                payments: parsePaymentMethods(a.placePaymentMethods),
              }
            : null,
        href: `/${locale}/ad/${a.id}`,
        action,
      };
    });

  return {
    id: company.id,
    displayName: company.displayName,
    legalName: company.legalName,
    logoUrl: company.logoUrl,
    logoShape: company.logoShape,
    logoFit: company.logoFit,
    verified: company.kybStatus === "APPROVED",
    city: company.city,
    country: company.country,
    categoryKey: company.category,
    industryKey: company.industry,
    industryCustom: company.industryCustom,
    mode: companyMode({
      offlinePoints: physical.filter((p) => p.lat !== null && p.lon !== null && !p.suspendedAt).length,
      onlinePoints: online.length,
      onlineStockShelves,
    }),
    description: { text: about.fields.description ?? null, translated: about.translated },
    requisites: {
      legalName: company.legalName,
      registrationNumber: company.registrationNumber,
      taxNumber: company.taxNumber,
      phone: show.phone ? company.phone : null,
      email: show.email ? company.email : null,
      website: show.website ? company.website : null,
      address: show.preciseAddress ? company.address : null,
      returnsShown: show.returnPolicy,
      returnPolicy: company.returnPolicy,
      returnDays: company.returnDays,
    },
    hours,
    points,
    onlinePoints: online.map((p) => ({
      id: p.id,
      name: p.name,
      website: show.website ? p.website : null,
      hours: show.hours ? hoursOf(parseWeekHours(p.hours), p.timezone, now, false) : null,
    })),
    coins,
    offers,
    showPromos: show.promos,
    documents: show.documents ? company.documents : [],
    payments: parsePaymentMethods(company.paymentMethods),
    ads,
    offerCount: offers.length,
    mapPointId: physical.find((p) => p.lat !== null && p.lon !== null && !p.suspendedAt)?.id ?? null,
  };
}
