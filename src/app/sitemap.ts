import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@/lib/locales";
import { NOT_DELETED } from "@/lib/soft-delete";

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

type Entry = MetadataRoute.Sitemap[number];

// Build hreflang alternate URLs so search engines map a single canonical entry
// across every supported locale. We expose only the default locale (en) as the
// primary URL and list the rest under `alternates.languages` — the count comes
// from SUPPORTED_LOCALES, so adding a language needs no edit here.
function withAlternates(path: string, lastModified?: Date): Entry {
  const languages: Record<string, string> = {};
  for (const l of SUPPORTED_LOCALES) languages[l] = `${SITE}/${l}${path}`;
  return {
    url: `${SITE}/${DEFAULT_LOCALE}${path}`,
    lastModified,
    changeFrequency: "daily",
    priority: path === "" ? 1.0 : 0.7,
    alternates: { languages },
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPaths = ["", "/exchanges", "/fintech", "/companies", "/markets", "/compare"];
  const staticEntries = staticPaths.map((p) => withAlternates(p, now));

  const [coins, cards, exchanges, fintechs, companies] = await Promise.all([
    prisma.coin.findMany({
      where: { isActive: true },
      orderBy: { rank: "asc" },
      take: 500,
      select: { id: true, updatedAt: true },
    }),
    // Self-listed cards have their own slugs and are not in the Coin table.
    prisma.coinCard.findMany({
      where: { status: "APPROVED", coinId: null },
      orderBy: { completeness: "desc" },
      take: 500,
      select: { slug: true, updatedAt: true },
    }),
    prisma.exchange.findMany({
      orderBy: { trustScoreRank: "asc" },
      take: 500,
      select: { id: true, updatedAt: true },
    }),
    prisma.fintechCompany.findMany({
      where: { status: "APPROVED" },
      orderBy: { displayName: "asc" },
      take: 500,
      select: { slug: true, updatedAt: true },
    }),
    prisma.company.findMany({
      where: { status: "APPROVED", ...NOT_DELETED },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { id: true, updatedAt: true },
    }),
  ]);

  const dynamic: Entry[] = [
    ...coins.map((c) => withAlternates(`/coin/${c.id}`, c.updatedAt)),
    ...cards.map((c) => withAlternates(`/coin/${c.slug}`, c.updatedAt)),
    ...exchanges.map((e) => withAlternates(`/exchanges/${e.id}`, e.updatedAt)),
    ...fintechs.map((f) => withAlternates(`/fintech/${f.slug}`, f.updatedAt)),
    ...companies.map((c) => withAlternates(`/companies/${c.id}`, c.updatedAt)),
  ];

  return [...staticEntries, ...dynamic];
}
