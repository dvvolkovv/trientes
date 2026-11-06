import { NextResponse } from "next/server";
import { parseBbox, coinPaymentTags, type Poi } from "@/lib/crypto-map";
import { fetchOsmPoisInBbox } from "@/lib/osm-poi-store";
import { fetchApprovedPointsInBbox } from "@/lib/company-points";
import { fetchApprovedFintechHqInBbox } from "@/lib/fintech-pois";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const bboxParam = url.searchParams.get("bbox");
  const coin = url.searchParams.get("coin") ?? "bitcoin";
  const symbol = url.searchParams.get("symbol") ?? "btc";

  const bbox = parseBbox(bboxParam);
  if (!bbox) return NextResponse.json({ error: "invalid bbox" }, { status: 400 });

  const coinTags = coinPaymentTags(coin, symbol);

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

  let company: Poi[] = [];
  try {
    company = await fetchApprovedPointsInBbox(bbox, coin);
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
