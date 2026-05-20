import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { readExchangeRates, readTop100 } from "@/lib/snapshot";
import { getCurrency } from "@/lib/get-currency";
import { readUserWatchedIds, isAuthenticated } from "@/lib/watchlist";
import { CoinHeader } from "@/components/coin-detail/header";
import { ChartPanel } from "@/components/coin-detail/chart-panel";
import { Description } from "@/components/coin-detail/description";
import { CoinLinks } from "@/components/coin-detail/links";
import { SupplyMetrics } from "@/components/coin-detail/supply";
import { MarketsTable } from "@/components/coin-detail/markets";
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

  const [currency, rates, watchedSet, isAuthed] = await Promise.all([
    getCurrency(),
    readExchangeRates(),
    readUserWatchedIds(),
    isAuthenticated(),
  ]);
  const isWatched = watchedSet.has(coin.id);

  return (
    <main className="container mx-auto px-4 py-8 space-y-8">
      <LivePrices currency={currency} rates={rates} />
      <CoinHeader
        row={row}
        currency={currency}
        rates={rates}
        isWatched={isWatched}
        isAuthed={isAuthed}
        locale={locale}
      />
      <ChartPanel coinId={coin.id} />
      <SupplyMetrics row={row} currency={currency} rates={rates} />
      <Description html={coin.description} />
      <CoinLinks coin={coin} />
      <MarketsTable coinId={coin.id} currency={currency} rates={rates} />
    </main>
  );
}
