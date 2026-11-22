import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { readStorefrontPromos } from "@/lib/promos/read";
import { CARD_HEADING, CARD_PANEL } from "@/lib/company-card-ui";

/**
 * Акции магазина на витрине. Текст идёт как написан продавцом — это его утверждение, и
 * машинный перевод скидки не лучше машинного перевода состава продукта (решение BB).
 *
 * Ни одной идущей акции — раздела нет: пустой раздел «Акции» читается как «акций не
 * бывает», а это не то же, что «сейчас нет».
 */
export async function CompanyPromosBlock({ companyId, locale }: { companyId: string; locale: string }) {
  const [t, format, promos] = await Promise.all([
    getTranslations("promos"),
    getFormatter(),
    readStorefrontPromos(companyId),
  ]);
  if (promos.length === 0) return null;

  return (
    <section className={CARD_PANEL}>
      <h2 className={CARD_HEADING}>{t("storefrontTitle")}</h2>
      <ul className="space-y-2">
        {promos.map((p) => (
          <li key={p.id} className="rounded-[14px] border border-hairline bg-bg-tint px-3 py-2.5">
            <div className="font-medium">{p.title}</div>
            <p className="text-sm whitespace-pre-wrap mt-0.5">{p.body}</p>
            <div className="text-[11px] text-muted mt-1 flex flex-wrap gap-x-3">
              <span>{t("until", { date: format.dateTime(p.endsAt, { day: "numeric", month: "short" }) })}</span>
              {p.productSlug ? (
                <Link href={`/${locale}/product/${p.productSlug}`} className="text-accent underline">
                  {p.productName ?? t("product")} →
                </Link>
              ) : null}
              {p.pointId ? (
                <Link href={`/${locale}/crypto-map?point=${p.pointId}`} className="text-accent underline">
                  {p.pointCity ? t("atPlaceIn", { city: p.pointCity }) : t("atPlace")} →
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
