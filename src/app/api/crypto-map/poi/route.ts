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

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const bboxParam = url.searchParams.get("bbox");
  const selector = parseCoinSelector(url.searchParams.get("coin"));
  const symbol = url.searchParams.get("symbol") ?? "btc";

  const bbox = parseBbox(bboxParam);
  if (!bbox) return NextResponse.json({ error: "invalid bbox" }, { status: 400 });

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
