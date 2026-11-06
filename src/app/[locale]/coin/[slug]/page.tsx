import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { readExchangeRates, readTop100, readTickers, readNews } from "@/lib/snapshot";
import { topExchangesByVolume, listedAdapterExchanges } from "@/lib/listings";
import { EXCHANGES } from "@/lib/exchanges";
import { getCurrency } from "@/lib/get-currency";
import { readUserWatchedIds, isAuthenticated } from "@/lib/watchlist";
import { localizedDescription } from "@/lib/coin-description";
import { CoinHeader } from "@/components/coin-detail/header";
import { ChartPanel } from "@/components/coin-detail/chart-panel";
import { Description } from "@/components/coin-detail/description";
import { CoinLinks } from "@/components/coin-detail/links";
import { SupplyMetrics } from "@/components/coin-detail/supply";
import { MarketsTable } from "@/components/coin-detail/markets";
import { CryptoMapSection } from "@/components/coin-detail/crypto-map-section";
import { SectionNav } from "@/components/coin-detail/section-nav";
import { getPublicCoinCard } from "@/lib/coin-card-public";
import { CoinCardHeader } from "@/components/coin-card/card-header";
import { CoinCardSections } from "@/components/coin-card/card-sections";
import { TrustPlaque } from "@/components/coin-card/trust-plaque";
import { CardDescription } from "@/components/coin-card/card-description";
import { NewsRail } from "@/components/news-rail";
import { LivePrices } from "@/components/live-prices";
import type { MarketRow } from "@/lib/coingecko";

