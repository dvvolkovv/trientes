import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { ExchangeCardHeader } from "@/components/exchange-card/header";
import { ExchangeCardParameters } from "@/components/exchange-card/parameters";
import { ExchangeCardMetrics } from "@/components/exchange-card/metrics";
import { ExchangeCardDescription } from "@/components/exchange-card/description";
import { ExchangeCardSocials } from "@/components/exchange-card/socials";
import { ExchangeOutboundCta } from "@/components/exchange-card/outbound-cta";
import type { Exchange } from "@/lib/coingecko";

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

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 space-y-6">
      <Link href={`/${locale}/exchanges`} className="text-accent text-[13px] hover:underline inline-block">
        {t("back")}
      </Link>
      <ExchangeCardHeader exchange={exchange} />
      <ExchangeCardMetrics exchange={exchange} />
      <ExchangeCardParameters exchange={exchange} />
      <ExchangeCardDescription description={exchange.description} />
      <ExchangeCardSocials socials={exchange.socials} />
      <ExchangeOutboundCta name={exchange.name} url={exchange.url} />
    </main>
  );
}
