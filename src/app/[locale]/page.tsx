import Image from "next/image";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { readTop100, readGlobalStats, readExchangeRates, readNews, readFearGreed } from "@/lib/snapshot";
import { GlobalStatsHero } from "@/components/global-stats-hero";
import { CoinListClient } from "@/components/coin-list-client";
import { NewsRail } from "@/components/news-rail";
import { LivePrices } from "@/components/live-prices";
import { HomeTicker, type TickerItem } from "@/components/home-ticker";
import { getCurrency } from "@/lib/get-currency";
import { readUserWatchedIds, isAuthenticated } from "@/lib/watchlist";
import { formatCompactInCurrency } from "@/lib/currency";

export const revalidate = 60;

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tl = await getTranslations("listing");
  const th = await getTranslations("home");

  const [rows, stats, rates, currency, watchedSet, isAuthed, news, fearGreed] = await Promise.all([
    readTop100(),
    readGlobalStats(),
    readExchangeRates(),
    getCurrency(),
    readUserWatchedIds(),
    isAuthenticated(),
    readNews(),
    readFearGreed(),
  ]);

  const tlist = await getTranslations("listing");

  // ----- Build ticker items: interleave phrases (white) and live stats (orange).
  const phrasesRaw = th.raw("ticker.phrases");
  const phrases: string[] = Array.isArray(phrasesRaw)
    ? (phrasesRaw as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const statItems: TickerItem[] = [];
  if (stats && rates) {
    statItems.push({
      kind: "stat",
      label: tlist("globalMarketCap"),
      value: formatCompactInCurrency(stats.totalMarketCapUsd, currency, rates),
      href: `/${locale}/markets`,
    });
    statItems.push({
      kind: "stat",
      label: tlist("globalVolume"),
      value: formatCompactInCurrency(stats.total24hVolumeUsd, currency, rates),
      href: `/${locale}/markets`,
    });
    statItems.push({
      kind: "stat",
      label: tlist("btcDominance"),
      value: `${stats.btcDominancePct.toFixed(1)}%`,
      href: `/${locale}/markets`,
    });
  }
  if (fearGreed) {
    const fngKey =
      {
        "extreme fear": "fng.extremeFear",
        fear: "fng.fear",
        neutral: "fng.neutral",
        greed: "fng.greed",
        "extreme greed": "fng.extremeGreed",
      }[fearGreed.classification.toLowerCase()] ?? null;
    const fngLabel = fngKey ? tlist(fngKey) : fearGreed.classification;
    statItems.push({
      kind: "stat",
      label: tlist("fearGreed"),
      value: `${fearGreed.value} · ${fngLabel}`,
      href: `/${locale}/markets`,
    });
  }

  // Interleave: phrase, stat, phrase, stat, ... — phrases cycle if shorter.
  const tickerItems: TickerItem[] = [];
  const maxLen = Math.max(phrases.length, statItems.length);
  for (let i = 0; i < maxLen; i++) {
    if (phrases.length > 0) {
      tickerItems.push({ kind: "phrase", text: phrases[i % phrases.length] });
    }
    if (statItems[i]) tickerItems.push(statItems[i]);
  }

  return (
    <main className="bg-bg">
      <div className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20">
        {/* HERO */}
        <section className="py-12 md:py-28">
          <div className="grid grid-cols-12 gap-8 items-center">
            <div className="col-span-12 lg:col-span-8 flex justify-center lg:justify-start">
              <Image
                src="/tr_logo.png"
                alt="Trientes"
                width={152}
                height={152}
                priority
                className="w-[200px] sm:w-[280px] md:w-[360px] lg:w-[440px] h-auto select-none"
              />
            </div>
            <div className="col-span-12 lg:col-span-4">
              <GlobalStatsHero stats={stats} currency={currency} rates={rates} fearGreed={fearGreed} />
            </div>
          </div>
        </section>

        {/* TICKER BANNER */}
        <HomeTicker items={tickerItems} ariaLabel={th("ticker.ariaLabel")} />

        {/* NEWSFLOW BANNER */}
        {news.length > 0 && (
          <section className="pb-12">
            <div className="flex items-baseline justify-between mb-5">
              <div className="num text-[11px] uppercase tracking-[0.3em] text-accent inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent" aria-hidden />
                Newsflow
              </div>
              <span className="hidden sm:inline text-muted text-[12px] font-light">
                Latest crypto headlines · refreshed every 30 min
              </span>
            </div>
            <NewsRail items={news} locale={locale} />
          </section>
        )}

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
