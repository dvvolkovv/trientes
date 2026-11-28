"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { CARD_HEADING, CARD_PANEL } from "@/lib/company-card-ui";
import type { ShowcaseOffer } from "@/lib/products/offers-read";

/**
 * Витрина товаров и услуг (слайс BC, вид — BY). Одна на две поверхности: страницу
 * предприятия и страницу «Витрина» в навигаторе.
 *
 * Решение владельца: витрина — это **только** товары. Адрес, телефон и часы с неё
 * ушли: они стоят в самой карточке, и одна вещь в двух местах расходится.
 *
 * Кнопка «купить» ведёт на паспорт товара: оплаты в проекте нет, а обещать её нельзя
 * (правило BD) — место под неё держим, слова честные.
 */
export function CardOffers({
  offers,
  locale,
  bare = false,
}: {
  offers: ShowcaseOffer[];
  locale: string;
  /** В навигаторе раздел уже назван закладкой — второй заголовок был бы повтором. */
  bare?: boolean;
}) {
  const t = useTranslations("products.showcase");
  const format = useFormatter();
  if (offers.length === 0) return null;

  const money = (price: number, currency: string) => {
    try {
      return format.number(price, { style: "currency", currency });
    } catch {
      return `${price} ${currency}`;
    }
  };

  const list = (
    <ul className="space-y-2.5">
      {offers.map((r) => (
        <li key={r.productId} className="overflow-hidden rounded-[16px] border border-hairline bg-card">
          <Link href={`/${locale}/product/${r.slug}`} className="flex gap-3 p-3">
            <div className="flex h-[84px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-card-alt">
              {r.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.photoUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl opacity-40" aria-hidden>📦</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-[14.5px] font-semibold">{r.name}</div>
              {r.brand ? <div className="truncate text-[11.5px] text-muted">{r.brand}</div> : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="num text-[15px] font-bold">{money(r.price, r.currency)}</span>
                <span className="text-[11.5px] text-muted">/ {r.unit}</span>
                {r.cashbackPercent !== null ? (
                  <span className="num rounded-full border border-[#30B658]/35 bg-[#30B658]/12 px-2 py-0.5 text-[10.5px] font-semibold text-[#30B658]">
                    {t("cashback", { percent: r.cashbackPercent })}
                  </span>
                ) : null}
              </div>
              {r.inStock === null ? null : (
                <div className="mt-1 text-[11.5px] text-muted">{r.inStock ? t("inStock") : t("outOfStock")}</div>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );

  if (bare) return <div className="space-y-3">{list}</div>;
  return (
    <section id="products" className={CARD_PANEL}>
      <h2 className={CARD_HEADING}>{t("heading")}</h2>
      {list}
    </section>
  );
}
