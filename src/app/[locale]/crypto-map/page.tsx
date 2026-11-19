import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { LIVE_CARD_COMPANY, PUBLIC_COMPANY } from "@/lib/company-visibility";
import { parseCoinSelector, parsePointId } from "@/lib/crypto-map";
import { getAcceptanceArea } from "@/lib/coin-card-acceptance";
import { readProductOffers } from "@/lib/products/offers-read";
import type { MapArea, MapFocus } from "@/lib/map-start";
import { CryptoMapSection } from "@/components/coin-detail/crypto-map-section";

// Фид точек считается на запрос: одобренная точка должна появляться сразу.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "cryptoMap" });
  // Страница — срез фида по выбранной монете, самостоятельной ценности для
  // индекса у неё нет; канонический адрес остаётся у карточки монеты.
  return { title: t("title"), robots: { index: false, follow: true } };
}

/**
 * Точка, ради которой карту открыли. Видимость решается ровно теми же
 * правилами, что и в фиде: снятую с витрины или ждущую модерации точку адрес
 * не показывает, сколько бы её id ни знали. Не нашлась — карта открывается как
 * прежде, монетой: это честнее, чем 404 на ссылку, которая вчера работала.
 */
async function resolveFocus(raw: string | undefined): Promise<MapFocus | null> {
  const pointId = parsePointId(raw);
  if (!pointId) return null;
  const point = await prisma.companyPoint.findFirst({
    where: {
      id: pointId,
      status: "APPROVED",
      deletedAt: null,
      suspendedAt: null,
      company: { ...PUBLIC_COMPANY },
    },
    select: { id: true, lat: true, lon: true },
  });
  if (!point || point.lat === null || point.lon === null) return null;
  return { id: `company/${point.id}`, lat: point.lat, lon: point.lon };
}

/**
 * Где эту монету принимают — и, значит, с чего карта открывается, когда места
 * в адресе не названо.
 *
 * Фид точек приходит по кадру карты, а карта без подсказки встаёт под ногами у
 * человека (иначе — Мадрид). У карточки монеты точек единицы, и почти
 * наверняка не в этом городе: кнопка «Открыть на карте» показывала пустую
 * Испанию и чужие крипто-точки, а единственный магазин, названный на карточке
 * строкой выше, в ответ фида не попадал вовсе.
 *
 * Считается на запрос, а не кладётся в адрес ссылкой: пересланная ссылка
 * `?coin=card:<id>` обязана вести к точкам и завтра, когда точки переедут,
 * прибавятся или исчезнут.
 *
 * Только для карточки: у монеты каталога точки берутся из зеркала BTC Map и
 * рассыпаны по всему миру — там «где я» и есть правильный первый кадр.
 */
async function resolveArea(selector: ReturnType<typeof parseCoinSelector>): Promise<MapArea | null> {
  if (selector.kind !== "card" || !selector.cardId) return null;
  try {
    return await getAcceptanceArea(selector.cardId);
  } catch {
    // Сбой чтения — карта просто открывается как прежде, а не падает.
    return null;
  }
}

/** Прямоугольник полок с товаром: то же число, что считает раздел «где взять». */
async function resolveProductArea(slug: string): Promise<MapArea | null> {
  try {
    const product = await prisma.product.findFirst({
      where: { slug, deletedAt: null, suspendedAt: null, mergedIntoId: null },
      select: { id: true },
    });
    if (!product) return null;
    const { area } = await readProductOffers(product.id);
    return area;
  } catch {
    // Сбой чтения — карта просто открывается как прежде, а не падает.
    return null;
  }
}

/**
 * Полноэкранный навигатор. До слайса F карта жила только секцией внутри
 * страницы монеты, но кнопка «открыть на карте» с карточки должна вести по
 * ссылке, которую можно переслать: /{locale}/crypto-map?coin=card:<id>.
 * Строка «где именно» называет ещё и место: `&point=<id>` открывает карту на
 * этой точке с раскрытой карточкой.
 */
export default async function CryptoMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ coin?: string; point?: string; product?: string }>;
}) {
  const { locale } = await params;
  const { coin, point, product } = await searchParams;
  setRequestLocale(locale);

  const selector = parseCoinSelector(coin);
  let coinId = "bitcoin";
  let symbol = "btc";
  let coinName = "Bitcoin";

  if (selector.kind === "card") {
    const card = selector.cardId
      ? await prisma.coinCard.findFirst({
          where: { id: selector.cardId, status: "APPROVED", ...LIVE_CARD_COMPANY },
          select: { id: true, name: true, symbol: true },
        })
      : null;
    // Неизвестная или неодобренная карточка не подменяется биткоином молча:
    // фильтр остаётся карточным и карта честно покажет пусто.
    coinId = `card:${selector.cardId}`;
    symbol = card?.symbol ?? "";
    coinName = card?.name ?? "";
  } else {
    const c = await prisma.coin.findFirst({
      where: { OR: [{ id: selector.coinId }, { slug: selector.coinId }] },
      select: { id: true, name: true, symbol: true },
    });
    if (c) {
      coinId = c.id;
      symbol = c.symbol;
      coinName = c.name;
    }
  }

  // Названное место важнее области: в него и зовёт ссылка «где именно».
  const focus = await resolveFocus(point);
  // Фильтр по товару (слайс BC): карта садится на полки, где он лежит, а не под ноги
  // нажавшему — единственный магазин может оказаться в другой стране.
  const productArea = product ? await resolveProductArea(product) : null;
  return (
    <main className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-8 space-y-6">
      <CryptoMapSection
        coinId={coinId}
        symbol={symbol}
        coinName={coinName}
        focus={focus}
        area={focus ? null : (productArea ?? (await resolveArea(selector)))}
        productSlug={product ?? null}
      />
    </main>
  );
}
