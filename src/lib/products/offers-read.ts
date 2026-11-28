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
import { availabilityOf, isServiceUnit, offerVisible } from "@/lib/products/offers-rules";
import { readCategoryRates, readCompanyRates } from "@/lib/loyalty/read";
import { effectiveCashback, type CashbackSource } from "@/lib/loyalty/rates";
import { publicFieldOn } from "@/lib/company-public-fields";

/** Полка, на которой товар лежит: место, куда покупатель может прийти. */
export type SellerPlace = {
  pointId: string | null;
  name: string;
  city: string | null;
  countryCode: string | null;
  lat: number | null;
  lon: number | null;
  /**
   * Покупателю — наличие, а не число: остаток продавца мы не проверяли. У услуги
   * (единицы `service` и `hour`) наличия нет вовсе — `null`, а не `false`: занятие
   * по записи «кончиться на складе» не может, и «нет в наличии» было бы неправдой.
   */
  inStock: boolean | null;
};

export type SellerOffer = {
  offerId: string;
  companyId: string;
  companyName: string;
  logoUrl: string | null;
  price: number;
  currency: string;
  unit: string;
  /** Действующая ставка: товар → категория → «на всё» (`effectiveCashback`). */
  cashbackPercent: number | null;
  cashbackSource: CashbackSource | null;
  saleRules: string | null;
  onlineUrl: string | null;
  /**
   * Политика возврата продавца (слайс BN). ТЗ § 3.1 требует показывать её «на
   * карточке и перед оплатой»; оплаты у нас нет, поэтому «перед оплатой» — это
   * место, где названа цена, то есть вот эта строка.
   */
  returnPolicy: string | null;
  returnDays: number | null;
  /**
   * Показывает ли продавец политику возврата вовсе (выключатель BU, решение
   * владельца 22 ноября). Выключено — строки нет ни на витрине, ни здесь: один
   * выключатель на оба места, иначе продавец спрятал бы строку у себя и нашёл её
   * на паспорте товара.
   */
  showReturns: boolean;
  /** Хоть где-то на полке есть. У услуги — `null`: полки у неё нет по построению. */
  inStock: boolean | null;
  places: SellerPlace[];
};

export type WhereToBuy = {
  offers: SellerOffer[];
  /** Прямоугольник полок с координатами — с него открывается карта этого товара. */
  area: MapArea | null;
};

/**
 * Живая точка предприятия — место, где оказывают услугу.
 *
 * Услуга полки не требует (правило кассы CK), поэтому «где взять» у неё считается не
 * по остатку, а по тому, где стоит продавец: у студии йоги занятие происходит в самой
 * студии. Без этого первый же продавец услуг получал бы «нет в наличии» и паспорт без
 * адреса — то есть витрина говорила бы неправду о том, что мы про него знаем.
 */
const LIVE_PUBLIC_POINT = {
  status: "APPROVED" as const,
  deletedAt: null,
  suspendedAt: null,
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
        select: { suspendedAt: true, deletedAt: true, mergedIntoId: true, category: true },
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
          cashbackBasePercent: true,
          returnPolicy: true,
          returnDays: true,
          publicFields: true,
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
          // Точки предприятия нужны услуге: её «где» — это место продавца.
          points: {
            where: LIVE_PUBLIC_POINT,
            select: { id: true, name: true, city: true, countryCode: true, lat: true, lon: true },
            take: 20,
          },
        },
      },
    },
  });

  // Ставки категории — одним запросом на всех продавцов товара: у товара категория
  // одна, а продавцов до пятидесяти.
  const visible = offers.filter((o) => offerVisible(o, o.company, o.product));
  const categoryRates = await readCategoryRates(
    visible.map((o) => o.companyId),
    visible[0]?.product.category ?? "",
  );

  const rows: SellerOffer[] = visible
    .map((o) => {
      const service = isServiceUnit(o.unit);
      const shelfPlaces: SellerPlace[] = o.company.warehouses.map((w) => {
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
      const servicePlaces: SellerPlace[] = o.company.points.map((pt) => ({
        pointId: pt.id,
        name: pt.name,
        city: pt.city,
        countryCode: pt.countryCode,
        lat: pt.lat,
        lon: pt.lon,
        inStock: null,
      }));
      const places = service ? servicePlaces : shelfPlaces;
      const cashback = effectiveCashback({
        offer: o.cashbackPercent === null ? null : Number(o.cashbackPercent),
        category: categoryRates.get(o.companyId) ?? null,
        company: o.company.cashbackBasePercent === null ? null : Number(o.company.cashbackBasePercent),
      });
      return {
        offerId: o.id,
        companyId: o.companyId,
        companyName: o.company.displayName,
        logoUrl: o.company.logoUrl,
        price: Number(o.price),
        currency: o.currency,
        unit: o.unit,
        cashbackPercent: cashback?.percent ?? null,
        cashbackSource: cashback?.source ?? null,
        saleRules: o.saleRules,
        onlineUrl: o.onlineUrl,
        returnPolicy: o.company.returnPolicy,
        returnDays: o.company.returnDays,
        showReturns: publicFieldOn(o.company.publicFields, "returnPolicy"),
        inStock: service ? null : places.some((p) => p.inStock === true),
        places: service ? places : places.filter((p) => p.inStock === true),
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
  /** Действующая ставка — та же, что покупатель видит на паспорте товара. */
  cashbackPercent: number | null;
  /** У услуги наличия нет: `null`, а не `false` (то же правило, что в «где взять»). */
  inStock: boolean | null;
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
        select: { slug: true, name: true, brand: true, photos: true, category: true },
      },
    },
  });
  if (offers.length === 0) return [];

  // Ставки предприятия читаются один раз на всю витрину: база и все категории.
  const rates = await readCompanyRates(companyId);

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
    cashbackPercent:
      effectiveCashback({
        offer: o.cashbackPercent === null ? null : Number(o.cashbackPercent),
        category: rates.byCategory[o.product.category] ?? null,
        company: rates.base,
      })?.percent ?? null,
    inStock: isServiceUnit(o.unit) ? null : (stock.get(o.productId) ?? 0) > 0,
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
  // Услуга лежит не на полке, а в месте продавца: иначе фильтр по товару у продавца
  // услуг отдавал бы пустую карту, то есть «нигде» вместо «вот где».
  const servicePoints = await prisma.companyPoint.findMany({
    where: {
      ...LIVE_PUBLIC_POINT,
      company: {
        ...PUBLIC_COMPANY,
        productOffers: {
          some: { productId: product.id, status: "ACTIVE", unit: { in: ["service", "hour"] } },
        },
      },
    },
    select: { id: true },
    take: 500,
  });
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
  return [
    ...new Set([
      ...servicePoints.map((pt) => pt.id),
      ...rows.map((r) => r.warehouse.pointId).filter((id): id is string => Boolean(id)),
    ]),
  ];
}

