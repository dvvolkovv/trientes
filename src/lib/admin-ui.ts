import type { CSSProperties } from "react";

/**
 * Правила вида админки в одном месте, а не россыпью по экранам.
 *
 * Два требования владельца (17.11): действие — всегда кнопка, а не подчёркнутое
 * слово (пальцем в слово не попасть), и содержимое идёт колонкой по центру —
 * на телефоне и на компьютере одинаково, компьютер просто шире.
 */

/** Высота 48 px — выше порога 44 px, который считается пригодным для пальца. */
export const ADMIN_BUTTON =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-accent px-4 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40";

export const ADMIN_BUTTON_SECONDARY =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-hairline bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-card-alt disabled:opacity-40";

export const ADMIN_BUTTON_DANGER =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-down/40 bg-transparent px-4 text-sm font-semibold text-down transition-colors hover:bg-down/10 disabled:opacity-40";

/** Колонка содержимого: по центру всегда, на большом экране просто шире. */
export const ADMIN_COLUMN = "mx-auto w-full max-w-[1100px] px-4 md:px-6";

/** Квадратная плитка со скруглением 22 px. */
export const ADMIN_TILE =
  "relative flex aspect-square flex-col justify-between overflow-hidden rounded-[22px] border border-hairline bg-card p-4";

/** Цвет точки срока. */
export const SLA_DOT: Record<"ok" | "warn" | "late" | "paused", string> = {
  ok: "bg-up",
  warn: "bg-[#e2a33c]",
  late: "bg-down",
  paused: "bg-muted",
};

/**
 * Кнопка полосы разделов. Высота одна у всех (44 px — порог пальца), активная
 * отличается заливкой, а не высотой: подчёркивание снизу (`-mb-px`) и делало
 * содержимое полосы выше её самой, отчего полоса получала свою вертикальную
 * прокрутку и болталась пальцем.
 */
export const ADMIN_TAB =
  "flex h-11 shrink-0 items-center rounded-full border px-4 text-[13px] font-semibold uppercase tracking-wider transition-colors";

/**
 * Полоса разделов. `overflow-y: hidden` прямо — иначе `overflow-x: auto` делает
 * вторую ось прокручиваемой само собой; `touch-action: pan-x` — чтобы жест
 * пальцем по полосе не отдавался вертикали (тот же приём, что `pan-y` на корне
 * карточки точки навигатора).
 */
export const ADMIN_TAB_STRIP =
  "flex gap-2 overflow-x-auto overflow-y-hidden px-4 py-1 [touch-action:pan-x] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden " +
  // На широком экране прокрутка вбок прячет последние кнопки (живой прогон:
  // «Analytics» и настройка вида уходили за край), а места хватает на перенос.
  // `overflow-visible` обязателен целиком: с `overflow-y: hidden` вторая ось не
  // бывает `visible`, и вторая строка кнопок была бы обрезана.
  "md:flex-wrap md:overflow-visible md:px-0 md:[touch-action:auto]";

/**
 * Вид кнопки раздела или фильтра одним правилом — его читают полоса админки,
 * ряды фильтров и образец на странице «Вид разделов». Своя копия правил вида в
 * проекте уже однажды расходилась, поэтому правило одно.
 *
 * Нажатая отличается **яркостью контура**: цвет в полную силу плюс второй контур
 * тенью (линия вдвое толще), ненажатая несёт тот же цвет вполсилы. Тенью, а не
 * `border-2`: толщина рамки меняет внутренний размер кнопки, и строка дёргалась
 * бы при переключении — ровно та болезнь, от которой полосу уже лечили.
 */
export function adminTabLook(
  hex: string | null | undefined,
  active: boolean,
): { style?: CSSProperties; className: string } {
  if (!hex) {
    return {
      className: active
        ? "border-accent bg-accent/15 text-foreground shadow-[0_0_0_1px_var(--color-accent)]"
        : "border-hairline text-muted hover:border-accent/60 hover:text-foreground",
    };
  }
  return {
    // Цвет из закрытой палитры, не из ввода человека, поэтому он идёт стилем:
    // Tailwind не умеет классов, которых нет при сборке.
    style: active
      ? { borderColor: hex, backgroundColor: `${hex}26`, boxShadow: `0 0 0 1px ${hex}` }
      : { borderColor: `${hex}8c` },
    className: active ? "text-foreground" : "text-muted hover:text-foreground",
  };
}
