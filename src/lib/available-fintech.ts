import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { isValidCountryCode } from "@/lib/fintech";

const TTL = 3600; // 1h

export function availableFintechCacheKey(cc: string): string {
  return `fintech:avail:${cc.toUpperCase()}`;
}

export type AvailableFintech = {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  services: string[];
  supportedCoinIds: string[];
  hqCountryCode: string | null;
};

// Approved fintechs whose availableIn[] contains the given country code.
// Cached in Redis for 1h; admin mutations bust the affected country keys.
export async function fintechsAvailableIn(cc: string): Promise<AvailableFintech[]> {
  const code = cc.toUpperCase();
  if (!isValidCountryCode(code)) return [];

  const key = availableFintechCacheKey(code);
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as AvailableFintech[];
  } catch {
    // cache miss / redis down — fall through to DB
  }

  const rows = await prisma.fintechCompany.findMany({
    where: { status: "APPROVED", availableIn: { has: code } },
    select: {
      id: true, slug: true, displayName: true, logoUrl: true,
      services: true, supportedCoinIds: true, countryCode: true,
    },
    orderBy: [{ source: "asc" }, { displayName: "asc" }],
    take: 100,
  });

  const out: AvailableFintech[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.displayName,
    logoUrl: r.logoUrl,
    services: r.services,
    supportedCoinIds: r.supportedCoinIds,
    hqCountryCode: r.countryCode,
  }));

  try {
    await redis.set(key, JSON.stringify(out), "EX", TTL);
  } catch {
    // best-effort cache write
  }

  return out;
}
