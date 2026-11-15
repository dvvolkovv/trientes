/**
 * Листалка карточки точки: порядок страниц и разбор жеста.
 *
 * Вынесено из компонента целиком ради одного свойства: на странице «Карта»
 * палец принадлежит самой карте. Если ловить горизонтальный свайп со всей
 * площади, перетаскивание карты влево перелистывало бы страницу. Правило
 * «на карте — только от края» легко потерять глазами при правке разметки,
 * поэтому оно живёт в функции, накрытой тестами, а не в обработчике событий.
 */

export type PoiPage = "map" | "card" | "showcase";

/** Жест короче — это дрожание пальца, а не листание. */
export const SWIPE_MIN_DX = 12;
/** Горизонтальным считается жест, который заметно длиннее по оси X. */
export const SWIPE_AXIS_RATIO = 1.4;
/** Доля ширины, после которой страница переворачивается. */
export const SWIPE_SNAP_SHARE = 0.25;
/** Скорость на отрыве (px/ms), при которой листает и короткий флик. */
export const SWIPE_SNAP_VELOCITY = 0.35;
/** Полоска у края страницы «Карта», с которой жест всё-таки слушается. */
export const SWIPE_EDGE_PX = 24;
/** Сопротивление за крайней страницей: палец идёт, лист почти не едет. */
const EDGE_RESISTANCE = 0.3;

/**
 * На десктопе карточка — панель внутри окна карты, карта и так видна рядом,
 * поэтому прозрачная страница поверх панели там не покупает ничего.
 */
export function pagesFor(phone: boolean): PoiPage[] {
  return phone ? ["map", "card", "showcase"] : ["card", "showcase"];
}

/** Страница, которая открывается по нажатию на точку: вопрос «что это за место». */
export const DEFAULT_POI_PAGE: PoiPage = "card";

const LABEL: Record<PoiPage, string> = {
  map: "pageMap",
  card: "pageCard",
  showcase: "pageShowcase",
};

/** Ключ подписи в пространстве `cryptoMap`. */
export function pageLabelKey(page: PoiPage): string {
  return LABEL[page];
}

export function claimsSwipe(i: { page: PoiPage; dx: number; dy: number; fromEdge: boolean }): boolean {
  if (Math.abs(i.dx) <= SWIPE_MIN_DX) return false;
  if (Math.abs(i.dx) <= Math.abs(i.dy) * SWIPE_AXIS_RATIO) return false;
  if (i.page === "map" && !i.fromEdge) return false;
  return true;
}

export function settlePage(i: {
  pages: PoiPage[];
  page: PoiPage;
  dx: number;
  width: number;
  velocity: number;
}): PoiPage {
  const index = i.pages.indexOf(i.page);
  if (index < 0) return i.page;
  const far = Math.abs(i.dx) > i.width * SWIPE_SNAP_SHARE;
  const fast = Math.abs(i.velocity) > SWIPE_SNAP_VELOCITY;
  if (!far && !fast) return i.page;
  // Палец влево — следующая страница приходит справа.
  const step = i.dx < 0 ? 1 : -1;
  const next = Math.min(i.pages.length - 1, Math.max(0, index + step));
  return i.pages[next];
}

/** Смещение дорожки страниц в пикселях, пока палец на экране. */
export function dragOffset(i: { pages: PoiPage[]; page: PoiPage; dx: number; width: number }): number {
  const index = Math.max(0, i.pages.indexOf(i.page));
  const atFirst = index === 0 && i.dx > 0;
  const atLast = index === i.pages.length - 1 && i.dx < 0;
  const dx = atFirst || atLast ? i.dx * EDGE_RESISTANCE : i.dx;
  return -index * i.width + dx;
}
