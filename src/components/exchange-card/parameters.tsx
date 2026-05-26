import { getTranslations } from "next-intl/server";
import type { Exchange } from "@/lib/coingecko";

export async function ExchangeCardParameters({
  exchange,
  liveCurrencies,
  livePairsCount,
}: {
  exchange: Exchange;
  liveCurrencies?: number | null;
  livePairsCount?: number | null;
}) {
  const t = await getTranslations("exchangeCard");
  const currencies = liveCurrencies ?? exchange.currencies;
  const pairs = livePairsCount ?? exchange.pairsCount;
  const rows: { label: string; value: string | null }[] = [
    { label: t("parameters.type"), value: exchange.exchangeType },
    { label: t("parameters.country"), value: exchange.country },
    { label: t("parameters.yearEstablished"), value: exchange.yearEstablished?.toString() ?? null },
    { label: t("parameters.kyc"), value: null },
    { label: t("parameters.fiats"), value: exchange.fiats.length > 0 ? exchange.fiats.join(", ") : null },
    { label: t("parameters.currencies"), value: currencies?.toString() ?? null },
    { label: t("parameters.pairs"), value: pairs?.toString() ?? null },
  ];
  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">{t("parameters.title")}</h2>
      <dl className="bg-card border border-hairline rounded-[16px] divide-y divide-hairline">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between px-4 py-3 text-[14px]">
            <dt className="text-muted">{r.label}</dt>
            <dd className="font-medium">{r.value ?? t("noData")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
