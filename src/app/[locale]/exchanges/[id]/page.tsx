import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { ExchangeCardHeader } from "@/components/exchange-card/header";
import { ExchangeCardParameters } from "@/components/exchange-card/parameters";
import { ExchangeCardFees } from "@/components/exchange-card/fees";
import { ExchangeCardMetrics } from "@/components/exchange-card/metrics";
import { ExchangeCardDescription, type DescriptionSource } from "@/components/exchange-card/description";
import { ExchangeCardSocials } from "@/components/exchange-card/socials";
import { ExchangeOutboundCta } from "@/components/exchange-card/outbound-cta";
import { ExchangeCardPairs } from "@/components/exchange-card/pairs";
import { ExchangeCardNewPairs } from "@/components/exchange-card/new-pairs";
import { fetchWikipediaSummary } from "@/lib/wikipedia";
import { getFreshExchangeDetail } from "@/lib/exchange-fresh";
import { resolveCpId } from "@/lib/coinpaprika";
import type { Exchange } from "@/lib/coingecko";

export const revalidate = 60;

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const row = await prisma.exchange.findUnique({
    where: { id },
    select: { name: true, logoUrl: true, country: true },
  });
  if (!row) return {};
  const title = `${row.name} — exchange info, volume, trust score`;
  const description = `${row.name}${row.country ? ` (${row.country})` : ""} on Trientes — trust score, 24h volume, trading pairs and listed coins.`;
  const canonical = `${SITE}/${locale}/exchanges/${id}`;
  return {
    title, description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ExchangeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const row = await prisma.exchange.findUnique({ where: { id } });
  if (!row) notFound();

  const t = await getTranslations("exchangeCard");

  const exchange: Exchange = {
    id: row.id,
    name: row.name,
    logoUrl: row.logoUrl,
    country: row.country,
    yearEstablished: row.yearEstablished,
    trustScore: row.trustScore,
    trustScoreRank: row.trustScoreRank,
    volume24hBtc: row.volume24hBtc,
    volume24hUsd: row.volume24hUsd,
    url: row.url,
    hasTradingIncentive: row.hasTradingIncentive,
    description: row.description,
    exchangeType: (row.exchangeType as Exchange["exchangeType"]) ?? null,
    currencies: row.currencies,
    pairsCount: row.pairsCount,
    fiats: row.fiats,
    socials: (row.socials as Exchange["socials"]) ?? null,
    source: (row.source as Exchange["source"]) ?? "cg",
  };

  // CoinPaprika id used for fresh detail (reverse the CG alias map: e.g. "gdax" → "coinbase")
  const cpId = row.source === "cp" ? row.id : resolveCpId(row.id);

  const [wiki, fresh] = await Promise.all([
    fetchWikipediaSummary(exchange.name, locale),
    getFreshExchangeDetail(cpId, row.id),
  ]);

  let description: string | null = null;
  let source: DescriptionSource | null = null;
  let sourceUrl: string | null = null;
  let sourceLang: string | null = null;
  if (wiki) {
    description = wiki.extract;
    source = "wikipedia";
    sourceUrl = wiki.url;
    sourceLang = wiki.locale.toUpperCase();
  } else if (exchange.description) {
    description = exchange.description;
    source = "coinpaprika";
  }

  const fetchedAt = fresh
    ? new Date(fresh.fetchedAt)
    : row.marketsFetchedAt ?? row.fetchedAt;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Exchanges", item: `${SITE}/${locale}/exchanges` },
      { "@type": "ListItem", position: 2, name: exchange.name, item: `${SITE}/${locale}/exchanges/${row.id}` },
    ],
  };

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 space-y-6">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <Link href={`/${locale}/exchanges`} className="text-accent text-[13px] hover:underline inline-block">
        {t("back")}
      </Link>
      <ExchangeCardHeader exchange={exchange} />
      <ExchangeCardMetrics
        exchange={exchange}
        fetchedAt={fetchedAt}
        liveVolume24hUsd={fresh?.volume24hUsd}
      />
      <ExchangeCardParameters
        exchange={exchange}
        liveCurrencies={fresh?.currencies}
        livePairsCount={fresh?.pairsCount}
      />
      <ExchangeCardFees
        makerFeePercent={row.makerFeePercent}
        takerFeePercent={row.takerFeePercent}
        feesNote={row.feesNote}
        feesUrl={row.feesUrl}
      />
      <ExchangeCardNewPairs exchangeId={row.id} />
      <ExchangeCardPairs exchangeId={row.id} />
      <ExchangeCardDescription
        description={description}
        source={source}
        sourceUrl={sourceUrl}
        sourceLang={sourceLang}
      />
      <ExchangeCardSocials socials={exchange.socials} />
      <ExchangeOutboundCta name={exchange.name} url={exchange.url} />
    </main>
  );
}
