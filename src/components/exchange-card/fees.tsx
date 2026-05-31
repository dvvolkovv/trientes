import { getTranslations } from "next-intl/server";

export async function ExchangeCardFees({
  makerFeePercent,
  takerFeePercent,
  feesNote,
  feesUrl,
}: {
  makerFeePercent: number | null;
  takerFeePercent: number | null;
  feesNote: string | null;
  feesUrl: string | null;
}) {
  const t = await getTranslations("exchangeCard");
  if (makerFeePercent == null && takerFeePercent == null) return null;
  const fmt = (n: number | null) => (n == null ? "—" : `${n.toFixed(n < 0.1 ? 3 : 2)}%`);
  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">{t("fees.title")}</h2>
      <div className="bg-card border border-hairline rounded-[16px] divide-y divide-hairline">
        <div className="flex justify-between px-4 py-3 text-[14px]">
          <dt className="text-muted">{t("fees.maker")}</dt>
          <dd className="font-medium num">{fmt(makerFeePercent)}</dd>
        </div>
        <div className="flex justify-between px-4 py-3 text-[14px]">
          <dt className="text-muted">{t("fees.taker")}</dt>
          <dd className="font-medium num">{fmt(takerFeePercent)}</dd>
        </div>
        {feesNote ? (
          <div className="px-4 py-3 text-[12px] text-muted">{feesNote}</div>
        ) : null}
        {feesUrl ? (
          <div className="px-4 py-3 text-[12px]">
            <a href={feesUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
              {t("fees.officialSchedule")} →
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
