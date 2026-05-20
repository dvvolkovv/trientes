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
    <main className="bg-bg">
      <div className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-12">
        <header className="mb-10">
          <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
            Section · II
          </div>
          <h1 className="text-[40px] md:text-[56px] font-bold tracking-[-0.035em]">
            {t("title")}
          </h1>
          <p className="text-muted mt-4 text-[16px] md:text-[18px] leading-[1.5] max-w-[640px]">
            {t("subtitle")}
          </p>
        </header>
        {rows.length > 0 ? (
          <ExchangesTable rows={rows} currency={currency} rates={rates} />
        ) : (
          <p className="text-muted">{t("empty")}</p>
        )}
      </div>
    </main>
  );
}
