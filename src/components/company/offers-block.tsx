import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { readCompanyOffers } from "@/lib/products/offers-read";

/**
 * Витрина товаров предприятия — «витрина товаров и услуг» из ТЗ 3.1. Отдельной страницы
 * магазина не заводим: у предприятия уже есть адрес, и второй магазин был бы второй
 * правдой о нём.
 *
 * Пусто — раздела нет вовсе: предприятию без товаров рассказывать о них нечего (в
 * отличие от «где взять» у паспорта, где ноль сам по себе ответ покупателю).
 */
export async function CompanyOffersBlock({ companyId, locale }: { companyId: string; locale: string }) {
  const [t, format, rows] = await Promise.all([
    getTranslations("products.showcase"),
    getFormatter(),
    readCompanyOffers(companyId),
  ]);
  if (rows.length === 0) return null;

  const money = (price: number, currency: string) => {
    try {
      return format.number(price, { style: "currency", currency });
    } catch {
      return `${price} ${currency}`;
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("heading")}</h2>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {rows.map((r) => (
          <li key={r.productId} className="border border-hairline rounded-lg overflow-hidden">
            <Link href={`/${locale}/product/${r.slug}`} className="block">
              <div className="aspect-square bg-hairline/30 flex items-center justify-center overflow-hidden">
                {r.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.photoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="opacity-40 text-2xl">📦</span>
                )}
              </div>
              <div className="p-2">
                <div className="text-[13px] font-medium line-clamp-2">{r.name}</div>
                {r.brand ? <div className="text-[11px] text-muted truncate">{r.brand}</div> : null}
                <div className="text-[13px] num mt-1">{money(r.price, r.currency)}</div>
                <div className="text-[11px] text-muted">
                  {r.cashbackPercent !== null ? (
                    <span className="text-accent num">{t("cashback", { percent: r.cashbackPercent })} · </span>
                  ) : null}
                  {r.inStock ? t("inStock") : t("outOfStock")}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
