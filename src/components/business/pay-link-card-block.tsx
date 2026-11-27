import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CARD_ACTION, CARD_HEADING, CARD_PANEL } from "@/lib/company-card-ui";
import { payCabinetHref } from "@/lib/pay-link/parse";

/**
 * Приём платежей на самой карточке предприятия в кабинете (слайс CP, § 1).
 *
 * Владелец без подключения видит здесь кнопку «Подключить приём платежей» — она ведёт
 * **прямо в кабинет оплаты**, как просит задание: магазин он заводит там сам, нас в
 * этом шаге нет. Под ней тихая строка для того, кто магазин уже завёл и пришёл
 * вставить ссылку.
 *
 * Гостю и сотруднику этот блок не показывается вовсе: страница вызывает его только у
 * владельца (решение BE — право, которым меняется получатель денег, ролями не
 * настраивается).
 */
export async function PayLinkCardBlock({
  locale,
  companyId,
  linked,
}: {
  locale: string;
  companyId: string;
  /** Что уже стоит в карточке; `null` — подключения нет. */
  linked: { merchantName: string; hidden: boolean } | null;
}) {
  const t = await getTranslations("payLink");
  const page = `/${locale}/cabinet/companies/${companyId}/payments`;

  if (linked) {
    return (
      <section className={CARD_PANEL}>
        <h2 className={CARD_HEADING}>{t("title")}</h2>
        <p className="text-[13px] leading-snug">
          {linked.hidden ? t("cardBlockHidden", { merchant: linked.merchantName }) : t("cardBlockOn", { merchant: linked.merchantName })}
        </p>
        <Link href={page} className={`${CARD_ACTION} mt-3`}>
          <span aria-hidden>💳</span>
          {t("cardBlockManage")}
        </Link>
      </section>
    );
  }

  return (
    <section className={CARD_PANEL}>
      <h2 className={CARD_HEADING}>{t("title")}</h2>
      <p className="text-[13px] leading-snug text-muted">{t("cardBlockOffer")}</p>
      <a
        href={payCabinetHref(locale)}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="pay-connect"
        className={`${CARD_ACTION} mt-3 border-accent text-accent`}
      >
        <span aria-hidden>💳</span>
        {t("connect")}
      </a>
      <p className="mt-2 text-[12.5px] text-muted">
        <Link href={page} className="underline">
          {t("cardBlockHaveLink")}
        </Link>
      </p>
    </section>
  );
}
