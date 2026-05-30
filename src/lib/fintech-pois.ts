import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Bbox, Poi } from "@/lib/crypto-map";
import { sanitizeFintechSocials } from "@/lib/fintech";

// Subset of FintechCompany we need to render an HQ pin on the navigator.
export type FintechHqRow = Prisma.FintechCompanyGetPayload<{
  select: {
    id: true; slug: true; displayName: true; logoUrl: true; description: true;
    website: true; hqLat: true; hqLon: true; address: true; services: true; socials: true;
  };
}>;

// Convert a fintech company HQ row into the same Poi shape OSM points use, so the
// existing navigator card/markers render it unchanged. Layer="fintech" lets the UI
// pick a distinct marker style for HQs vs merchants/ATMs.
export function fintechToPoi(row: FintechHqRow): Poi {
  return {
    id: `fintech/${row.id}`,
    lat: row.hqLat as number,
    lon: row.hqLon as number,
    name: row.displayName,
    layer: "fintech",
    category: row.services.join(", "),
    address: row.address,
    lightning: false,
    coinSpecific: false,
    website: row.website,
    openingHours: null,
    phone: null,
    email: null,
    socials: sanitizeFintechSocials(row.socials),
    image: row.logoUrl,
    description: row.description,
  };
}

export async function fetchApprovedFintechHqInBbox(bbox: Bbox): Promise<Poi[]> {
  const rows = await prisma.fintechCompany.findMany({
    where: {
      status: "APPROVED",
      hqLat: { gte: bbox.minLat, lte: bbox.maxLat, not: null },
      hqLon: { gte: bbox.minLon, lte: bbox.maxLon, not: null },
    },
    select: {
      id: true, slug: true, displayName: true, logoUrl: true, description: true,
      website: true, hqLat: true, hqLon: true, address: true, services: true, socials: true,
    },
    take: 200,
  });
  return rows.map(fintechToPoi);
}
