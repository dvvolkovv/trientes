import { prisma } from "@/lib/prisma";
import type { Bbox, Poi, PoiLayer, Social } from "@/lib/crypto-map";

// Shape returned by the prisma query in fetchApprovedPointsInBbox (point + its company).
export type PointWithCompany = {
  id: string; type: "SHOP" | "ATM" | "POS" | "SALES_OFFICE"; name: string; description: string | null;
  lat: number; lon: number; address: string | null; acceptedCoinIds: string[];
  logoUrl: string | null; openingHours: string | null; phone: string | null; website: string | null;
  socials: unknown;
  company: { displayName: string; logoUrl: string | null; website: string | null; socials: unknown };
};

function layerFor(type: PointWithCompany["type"]): PoiLayer {
  return type === "ATM" ? "atm" : "merchant";
}
function asSocials(raw: unknown): Social[] {
  return Array.isArray(raw) ? (raw as Social[]) : [];
}

// Convert a company-submitted point into the same Poi shape OSM points use, so the
// existing navigator card/markers render it unchanged. Company-level logo/website/
// socials are the fallback when the point omits its own.
export function companyPointToPoi(p: PointWithCompany, coinId: string): Poi {
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
    socials: asSocials(p.socials).length ? asSocials(p.socials) : asSocials(p.company.socials),
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
  return rows.map((r) => companyPointToPoi(r as unknown as PointWithCompany, coinId));
}