export const revalidate = 3600;

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const coin = await prisma.coin.findUnique({
    where: { slug },
    select: { id: true, symbol: true, name: true, logoUrl: true },
  });
  if (!coin) return {};
  const title = `${coin.name} (${coin.symbol.toUpperCase()}) price, chart & market data`;
  const description = `Live ${coin.name} (${coin.symbol.toUpperCase()}) price, market cap, 24h volume, supply, exchanges and on-chain stats on Trientes.`;
  const canonical = `${SITE}/${locale}/coin/${slug}`;

  const languages: Record<string, string> = {};
  for (const l of ["en","ru","de","es","fr","ja","ko","pt-BR","tr","zh-CN"]) {
    languages[l] = `${SITE}/${l}/coin/${slug}`;
  }

  return {
    title,
    description,
    alternates: { canonical, languages },
    // openGraph.images / twitter.images intentionally omitted — Next.js picks
    // up the per-route opengraph-image.tsx automatically and gives us a
    // branded social card with live price.
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CoinDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("detail");

  const coin = await prisma.coin.findUnique({
    where: { slug },
    include: {
      snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 },
    },
  });
  // A self-listed card has no Coin row and no snapshot behind it — there is no
  // external feed by design. Serve it as a standalone page under the same
  // canonical /coin/<slug> URL instead of 404ing.
  if (!coin) {
    const only = await getPublicCoinCard(slug);
    if (only) {
      return (
        <main className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-8 md:py-12 space-y-10 md:space-y-14">
          <CoinCardHeader card={only} />
          <TrustPlaque trust={only.trust} />
          <CardDescription description={only.description} provenance={only.provenance} />
          <CoinCardSections card={only} />
        </main>
      );
    }
  }

  if (!coin || !coin.snapshots[0]) {
    // Fall back to Redis list — covers the case where DB has the coin but no snapshot yet.
    const list = await readTop100();
    const fromRedis = list.find((r) => r.id === slug || r.symbol.toLowerCase() === slug.toLowerCase());
    if (!coin && !fromRedis) notFound();
    if (!fromRedis) notFound();
  }

  // When a Coin already exists, the card is an additive layer on top of it.
  const card = await getPublicCoinCard(slug);

  // Build a MarketRow from coin + latest snapshot.
  const s = coin?.snapshots[0];
  const row: MarketRow | null = coin && s
    ? {
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        logoUrl: coin.logoUrl,
        rank: coin.rank,
        priceUsd: Number(s.priceUsd),
        marketCapUsd: Number(s.marketCapUsd),
        volume24hUsd: Number(s.volume24hUsd),
        circulatingSupply: s.circulatingSupply ? Number(s.circulatingSupply) : null,
        totalSupply: s.totalSupply ? Number(s.totalSupply) : null,
        maxSupply: s.maxSupply ? Number(s.maxSupply) : null,
        pctChange1h: s.pctChange1h,
        pctChange24h: s.pctChange24h,
        pctChange7d: s.pctChange7d,
        sparkline7d: (s.sparkline7d as number[] | null) ?? null,
      }
    : null;

  if (!coin || !row) notFound();

  const [currency, rates, watchedSet, isAuthed, tickers, news] = await Promise.all([
    getCurrency(),
    readExchangeRates(),
    readUserWatchedIds(),
    isAuthenticated(),
    readTickers(coin.id),
    readNews(),
  ]);
  const isWatched = watchedSet.has(coin.id);

  // "About" description, localized to the interface language (cached machine translation).
  const aboutHtml = await localizedDescription(coin.id, locale, coin.description);

  // Tickers drive both per-coin views: the top-20 distinct exchanges table and
  // the chart selector (restricted to adapter venues the coin is actually on).
  const topExchanges = topExchangesByVolume(tickers, 20);
  const listed = listedAdapterExchanges(tickers);
  const availableExchanges = EXCHANGES.filter((e) => listed.has(e.id)).map((e) => e.id);

  // JSON-LD: emit a Product-with-offers describing the coin so search engines
  // can show price snippets. Crypto has no native schema.org type, so the
  // industry convention is Product + offers in USD.
  const slugOrId = coin.slug ?? coin.id;
  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${coin.name} (${coin.symbol.toUpperCase()})`,
    image: coin.logoUrl ?? undefined,
    description: `Live ${coin.name} (${coin.symbol.toUpperCase()}) market data on Trientes.`,
    brand: { "@type": "Brand", name: coin.name },
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: row.priceUsd,
      availability: "https://schema.org/InStock",
      url: `${SITE}/${locale}/coin/${slugOrId}`,
    },
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Coins", item: `${SITE}/${locale}` },
      { "@type": "ListItem", position: 2, name: `${coin.name} (${coin.symbol.toUpperCase()})`, item: `${SITE}/${locale}/coin/${slugOrId}` },
    ],
  };

  return (
    <main className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-12 space-y-12 scroll-smooth">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <LivePrices currency={currency} rates={rates} />
      <CoinHeader
        row={row}
        currency={currency}
        rates={rates}
        isWatched={isWatched}
        isAuthed={isAuthed}
        locale={locale}
      />
      <SectionNav hasNews={news.length > 0} />
      <ChartPanel coinId={coin.id} symbol={coin.symbol} availableExchanges={availableExchanges} />
      <SupplyMetrics row={row} currency={currency} rates={rates} />
      <Description html={aboutHtml} />
      <CoinLinks coin={coin} />
      {card && (
        <>
          <TrustPlaque trust={card.trust} />
          <CoinCardSections card={card} />
        </>
      )}
      <section id="exchanges" className="scroll-mt-24">
        <MarketsTable exchanges={topExchanges} currency={currency} rates={rates} />
      </section>
      <section id="navigator" className="scroll-mt-24">
        <CryptoMapSection coinId={coin.id} symbol={coin.symbol} coinName={coin.name} />
      </section>
      {news.length > 0 && (
        <section id="news" className="scroll-mt-24">
          <div className="num text-[11px] uppercase tracking-[0.3em] text-accent inline-flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-accent" aria-hidden />
            Newsflow
          </div>
          <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">{t("jumpNews")}</h2>
          <NewsRail items={news} locale={locale} />
        </section>
      )}
    </main>
  );
}
