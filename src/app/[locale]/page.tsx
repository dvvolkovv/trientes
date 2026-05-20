import { setRequestLocale, getTranslations } from "next-intl/server";
import { readTop100, readGlobalStats } from "@/lib/snapshot";
import { GlobalStatsHero } from "@/components/global-stats-hero";
import { CoinTable } from "@/components/coin-table";

export const revalidate = 60; // ISR: regenerate every 60 seconds.

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  const tl = await getTranslations("listing");

  const [rows, stats] = await Promise.all([readTop100(), readGlobalStats()]);

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-4xl font-bold">{t("appName")}</h1>
        <p className="text-muted-foreground mt-1">{t("tagline")}</p>
      </header>
      <GlobalStatsHero stats={stats} />
      {rows.length > 0 ? (
        <CoinTable rows={rows} />
      ) : (
        <p className="text-muted-foreground">{tl("loadingFallback")}</p>
      )}
    </main>
  );
}
