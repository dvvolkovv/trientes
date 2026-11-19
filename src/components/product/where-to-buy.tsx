import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { readProductOffers } from "@/lib/products/offers-read";
import { countryName } from "@/lib/countries";

/**
 * «Где взять»: продавцы, их цена, ставка кэшбэка и места, где товар лежит на полке.
 *
 * Два решения видно глазом. Цена стоит **в валюте продавца** и не пересчитывается в
 * валюту сайта: пересчёт обещал бы платёж по нашему курсу, а платёж пойдёт через
 * эквайринг (прецедент — пожертвования, слайс AV). И остаток показывается **наличием**,
 * а не числом: точный остаток — коммерческая тайна продавца и к тому же заявление,
 * которого мы не проверяли.
 *
 * Ноль — это ноль: раздел не скрывается, а честно говорит «пока никто не продаёт».
 */
export async function WhereToBuy({
  productId,
  slug,
  locale,
}: {
  productId: string;
  slug: string;
  locale: string;
}) {
  const [t, format, data] = await Promise.all([
    getTranslations("products.whereToBuy"),
    getFormatter(),
    readProductOffers(productId),
  ]);

  const money = (price: number, currency: string) => {
    try {
      return format.number(price, { style: "currency", currency });
    } catch {
      // Валюта из белого списка, но форматтер — чужой код: цифры важнее оформления.
      return `${price} ${currency}`;
    }
  };

  return (
    <section id="where-to-buy" className="mt-10 scroll-mt-24">
      <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("heading")}</h2>

      {data.offers.length === 0 ? (
        <p className="text-sm text-muted border border-hairline rounded-lg p-4">{t("empty")}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {data.offers.map((o) => (
              <li key={o.offerId} className="border border-hairline rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-hairline/30 overflow-hidden shrink-0 flex items-center justify-center">
                    {o.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={o.logoUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="opacity-40 text-[12px]">🏬</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/${locale}/companies/${o.companyId}`} className="text-sm font-medium hover:text-accent">
                      {o.companyName}
                    </Link>
                    <div className="text-[13px] mt-0.5">
                      <span className="num font-medium">{money(o.price, o.currency)}</span>
                      <span className="text-muted"> / {t(`units.${o.unit}`)}</span>
                      {o.cashbackPercent !== null ? (
                        <span className="text-accent num"> · {t("cashback", { percent: o.cashbackPercent })}</span>
                      ) : null}
                    </div>
                    <div className="text-[12px] text-muted mt-0.5">
                      {o.inStock ? t("inStock") : t("outOfStock")}
                    </div>
                    {o.saleRules ? <p className="text-[12px] text-muted mt-1 whitespace-pre-line">{o.saleRules}</p> : null}
                  </div>
                  {o.onlineUrl ? (
                    <a
                      href={o.onlineUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="h-12 px-4 rounded-md border border-hairline text-sm flex items-center shrink-0 hover:border-accent"
                    >
                      {t("toShop")}
                    </a>
                  ) : null}
                </div>

                {o.places.length > 0 ? (
                  <ul className="mt-3 pt-3 border-t border-hairline flex flex-col gap-1 text-[12px]">
                    {o.places.map((p, i) => (
                      <li key={`${o.offerId}-${p.pointId ?? i}`} className="flex items-center gap-2">
                        <span className="truncate">
                          {p.name}
                          {p.city ? `, ${p.city}` : ""}
                          {p.countryCode ? ` · ${countryName(p.countryCode) ?? p.countryCode}` : ""}
                        </span>
                        {p.pointId && p.lat !== null && p.lon !== null ? (
                          <Link
                            href={`/${locale}/crypto-map?product=${encodeURIComponent(slug)}&point=${p.pointId}`}
                            className="text-accent shrink-0"
                          >
                            {t("whereExactly")}
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>

          {/* Карта открывается прямоугольником полок с товаром — а не там, где стоит
              нажавший: единственный магазин может оказаться в другой стране. */}
          {data.area ? (
            <Link
              href={`/${locale}/crypto-map?product=${encodeURIComponent(slug)}`}
              className="inline-flex items-center h-12 px-4 mt-4 rounded-md border border-hairline text-sm hover:border-accent"
            >
              {t("openMap")}
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}
