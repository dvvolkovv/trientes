import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Bbox, Poi, PoiLayer, Social } from "@/lib/crypto-map";

// Shape returned by the prisma query in fetchApprovedPointsInBbox (point + its company).
export type PointWithCompany = Prisma.CompanyPointGetPayload<{
  include: {
    company: {
      select: {
        displayName: true; logoUrl: true; website: true; socials: true;
        description: true; email: true; phone: true;
      };
    };
  };
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
// existing navigator card/markers render it unchanged. Company-level fields are the
// fallback when the point omits its own (point description first, then company about).
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
    phone: p.phone ?? p.company.phone ?? null,
    email: p.company.email ?? null,
    socials: pointSocials.length ? pointSocials : asSocials(p.company.socials),
    image: p.logoUrl ?? p.company.logoUrl ?? null,
    description: p.description ?? p.company.description ?? null,
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
      company: { status: "APPROVED" },
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
  return rows.map((r) => ({
    label: r.address ? `${r.name} — ${r.address}` : `${r.name} (${r.company.displayName})`,
    lat: r.lat, lon: r.lon,
  }));
}

// Approved company points whose coordinates fall inside the viewport bbox.
// Defense-in-depth: the parent Company must also be APPROVED — a rejected company
// shouldn't leak its previously-approved points onto the public map.
export async function fetchApprovedPointsInBbox(bbox: Bbox, coinId: string): Promise<Poi[]> {
  const rows = await prisma.companyPoint.findMany({
    where: {
      status: "APPROVED",
      company: { status: "APPROVED" },
      lat: { gte: bbox.minLat, lte: bbox.maxLat },
      lon: { gte: bbox.minLon, lte: bbox.maxLon },
    },
    take: 500,
    include: {
      company: {
        select: {
          displayName: true, logoUrl: true, website: true, socials: true,
          description: true, email: true, phone: true,
        },
      },
    },
  });
  return rows.map((r) => companyPointToPoi(r, coinId));
}
