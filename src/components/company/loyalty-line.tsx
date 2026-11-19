import { getTranslations } from "next-intl/server";
import { readCashbackSummary } from "@/lib/loyalty/read";

/**
 * Строка лояльности на карточке магазина: что продавец обещает вообще. Ставки сами по
 * себе нигде, кроме этой строки, не показываются — обещание кэшбэка на товар, которого
 * продавец не продаёт, это реклама без товара.
 *
 * Нет ни одной ставки — строки нет: пустое обещание хуже отсутствия обещания.
 */
export async function CompanyLoyaltyLine({ companyId }: { companyId: string }) {
  const [t, summary] = await Promise.all([getTranslations("loyalty"), readCashbackSummary(companyId)]);
  if (!summary) return null;
  const { base, max } = summary;

  return (
    <section className="mt-10">
      <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("heading")}</h2>
      <p className="text-sm">
        {base !== null && max !== null
          ? t("rateBoth", { base, max })
          : base !== null
            ? t("rateBase", { base })
            : t("rateMax", { max: max as number })}
      </p>
      <p className="text-[11px] text-muted mt-1">{t("accrualNote")}</p>
    </section>
  );
}
