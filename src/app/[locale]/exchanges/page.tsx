import { setRequestLocale, getTranslations } from "next-intl/server";
import { readExchanges, readExchangeRates } from "@/lib/snapshot";
import { getCurrency } from "@/lib/get-currency";
import { ExchangesTable } from "@/components/exchanges-table";

export const revalidate = 600;

export default async function ExchangesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("exchanges");

  const [rows, rates, currency] = await Promise.all([
    readExchanges(),
    readExchangeRates(),
    getCurrency(),
  ]);

  return (
    <main className="container mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </header>
      {rows.length > 0 ? (
        <ExchangesTable rows={rows} currency={currency} rates={rates} />
      ) : (
        <p className="text-muted-foreground">{t("empty")}</p>
      )}
    </main>
  );
}
