import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { readExchangeRates, readTop100, readTickers, readNews } from "@/lib/snapshot";
import { topExchangesByVolume, listedAdapterExchanges } from "@/lib/listings";
import { EXCHANGES } from "@/lib/exchanges";
import { getCurrency } from "@/lib/get-currency";
import { readUserWatchedIds, isAuthenticated } from "@/lib/watchlist";
import { CoinHeader } from "@/components/coin-detail/header";
import { ChartPanel } from "@/components/coin-detail/chart-panel";
import { Description } from "@/components/coin-detail/description";
import { CoinLinks } from "@/components/coin-detail/links";
import { SupplyMetrics } from "@/components/coin-detail/supply";
import { MarketsTable } from "@/components/coin-detail/markets";
import { CryptoMapSection } from "@/components/coin-detail/crypto-map-section";
import { SectionNav } from "@/components/coin-detail/section-nav";
import { NewsRail } from "@/components/news-rail";
import { LivePrices } from "@/components/live-prices";
import type { MarketRow } from "@/lib/coingecko";

export const revalidate = 3600;

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
  if (!coin || !coin.snapshots[0]) {
    // Fall back to Redis list — covers the case where DB has the coin but no snapshot yet.
    const list = await readTop100();
    const fromRedis = list.find((r) => r.id === slug || r.symbol.toLowerCase() === slug.toLowerCase());
    if (!coin && !fromRedis) notFound();
    if (!fromRedis) notFound();
  }

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

  // Tickers drive both per-coin views: the top-20 distinct exchanges table and
  // the chart selector (restricted to adapter venues the coin is actually on).
  const topExchanges = topExchangesByVolume(tickers, 20);
  const listed = listedAdapterExchanges(tickers);
  const availableExchanges = EXCHANGES.filter((e) => listed.has(e.id)).map((e) => e.id);

  return (
    <main className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-12 space-y-12 scroll-smooth">
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
      <Description html={coin.description} />
      <CoinLinks coin={coin} />
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
