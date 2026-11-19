/**
 * Чтение предложений продавцов: раздел «Где взять» на паспорте, витрина предприятия,
 * блок предложения в кабинете. Правило видимости — одно (`offerVisible` в
 * `offers-rules.ts` плюс `PUBLIC_COMPANY` в запросе), чтобы страница не называла
 * продавца, которого на витрине нет.
 */
import { prisma } from "@/lib/prisma";
import { PUBLIC_COMPANY } from "@/lib/company-visibility";
import { areaOf } from "@/lib/coin-card-acceptance";
import type { MapArea } from "@/lib/map-start";
import { firstPhotoUrl, VISIBLE_PRODUCT } from "@/lib/products/read";
import { availabilityOf, offerVisible } from "@/lib/products/offers-rules";

/** Полка, на которой товар лежит: место, куда покупатель может прийти. */
export type SellerPlace = {
  pointId: string | null;
  name: string;
  city: string | null;
  countryCode: string | null;
  lat: number | null;
  lon: number | null;
  /** Покупателю — наличие, а не число: остаток продавца мы не проверяли. */
  inStock: boolean;
};

export type SellerOffer = {
  offerId: string;
  companyId: string;
  companyName: string;
  logoUrl: string | null;
  price: number;
  currency: string;
  unit: string;
  cashbackPercent: number | null;
  saleRules: string | null;
  onlineUrl: string | null;
  /** Хоть где-то на полке есть. */
  inStock: boolean;
  places: SellerPlace[];
};

export type WhereToBuy = {
  offers: SellerOffer[];
  /** Прямоугольник полок с координатами — с него открывается карта этого товара. */
  area: MapArea | null;
};

/** Полки, видимые покупателю: не архивные, и либо онлайн, либо на живой одобренной точке. */
const LIVE_SHELF = {
  kind: "SHELF" as const,
  archivedAt: null,
  OR: [
    { online: true },
    {
      point: {
        status: "APPROVED" as const,
        deletedAt: null,
        suspendedAt: null,
      },
    },
  ],
};

/**
 * «Где взять»: живые предложения по товару с полками, где он действительно лежит.
 * Сторонний склад здесь не показывается никогда — это чужое плечо логистики, а не
 * место, куда можно прийти (решение спеки, раздел 3.1).
 */
export async function readProductOffers(productId: string): Promise<WhereToBuy> {
  const offers = await prisma.productOffer.findMany({
    where: {
      productId,
      status: "ACTIVE",
      company: { ...PUBLIC_COMPANY },
      product: { ...VISIBLE_PRODUCT },
    },
    orderBy: [{ price: "asc" }],
    take: 50,
    select: {
      id: true,
      companyId: true,
      product: {
        select: { suspendedAt: true, deletedAt: true, mergedIntoId: true },
      },
      price: true,
      currency: true,
      unit: true,
      cashbackPercent: true,
      saleRules: true,
      onlineUrl: true,
      status: true,
      company: {
        select: {
          displayName: true,
          logoUrl: true,
          status: true,
          suspendedAt: true,
          deletedAt: true,
          warehouses: {
            where: LIVE_SHELF,
            select: {
              id: true,
              name: true,
              online: true,
              point: {
                select: {
                  id: true,
                  name: true,
                  city: true,
                  countryCode: true,
                  lat: true,
                  lon: true,
                },
              },
              balances: { where: { productId }, select: { qty: true } },
            },
          },
        },
      },
    },
  });

  const rows: SellerOffer[] = offers
    // Правило видимости живёт в чистой функции, а условия запроса — её ускорение:
    // разойдутся — виновата будет выборка, а не правило.
    .filter((o) => offerVisible(o, o.company, o.product))
    .map((o) => {
      const places: SellerPlace[] = o.company.warehouses.map((w) => {
        const qty = w.balances.reduce((sum, b) => sum + Number(b.qty), 0);
        return {
          pointId: w.point?.id ?? null,
          // У онлайн-полки имени точки нет — её называет сам склад.
          name: w.point?.name ?? w.name,
          city: w.point?.city ?? null,
          countryCode: w.point?.countryCode ?? null,
          lat: w.point?.lat ?? null,
          lon: w.point?.lon ?? null,
          inStock: availabilityOf([{ qty }]),
        };
      });
      return {
        offerId: o.id,
        companyId: o.companyId,
        companyName: o.company.displayName,
        logoUrl: o.company.logoUrl,
        price: Number(o.price),
        currency: o.currency,
        unit: o.unit,
        cashbackPercent: o.cashbackPercent === null ? null : Number(o.cashbackPercent),
        saleRules: o.saleRules,
        onlineUrl: o.onlineUrl,
        inStock: places.some((p) => p.inStock),
        places: places.filter((p) => p.inStock),
      };
    });

  // Прямоугольник считается по полкам, где товар есть: камера карты не должна уезжать
  // к пустой полке на другом конце страны.
  const area = areaOf(
    rows
      .flatMap((r) => r.places)
      .filter((p) => p.lat !== null && p.lon !== null)
      .map((p) => ({
        id: "",
        name: "",
        city: null,
        countryCode: null,
        type: "SHOP" as const,
        lat: p.lat,
        lon: p.lon,
      })),
  );

  return { offers: rows, area };
}

