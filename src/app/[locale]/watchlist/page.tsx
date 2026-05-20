import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { readTop100, readExchangeRates } from "@/lib/snapshot";
import { getCurrency } from "@/lib/get-currency";
import { readUserWatchedIds, isAuthenticated } from "@/lib/watchlist";
import { CoinListClient } from "@/components/coin-list-client";

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

  const [allRows, rates, currency, watchedSet] = await Promise.all([
    readTop100(),
    readExchangeRates(),
    getCurrency(),
    readUserWatchedIds(),
  ]);
  const rows = allRows.filter((r) => watchedSet.has(r.id));

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </header>
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
        <div className="border rounded-lg p-12 text-center">
          <p className="text-muted-foreground mb-3">{t("empty")}</p>
          <Link href={`/${locale}`} className="text-primary hover:underline">
            {t("browse")}
          </Link>
        </div>
      )}
    </main>
  );
}
