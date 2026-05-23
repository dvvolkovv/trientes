import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { readTop100, readExchanges, readExchangeRates } from "@/lib/snapshot";
import { getCurrency } from "@/lib/get-currency";
import { readUserWatchedIds, readUserWatchedExchangeIds, isAuthenticated } from "@/lib/watchlist";
import { CoinListClient } from "@/components/coin-list-client";
import { ExchangesTable } from "@/components/exchanges-table";

export const dynamic = "force-dynamic";

export default async function WatchlistPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const isAuthed = await isAuthenticated();
  if (!isAuthed) redirect(`/${locale}/login`);

  const t = await getTranslations("watchlist");

  const [allRows, allExchanges, rates, currency, watchedSet, watchedExSet] = await Promise.all([
    readTop100(),
    readExchanges(),
    readExchangeRates(),
    getCurrency(),
    readUserWatchedIds(),
    readUserWatchedExchangeIds(),
  ]);
  const rows = allRows.filter((r) => watchedSet.has(r.id));
  const exchanges = allExchanges.filter((e) => watchedExSet.has(e.id));

  return (
    <main className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-10 md:py-16">
      <header className="mb-10">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
          Section · Watchlist
        </div>
        <h1 className="text-[28px] sm:text-[36px] md:text-[48px] font-bold tracking-[-0.035em]">
          {t("title")}
        </h1>
        <p className="text-muted mt-3 max-w-[640px]">{t("subtitle")}</p>
      </header>

      {/* Favorite coins */}
      {rows.length > 0 ? (
        <CoinListClient
          rows={rows}
          currency={currency}
          rates={rates}
          locale={locale}
          watchedSet={watchedSet}
          isAuthed={true}
        />
      ) : (
        <div className="bg-card border border-hairline rounded-[20px] p-12 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-10 w-10 mx-auto mb-4 text-muted"
            aria-hidden="true"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <p className="text-muted mb-4">{t("empty")}</p>
          <Link
            href={`/${locale}`}
            className="text-accent hover:text-accent/80 transition-colors text-sm font-medium uppercase tracking-wider"
          >
            {t("browse")}
          </Link>
        </div>
      )}

      {/* Favorite exchanges */}
      <h2 className="text-[20px] md:text-[26px] font-bold tracking-[-0.02em] mt-14 mb-5">
        {t("exchangesTitle")}
      </h2>
      {exchanges.length > 0 ? (
        <ExchangesTable
          rows={exchanges}
          currency={currency}
          rates={rates}
          watchedIds={[...watchedExSet]}
          isAuthed={true}
          locale={locale}
          collapsible={false}
        />
      ) : (
        <div className="bg-card border border-hairline rounded-[20px] p-10 text-center">
          <p className="text-muted mb-4">{t("exchangesEmpty")}</p>
          <Link
            href={`/${locale}/exchanges`}
            className="text-accent hover:text-accent/80 transition-colors text-sm font-medium uppercase tracking-wider"
          >
            {t("browseExchanges")}
          </Link>
        </div>
      )}
    </main>
  );
}
