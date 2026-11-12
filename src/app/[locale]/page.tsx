import { setRequestLocale, getTranslations } from "next-intl/server";
import { readTop100, readGlobalStats, readExchangeRates, readNews, readFearGreed } from "@/lib/snapshot";
import { GlobalStatsHero } from "@/components/global-stats-hero";
import { CoinListClient } from "@/components/coin-list-client";
import { SelfListedRail } from "@/components/self-listed-rail";
import { ListingTabs } from "@/components/listing-tabs";
import { countSelfListedCards } from "@/lib/coin-card-directory";
import { NewsRail } from "@/components/news-rail";
import { LivePrices } from "@/components/live-prices";
import { HomeTicker, type TickerItem } from "@/components/home-ticker";
import { MarketMoodAnimal } from "@/components/market-mood-animal";
import { getCurrency } from "@/lib/get-currency";
import { readUserWatchedIds, isAuthenticated } from "@/lib/watchlist";
import { formatCompactInCurrency, formatPriceInCurrency } from "@/lib/currency";
import { computeMarketMood } from "@/lib/market-mood";

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

  const [rows, stats, rates, currency, watchedSet, isAuthed, news, fearGreed, selfListedCount] =
    await Promise.all([
    readTop100(),
    readGlobalStats(),
    readExchangeRates(),
    getCurrency(),
    readUserWatchedIds(),
    isAuthenticated(),
    readNews(),
    readFearGreed(),
    countSelfListedCards(),
  ]);

  const tlist = await getTranslations("listing");

  // Bull while the cap-weighted Layer-1 trend is up, bear while it is down.
  const mood = computeMarketMood(rows, fearGreed);

  // ----- Build ticker items: interleave phrases (white) and live stats (orange).
  const phrasesRaw = th.raw("ticker.phrases");
  const phrases: string[] = Array.isArray(phrasesRaw)
    ? (phrasesRaw as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  // Groups keep related items side by side: everything inside one group runs
  // without a phrase between the entries.
  const statGroups: TickerItem[][] = [];
  const btc = rows.find((r) => r.id === "bitcoin") ?? rows.find((r) => r.symbol === "BTC");
  if (stats && rates) {
    statGroups.push([
      {
        kind: "stat",
        label: tlist("globalMarketCap"),
        value: formatCompactInCurrency(stats.totalMarketCapUsd, currency, rates),
        href: `/${locale}/markets`,
      },
    ]);
  }
  // BTC with its 7-day chart, followed immediately by the aggregate 24h
  // turnover of all crypto across all exchanges.
  const btcGroup: TickerItem[] = [];
  if (btc && rates) {
    // The 7-day series has ~168 hourly points; thinned down it reads as a
    // line instead of noise at the ticker's 132px width.
    const raw = btc.sparkline7d;
    const step = raw && raw.length > 56 ? Math.ceil(raw.length / 56) : 1;
    const points = raw ? raw.filter((_, i) => i % step === 0 || i === raw.length - 1) : null;
    btcGroup.push({
      kind: "chart",
      label: btc.symbol,
      value: formatPriceInCurrency(btc.priceUsd, currency, rates),
      points,
      href: `/${locale}/coin/${btc.id}`,
      ariaLabel: `${btc.name} ${formatPriceInCurrency(btc.priceUsd, currency, rates)}`,
    });
  }
  // Zero means CoinGecko's /global briefly lost the number — skip the entry
  // rather than advertise a $0.00 market.
  if (stats && rates && stats.total24hVolumeUsd > 0) {
    btcGroup.push({
      kind: "stat",
      label: tlist("globalVolume"),
      value: formatCompactInCurrency(stats.total24hVolumeUsd, currency, rates),
      href: `/${locale}/markets`,
    });
  }
  if (btcGroup.length > 0) statGroups.push(btcGroup);
  if (stats && rates) {
    statGroups.push([
      {
        kind: "stat",
        label: tlist("btcDominance"),
        value: `${stats.btcDominancePct.toFixed(1)}%`,
        href: `/${locale}/markets`,
      },
    ]);
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
    statGroups.push([
      {
        kind: "stat",
        label: tlist("fearGreed"),
        value: `${fearGreed.value} · ${fngLabel}`,
        href: `/${locale}/markets`,
      },
    ]);
  }

  // Interleave: phrase, stat group, phrase, stat group, ... — phrases cycle if
  // shorter than the number of groups.
  const tickerItems: TickerItem[] = [];
  const maxLen = Math.max(phrases.length, statGroups.length);
  for (let i = 0; i < maxLen; i++) {
    if (phrases.length > 0) {
      tickerItems.push({ kind: "phrase", text: phrases[i % phrases.length] });
    }
    if (statGroups[i]) tickerItems.push(...statGroups[i]);
  }

  return (
    <main className="bg-bg">
      {/* TICKER BANNER — full-bleed strip directly beneath the header */}
      <HomeTicker items={tickerItems} ariaLabel={th("ticker.ariaLabel")} />

      <div className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20">
        {/* HERO */}
        <section className="py-12 md:py-20">
          <div className="grid grid-cols-12 gap-8 items-center">
            <div className="col-span-12 lg:col-span-8">
              <MarketMoodAnimal mood={mood} label={th(`mood.${mood}`)} />
            </div>
            <div className="col-span-12 lg:col-span-4">
              <GlobalStatsHero stats={stats} currency={currency} rates={rates} fearGreed={fearGreed} />
            </div>
          </div>
        </section>

        {/* NEWSFLOW BANNER */}
        {news.length > 0 && (
          <section className="pb-12">
            <div className="flex items-baseline justify-between mb-5">
              <div className="num text-[11px] uppercase tracking-[0.3em] text-accent inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent" aria-hidden />
                Newsflow
              </div>
              <span className="hidden sm:inline text-muted text-[12px] font-light">
                {th("newsflowHint")}
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
          <ListingTabs
            marketLabel={tl("tabs.all")}
            selfLabel={tl("tabs.selfListed")}
            selfCount={selfListedCount}
            market={
              rows.length > 0 ? (
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
              )
            }
            self={<SelfListedRail locale={locale} currency={currency} rates={rates} />}
          />
        </section>
      </div>
    </main>
  );
}
