import { CARD_ACTION } from "@/lib/company-card-ui";

/**
 * «Оплатить» в карточке магазина (слайс CP) — обычная ссылка без скрипта.
 *
 * Адрес приходит уже собранным из постоянного шаблона (`payHref`), а не из того, что
 * вставил владелец: введённая строка в `href` не попадает никогда. Сумму, выбор суммы
 * и монету покажет сама страница оплаты — она же пишет, что Trientes магазины не
 * проверяет, и повторять это за неё в карточке мы не станем.
 *
 * Один компонент на обе поверхности — витрину и карточку точки в навигаторе: вторая
 * сборка одной и той же кнопки разошлась бы (болезнь, которую поймал живой прогон BX).
 */
export function PayButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="pay-button"
      className={`${CARD_ACTION} border-accent text-accent`}
    >
      <span aria-hidden>💳</span>
      {label}
    </a>
  );
}
