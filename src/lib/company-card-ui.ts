/**
 * Вид карточки предприятия, как её видит покупатель, — в одном месте.
 *
 * Просьба владельца 22.11 (после BX): «открывается полноценная карточка,
 * отцентрованная, всё красиво, на хорошем фоне», и из неё человек должен уметь
 * перейти в витрину, написать и позвонить. Прежде страница была набором секций с
 * тремя разными видами заголовков (`text-[20px] font-semibold`,
 * `text-xs uppercase tracking-[0.2em]`, без заголовка вовсе) и двумя видами
 * кнопок — отсюда «очень плохо организована».
 *
 * Правило проекта: своей копии правил вида не заводим (уборка AU — список локалей
 * однажды отстал именно так). Кнопки берутся из `admin-ui.ts`, а здесь только то,
 * чего там нет: полотно карточки и один заголовок раздела на всю страницу. Эти
 * же строки читают блоки витрины (`offers-block`, `promos-block`, `loyalty-line`),
 * иначе разделы одной карточки разошлись бы видом.
 */

/** Полотно раздела карточки. Скругление 22 px — то же, что у плиток кабинета. */
export const CARD_PANEL = "rounded-[22px] border border-hairline bg-card p-5";

/** Один заголовок раздела на всю карточку. */
export const CARD_HEADING = "mb-3 text-[11px] uppercase tracking-[0.18em] text-muted";

/**
 * Действие в карточке — кнопка во всю ширину ячейки, высотой 48 px (порог пальца,
 * правило AN), а не подчёркнутое слово. Заливка `card-alt`: кнопка стоит на
 * полотне `card`, и без своей заливки она читалась бы просто рамкой.
 */
export const CARD_ACTION =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-hairline bg-card-alt px-3 text-[13px] font-semibold text-foreground transition-colors hover:border-accent/60";

/** Главное действие карточки — переписка с магазином. */
export const CARD_ACTION_PRIMARY =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-accent px-3 text-[13px] font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40";

/** Нажатое состояние действия-переключателя («вы следите»). */
export const CARD_ACTION_ON =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-accent bg-accent/10 px-3 text-[13px] font-semibold text-foreground transition-colors disabled:opacity-40";