/**
 * Что предприятие продаёт **на этих точках** — для карточки с карты (слайс BX).
 *
 * Идём от полки, а не от товара: «где взять» на паспорте отвечает на вопрос «кто
 * продаёт эту вещь», а карточка точки — на обратный «что тут есть». Правило
 * видимости то же самое (`offerVisible`), второго не заводим.
 *
 * Один запрос на кадр, как справочник монет и акции: в кадре бывает двести точек.
 */
export async function readPointOffers(
  pointIds: readonly string[],
  perPoint = 3,
): Promise<Map<string, { slug: string; name: string; price: string | null }[]>> {
  const out = new Map<string, { slug: string; name: string; price: string | null }[]>();
  if (pointIds.length === 0) return out;

  // Чьи это точки: услуга принадлежит предприятию, а не полке, и без этой связи
  // карточка студии йоги показывала бы пустую витрину (у неё полок нет вовсе).
  const points = await prisma.companyPoint.findMany({
    where: { id: { in: [...pointIds] } },
    select: { id: true, companyId: true },
  });
  if (points.length === 0) return out;

  const shelves = await prisma.warehouse.findMany({
    where: { pointId: { in: [...pointIds] }, ...LIVE_SHELF },
    select: {
      pointId: true,
      companyId: true,
      balances: { where: { qty: { gt: 0 } }, select: { productId: true }, take: 50 },
    },
  });

  const productIds = Array.from(new Set(shelves.flatMap((w) => w.balances.map((b) => b.productId))));
  const companyIds = Array.from(new Set(points.map((pt) => pt.companyId)));
  const offers = await prisma.productOffer.findMany({
    where: {
      companyId: { in: companyIds },
      // Товар — через полку этой точки; услуга — вся, что есть у предприятия.
      OR: [
        ...(productIds.length > 0 ? [{ productId: { in: productIds } }] : []),
        { unit: { in: ["service", "hour"] }, status: "ACTIVE" as const },
      ],
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
    select: {
      companyId: true,
      productId: true,
      price: true,
      currency: true,
      unit: true,
      status: true,
      product: {
        select: { slug: true, name: true, suspendedAt: true, deletedAt: true, mergedIntoId: true },
      },
      company: {
        select: { status: true, suspendedAt: true, deletedAt: true, publicFields: true },
      },
    },
  });
  if (offers.length === 0) return out;
  const byKey = new Map(offers.map((o) => [`${o.companyId}:${o.productId}`, o]));

  type Row = { slug: string; name: string; price: string | null };
  const line = (o: (typeof offers)[number]): Row => ({
    slug: o.product.slug,
    name: o.product.name,
    price: `${Number(o.price)} ${o.currency}${o.unit ? ` / ${o.unit}` : ""}`,
  });
  // Выключатель «товары» читается здесь: фид публичный, и спрятать список вёрсткой
  // значит всё равно отдать его наружу (правило слайса BX).
  const showable = (o: (typeof offers)[number]) =>
    publicFieldOn(o.company.publicFields, "products") && offerVisible(o, o.company, o.product);

  const push = (pointId: string, o: (typeof offers)[number]) => {
    const rows = out.get(pointId) ?? [];
    if (rows.length >= perPoint) return;
    if (!showable(o)) return;
    if (rows.some((r) => r.slug === o.product.slug)) return;
    rows.push(line(o));
    out.set(pointId, rows);
  };

  // Услуги предприятия — на каждой его живой точке: занятие происходит там, где стоит
  // продавец.
  const servicesByCompany = new Map<string, (typeof offers)[number][]>();
  for (const o of offers) {
    if (!isServiceUnit(o.unit)) continue;
    const list = servicesByCompany.get(o.companyId) ?? [];
    list.push(o);
    servicesByCompany.set(o.companyId, list);
  }
  for (const pt of points) {
    for (const o of servicesByCompany.get(pt.companyId) ?? []) push(pt.id, o);
  }

  for (const w of shelves) {
    if (!w.pointId) continue;
    for (const b of w.balances) {
      const offer = byKey.get(`${w.companyId}:${b.productId}`);
      if (!offer) continue;
      push(w.pointId, offer);
    }
  }
  return out;
}
