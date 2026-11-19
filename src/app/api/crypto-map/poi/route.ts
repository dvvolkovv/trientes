import { NextResponse } from "next/server";
import {
  GENERIC_CRYPTO_TAGS,
  coinPaymentTags,
  parseBbox,
  parseCoinSelector,
  type Poi,
} from "@/lib/crypto-map";
import { fetchOsmPoisInBbox } from "@/lib/osm-poi-store";
import { fetchApprovedPointsInBbox, fetchClaimedOsmKeysInBbox } from "@/lib/company-points";
import { poiIdToOsmKey } from "@/lib/osm-key";
import { fetchApprovedFintechHqInBbox } from "@/lib/fintech-pois";
import { pointIdsWithProduct } from "@/lib/products/offers-read";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const bboxParam = url.searchParams.get("bbox");
  const selector = parseCoinSelector(url.searchParams.get("coin"));
  const symbol = url.searchParams.get("symbol") ?? "btc";
  const productSlug = url.searchParams.get("product");

  const bbox = parseBbox(bboxParam);
  if (!bbox) return NextResponse.json({ error: "invalid bbox" }, { status: 400 });

  // Фильтр по товару (слайс BC): отдаём только свои точки, где он лежит на полке.
  // Зеркало BTC Map и каталог финтеха о товарах не знают, и домешивать их значило бы
  // показывать места, где товара нет.
  if (productSlug) {
    let pointIds: string[] = [];
    try {
      pointIds = await pointIdsWithProduct(productSlug);
    } catch {
      // Сбой чтения — пустая карта, а не карта всех точек: вторая врала бы о товаре.
      return NextResponse.json({ pois: [] });
    }
    try {
      const points = await fetchApprovedPointsInBbox(bbox, selector, pointIds);
      return NextResponse.json({ pois: points });
    } catch {
      return NextResponse.json({ pois: [] });
    }
  }

  // В зеркале BTC Map собственных карточек заведомо нет, и притворяться, что
  // есть, нельзя: для карточки берём общий крипто-тег, а фильтр по карточке
  // применяем только к нашим точкам.
  const coinTags =
    selector.kind === "card"
      ? [...GENERIC_CRYPTO_TAGS]
      : coinPaymentTags(selector.coinId, symbol);

  // OSM points come from our own nightly BTC Map mirror rather than a live
  // Overpass query, so a saturated upstream can't blank the map mid-request.
  // No Redis layer: the bbox lookup is an indexed read, and skipping the cache
  // means an overnight sync is visible immediately.
  let osm: Poi[] = [];
  try {
    osm = await fetchOsmPoisInBbox(bbox, coinTags);
  } catch {
    // DB hiccup — still merge the company and fintech layers below.
  }

  // Точку, которую заведение забрало себе («это моё предприятие»), зеркало
  // показывать перестаёт: одно заведение — одна булавка. Сбой этого чтения
  // карту не роняет, но тогда на ней на время появится дубль.
  try {
    const claimed = await fetchClaimedOsmKeysInBbox(bbox);
    if (claimed.size > 0) {
      osm = osm.filter((p) => {
        const key = poiIdToOsmKey(p.id);
        return !key || !claimed.has(key);
      });
    }
  } catch {
    // Читаем дальше: дубль на карте лучше пустой карты.
  }

  let company: Poi[] = [];
  try {
    company = await fetchApprovedPointsInBbox(bbox, selector);
  } catch {
    // DB hiccup — degrade to OSM only.
  }

  let fintech: Poi[] = [];
  try {
    fintech = await fetchApprovedFintechHqInBbox(bbox);
  } catch {
    // DB hiccup — degrade silently.
  }

  return NextResponse.json({ pois: [...fintech, ...company, ...osm] });
}