export type ShowcaseOffer = {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  photoUrl: string | null;
  price: number;
  currency: string;
  unit: string;
  cashbackPercent: number | null;
  inStock: boolean;
};

/** Витрина предприятия: его живые предложения по живым паспортам. */
export async function readCompanyOffers(companyId: string, take = 24): Promise<ShowcaseOffer[]> {
  const offers = await prisma.productOffer.findMany({
    where: { companyId, status: "ACTIVE", product: { ...VISIBLE_PRODUCT } },
    orderBy: [{ updatedAt: "desc" }],
    take,
    select: {
      productId: true,
      price: true,
      currency: true,
      unit: true,
      cashbackPercent: true,
      product: {
        select: { slug: true, name: true, brand: true, photos: true },
      },
    },
  });
  if (offers.length === 0) return [];

  // Наличие — одним запросом по всем товарам витрины, а не запросом на строку.
  const balances = await prisma.stockBalance.groupBy({
    by: ["productId"],
    where: {
      productId: { in: offers.map((o) => o.productId) },
      warehouse: { companyId, ...LIVE_SHELF },
    },
    _sum: { qty: true },
  });
  const stock = new Map(balances.map((b) => [b.productId, Number(b._sum.qty ?? 0)]));

  return offers.map((o) => ({
    productId: o.productId,
    slug: o.product.slug,
    name: o.product.name,
    brand: o.product.brand,
    photoUrl: firstPhotoUrl(o.product.photos),
    price: Number(o.price),
    currency: o.currency,
    unit: o.unit,
    cashbackPercent: o.cashbackPercent === null ? null : Number(o.cashbackPercent),
    inStock: (stock.get(o.productId) ?? 0) > 0,
  }));
}

/** Предложение предприятия в кабинете — вместе с паузой и черновым состоянием. */
export async function readOfferForCabinet(companyId: string, productId: string) {
  const offer = await prisma.productOffer.findUnique({
    where: { companyId_productId: { companyId, productId } },
    select: {
      id: true,
      price: true,
      currency: true,
      unit: true,
      cashbackPercent: true,
      saleRules: true,
      onlineUrl: true,
      status: true,
      updatedAt: true,
    },
  });
  if (!offer) return null;
  return {
    ...offer,
    price: Number(offer.price),
    cashbackPercent: offer.cashbackPercent === null ? null : Number(offer.cashbackPercent),
  };
}

/**
 * Точки, где товар лежит на полке, — для фильтра фида карты (`?product=<slug>`). Зеркало
 * BTC Map и каталог финтеха о товарах не знают, поэтому при этом фильтре фид отдаёт
 * только наши точки.
 */
export async function pointIdsWithProduct(slug: string): Promise<string[]> {
  const product = await prisma.product.findFirst({
    where: { slug, ...VISIBLE_PRODUCT },
    select: { id: true },
  });
  if (!product) return [];
  const rows = await prisma.stockBalance.findMany({
    where: {
      productId: product.id,
      qty: { gt: 0 },
      warehouse: {
        ...LIVE_SHELF,
        pointId: { not: null },
        company: {
          ...PUBLIC_COMPANY,
          productOffers: { some: { productId: product.id, status: "ACTIVE" } },
        },
      },
    },
    select: { warehouse: { select: { pointId: true } } },
    take: 500,
  });
  return [...new Set(rows.map((r) => r.warehouse.pointId).filter((id): id is string => Boolean(id)))];
}
