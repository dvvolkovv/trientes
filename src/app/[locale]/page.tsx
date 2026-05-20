import { setRequestLocale, getTranslations } from "next-intl/server";
import { readTop100, readGlobalStats, readExchangeRates } from "@/lib/snapshot";
import { GlobalStatsHero } from "@/components/global-stats-hero";
import { CoinListClient } from "@/components/coin-list-client";
import { getCurrency } from "@/lib/get-currency";

export const revalidate = 60;

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  const tl = await getTranslations("listing");

  const [rows, stats, rates, currency] = await Promise.all([
    readTop100(),
    readGlobalStats(),
    readExchangeRates(),
    getCurrency(),
  ]);

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-4xl font-bold">{t("appName")}</h1>
        <p className="text-muted-foreground mt-1">{t("tagline")}</p>
      </header>
      <GlobalStatsHero stats={stats} currency={currency} rates={rates} />
      {rows.length > 0 ? (
        <CoinListClient rows={rows} currency={currency} rates={rates} />
      ) : (
        <p className="text-muted-foreground">{tl("loadingFallback")}</p>
      )}
    </main>
  );
}
