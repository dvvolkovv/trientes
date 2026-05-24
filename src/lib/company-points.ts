import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Bbox, Poi, PoiLayer, Social } from "@/lib/crypto-map";

// Shape returned by the prisma query in fetchApprovedPointsInBbox (point + its company).
export type PointWithCompany = Prisma.CompanyPointGetPayload<{
  include: { company: { select: { displayName: true; logoUrl: true; website: true; socials: true } } };
}>;

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

// Convert a company-submitted point into the same Poi shape OSM points use, so the
// existing navigator card/markers render it unchanged. Company-level logo/website/
// socials are the fallback when the point omits its own.
export function companyPointToPoi(p: PointWithCompany, coinId: string): Poi {
  const pointSocials = asSocials(p.socials);
  return {
    id: `company/${p.id}`,
    lat: p.lat,
    lon: p.lon,
    name: p.name,
    layer: layerFor(p.type),
    category: p.company.displayName,
    address: p.address,
    lightning: false,
    coinSpecific: p.acceptedCoinIds.includes(coinId.toLowerCase()),
    website: p.website ?? p.company.website ?? null,
    openingHours: p.openingHours,
    phone: p.phone,
    email: null,
    socials: pointSocials.length ? pointSocials : asSocials(p.company.socials),
    image: p.logoUrl ?? p.company.logoUrl ?? null,
  };
}

// Approved company points whose coordinates fall inside the viewport bbox.
export async function fetchApprovedPointsInBbox(bbox: Bbox, coinId: string): Promise<Poi[]> {
  const rows = await prisma.companyPoint.findMany({
    where: {
      status: "APPROVED",
      lat: { gte: bbox.minLat, lte: bbox.maxLat },
      lon: { gte: bbox.minLon, lte: bbox.maxLon },
    },
    take: 500,
    include: { company: { select: { displayName: true, logoUrl: true, website: true, socials: true } } },
  });
  return rows.map((r) => companyPointToPoi(r, coinId));
}
