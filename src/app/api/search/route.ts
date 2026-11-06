import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { NOT_DELETED } from "@/lib/soft-delete";

export const dynamic = "force-dynamic";

type Hit = {
  kind: "coin" | "coinCard" | "exchange" | "fintech" | "company";
  id: string;
  title: string;
  subtitle: string | null;
  logoUrl: string | null;
  href: string;
};

const PER_GROUP = 5;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const locale = (url.searchParams.get("locale") ?? "en").trim() || "en";
  if (q.length < 2) return NextResponse.json({ hits: [] satisfies Hit[] });

  const [coins, cards, exchanges, fintechs, companies] = await Promise.all([
    prisma.coin.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { symbol: { contains: q, mode: "insensitive" } },
          { slug: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, symbol: true, slug: true, logoUrl: true, rank: true },
      orderBy: [{ rank: "asc" }],
      take: PER_GROUP,
    }),
    // Self-listed cards live outside the CoinGecko-backed Coin table. A card
    // bound to an existing Coin (coinId set) is already represented by that
    // coin's hit, so only unbound cards are searched here.
    prisma.coinCard.findMany({
      where: {
        status: "APPROVED",
        coinId: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { symbol: { contains: q, mode: "insensitive" } },
          { slug: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, symbol: true, slug: true, logoUrl: true },
      orderBy: [{ completeness: "desc" }],
      take: PER_GROUP,
    }),
    prisma.exchange.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { id: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, logoUrl: true, country: true, trustScoreRank: true },
      orderBy: [{ trustScoreRank: { sort: "asc", nulls: "last" } }],
      take: PER_GROUP,
    }),
    prisma.fintechCompany.findMany({
      where: {
        status: "APPROVED",
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { slug: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, slug: true, displayName: true, logoUrl: true, countryCode: true },
      orderBy: [{ source: "asc" }, { displayName: "asc" }],
      take: PER_GROUP,
    }),
    prisma.company.findMany({
      where: {
        status: "APPROVED",
        ...NOT_DELETED,
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { legalName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, displayName: true, legalName: true, logoUrl: true, country: true, countryCode: true },
      orderBy: [{ kybStatus: "desc" }, { createdAt: "desc" }],
      take: PER_GROUP,
    }),
  ]);

  const hits: Hit[] = [
    ...coins.map((c) => ({
      kind: "coin" as const,
      id: c.id,
      title: c.name,
      subtitle: c.symbol.toUpperCase(),
      logoUrl: c.logoUrl,
      href: `/${locale}/coin/${c.slug}`,
    })),
    ...cards.map((c) => ({
      kind: "coinCard" as const,
      id: c.id,
      title: c.name,
      subtitle: c.symbol.toUpperCase(),
      logoUrl: c.logoUrl,
      href: `/${locale}/coin/${c.slug}`,
    })),
    ...exchanges.map((e) => ({
      kind: "exchange" as const,
      id: e.id,
      title: e.name,
      subtitle: e.country ?? null,
      logoUrl: e.logoUrl,
      href: `/${locale}/exchanges/${e.id}`,
    })),
    ...fintechs.map((f) => ({
      kind: "fintech" as const,
      id: f.id,
      title: f.displayName,
      subtitle: f.countryCode,
      logoUrl: f.logoUrl,
      href: `/${locale}/fintech/${f.slug}`,
    })),
    ...companies.map((c) => ({
      kind: "company" as const,
      id: c.id,
      title: c.displayName,
      subtitle: c.country ?? c.countryCode ?? null,
      logoUrl: c.logoUrl,
      href: `/${locale}/companies/${c.id}`,
    })),
  ];

  return NextResponse.json(
    { hits },
    { headers: { "cache-control": "no-store" } },
  );
}
