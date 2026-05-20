import { setRequestLocale, getTranslations } from "next-intl/server";
import { readTop100, readGlobalStats, readExchangeRates } from "@/lib/snapshot";
import { GlobalStatsHero } from "@/components/global-stats-hero";
import { CoinListClient } from "@/components/coin-list-client";
import { LivePrices } from "@/components/live-prices";
import { getCurrency } from "@/lib/get-currency";
import { readUserWatchedIds, isAuthenticated } from "@/lib/watchlist";

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

  const [rows, stats, rates, currency, watchedSet, isAuthed] = await Promise.all([
    readTop100(),
    readGlobalStats(),
    readExchangeRates(),
    getCurrency(),
    readUserWatchedIds(),
    isAuthenticated(),
  ]);

  const heroTimestamp = new Date().toUTCString().slice(0, 22) + "Z";

  return (
    <main className="bg-bg">
      <div className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20">
        {/* HERO */}
        <section className="py-16 md:py-28">
          <div className="grid grid-cols-12 gap-8 items-end">
            <div className="col-span-12 lg:col-span-8">
              <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-6">
                ● Live · Layer-1 Ledger · {heroTimestamp}
              </div>
              <h1 className="text-[60px] md:text-[88px] lg:text-[112px] leading-[0.92] tracking-[-0.045em] font-black">
                {t("appName")}.
              </h1>
              <p className="mt-8 max-w-[640px] text-[18px] md:text-[20px] leading-[1.5] font-light text-muted">
                {t("tagline")}
              </p>
            </div>
            <div className="col-span-12 lg:col-span-4">
              <GlobalStatsHero stats={stats} currency={currency} rates={rates} />
            </div>
          </div>
        </section>

        {/* COIN TABLE */}
        <section className="py-12">
          <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
            Section · I
          </div>
          <h2 className="text-[32px] md:text-[40px] font-bold tracking-[-0.03em] mb-8">
            Top Layer-1.
          </h2>
          <LivePrices currency={currency} rates={rates} />
          {rows.length > 0 ? (
            <CoinListClient
              rows={rows}
              currency={currency}
              rates={rates}
              locale={locale}
              watchedSet={watchedSet}
              isAuthed={isAuthed}
            />
          ) : (
            <p className="text-muted">{tl("loadingFallback")}</p>
          )}
        </section>
      </div>
    </main>
  );
}
