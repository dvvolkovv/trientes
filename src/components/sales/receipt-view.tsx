import { useTranslations } from "next-intl";
import Link from "next/link";
import type { Receipt } from "@/lib/sales/read";

/**
 * Вид чека — один на три поверхности: касса продавца, страница по ссылке и свои чеки
 * покупателя. Вторая сборка того же чека разошлась бы с первой (живой прогон BX уже
 * поймал это на выключателях витрины).
 *
 * Серверный компонент: числа форматируются на сервере, потому что чек неизменяем и
 * никаких нажатий внутри не содержит — действия стоят снаружи.
 */
export function ReceiptView({
  receipt,
  locale,
  showCashier = false,
}: {
  receipt: Receipt;
  locale: string;
  /** Продавцу видно, кто пробил чек; покупателю это ничего не говорит. */
  showCashier?: boolean;
}) {
  const t = useTranslations("receipt");
  // Единицы измерения уже переведены для предложений продавца: третья копия того же
  // списка разошлась бы с первыми двумя (болезнь списка локалей, уборка AU).
  const unit = useTranslations("offers.units");
  const money = (value: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: receipt.currency }).format(value);
  const qty = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    receipt.createdAt,
  );

  return (
    <article className="rounded-[14px] border border-hairline bg-card p-4">
      <header className="mb-3 border-b border-hairline pb-3">
        <div className="flex items-start gap-3">
          {receipt.sellerLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={receipt.sellerLogoUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full border border-hairline object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <Link
              href={`/${locale}/companies/${receipt.sellerId}`}
              className="block truncate text-[15px] font-semibold hover:text-accent"
            >
              {receipt.sellerName}
            </Link>
            <p className="text-[12px] text-muted">
              {t("number", { number: receipt.number })} · {when}
            </p>
            {receipt.pointName ? <p className="text-[12px] text-muted">{receipt.pointName}</p> : null}
          </div>
        </div>
        {receipt.status === "CANCELLED" ? (
          <p className="mt-3 rounded-[10px] border border-hairline bg-background px-3 py-2 text-[12.5px] font-semibold text-danger">
            {t("cancelled")}
            {receipt.cancelReason ? <span className="font-normal text-muted"> · {receipt.cancelReason}</span> : null}
          </p>
        ) : null}
      </header>

      <ul className="flex flex-col gap-2">
        {receipt.lines.map((line, i) => {
          const sum = Math.round(line.price * line.qty * 100) / 100;
          const listSum = Math.round(line.listPrice * line.qty * 100) / 100;
          return (
            <li key={i} className="flex items-start gap-3 text-[13px]">
              <div className="min-w-0 flex-1">
                {line.productSlug ? (
                  <Link href={`/${locale}/product/${line.productSlug}`} className="block truncate hover:text-accent">
                    {line.name}
                  </Link>
                ) : (
                  <span className="block truncate">{line.name}</span>
                )}
                <span className="block text-[11.5px] text-muted num">
                  {qty(line.qty)} {unit(line.unit)} × {money(line.price)}
                  {line.price < line.listPrice ? (
                    <span className="text-muted"> · {t("wasPrice", { price: money(line.listPrice) })}</span>
                  ) : null}
                </span>
              </div>
              <div className="shrink-0 text-right">
                <span className="block num">{money(sum)}</span>
                {listSum > sum ? (
                  <span className="block text-[11px] text-muted num line-through">{money(listSum)}</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <dl className="mt-3 space-y-1 border-t border-hairline pt-3 text-[13px]">
        {receipt.discount > 0 ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t("discount")}</dt>
            <dd className="num">−{money(receipt.discount)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 text-[15px] font-semibold">
          <dt>{t("total")}</dt>
          <dd className="num">{money(receipt.total)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">{t("payment")}</dt>
          <dd>{t(`paymentKind.${receipt.payment}`)}</dd>
        </div>
        {receipt.payCoin ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t("inCoin")}</dt>
            <dd className="num">
              {receipt.payCoinAmount !== null ? `${receipt.payCoinAmount} ${receipt.payCoin}` : receipt.payCoin}
              {receipt.payRate !== null ? ` · ${t("rate", { rate: money(receipt.payRate) })}` : ""}
            </dd>
          </div>
        ) : null}
      </dl>

      {receipt.payCoin ? <p className="mt-2 text-[11.5px] leading-snug text-muted">{t("coinStated")}</p> : null}

      {receipt.cashbackTotal > 0 ? (
        <p className="mt-3 rounded-[10px] border border-hairline bg-background px-3 py-2 text-[12.5px] leading-snug">
          <span className="font-semibold num">{t("cashback", { amount: money(receipt.cashbackTotal) })}</span>
          <span className="block text-muted">{t("cashbackPending")}</span>
        </p>
      ) : null}

      {receipt.payNote ? <p className="mt-2 text-[12px] text-muted">{receipt.payNote}</p> : null}
      {receipt.note ? <p className="mt-1 text-[12px] text-muted">{receipt.note}</p> : null}

      <p className="mt-3 text-[11.5px] leading-snug text-muted">{t("outsidePlatform")}</p>
      {showCashier && receipt.cashierName ? (
        <p className="mt-1 text-[11.5px] text-muted">{t("cashier", { name: receipt.cashierName })}</p>
      ) : null}
    </article>
  );
}
