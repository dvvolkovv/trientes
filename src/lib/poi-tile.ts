/**
 * Плитка карточки точки: пропорция, жест раскрытия и перевод рамки плитки в
 * язык MapLibre.
 *
 * Вынесено из компонентов по той же причине, что и логика листалки: пропорция
 * банковской карты нужна в двух местах (снимок места и окно карты), а правило
 * «вертикальный жест принадлежит плитке, горизонтальный — листалке» легко
 * потерять глазами при правке разметки. Здесь оно накрыто тестами.
 */

/** ISO 7810 ID-1 — 85,60 × 53,98 мм; в разметке это одна строка на оба места. */
export const TILE_CLASS = "aspect-[856/540]";

/**
 * Поле вокруг плитки. Без него закругление упирается в край экрана и углов не
 * видно вовсе — поле и есть то, что делает плитку плиткой, а не лентой.
 */
export const TILE_PAD_CLASS = "px-3 pt-3";

/** Сама плитка: пропорция, закруглённые углы и рамка — одной строкой на оба места. */
export const TILE_SHELL = `${TILE_CLASS} w-full overflow-hidden rounded-2xl border border-hairline`;

/** Жест короче — это дрожание пальца, а не раскрытие. */
export const TILE_DRAG_MIN = 12;
/** Вертикальным считается жест, который заметно длиннее по оси Y. */
export const TILE_AXIS_RATIO = 1.4;
/** Доля высоты, после которой плитка меняет состояние. */
export const TILE_SNAP_SHARE = 0.25;
/** Скорость на отрыве (px/ms), при которой состояние меняет и короткий флик. */
export const TILE_SNAP_VELOCITY = 0.35;
/** Отступ от края окна до линии маршрута. */
export const TILE_PAD = 16;
/** Полоса, которую отступы обязаны оставить карте: без неё `fitBounds` слеп. */
export const TILE_MIN_SPAN = 80;

export type TileRect = { top: number; left: number; width: number; height: number };
export type TileViewport = { width: number; height: number };
export type TilePadding = { top: number; right: number; bottom: number; left: number };

/**
 * Новое состояние плитки после жеста. Палец вниз сворачивает, вверх —
 * раскрывает; жест в сторону текущего состояния не делает ничего.
 */
export function settleTile(i: {
  expanded: boolean;
  dx: number;
  dy: number;
  height: number;
  velocity: number;
}): boolean {
  if (Math.abs(i.dy) <= TILE_DRAG_MIN) return i.expanded;
  // Горизонтальный перевес — это листалка страниц, у неё свой разбор жеста.
  if (Math.abs(i.dy) <= Math.abs(i.dx) * TILE_AXIS_RATIO) return i.expanded;
  const far = Math.abs(i.dy) > Math.max(1, i.height) * TILE_SNAP_SHARE;
  const fast = Math.abs(i.velocity) > TILE_SNAP_VELOCITY;
  if (!far && !fast) return i.expanded;
  return i.dy < 0;
}

/**
 * Отступы `fitBounds`, при которых линия маршрута ложится внутрь окна плитки.
 * Одно правило на свёрнутую и раскрытую: у раскрытой прямоугольник просто
 * больше, и прежнее поведение получается само.
 */
export function tilePadding(i: {
  tile: TileRect;
  viewport: TileViewport;
  pad?: number;
}): TilePadding {
  const pad = i.pad ?? TILE_PAD;
  const positive = (n: number) => Math.max(0, Math.round(n));
  let top = positive(i.tile.top + pad);
  let bottom = positive(i.viewport.height - (i.tile.top + i.tile.height) + pad);
  let left = positive(i.tile.left + pad);
  let right = positive(i.viewport.width - (i.tile.left + i.tile.width) + pad);
  // Отступы больше контейнера не показали бы ничего, поэтому пара, которая не
  // влезла, ужимается пропорционально — окно съезжает, но карта видна.
  [top, bottom] = squeeze(top, bottom, i.viewport.height);
  [left, right] = squeeze(left, right, i.viewport.width);
  return { top, right, bottom, left };
}

function squeeze(a: number, b: number, span: number): [number, number] {
  const room = Math.max(0, span - TILE_MIN_SPAN);
  const sum = a + b;
  if (sum <= room) return [a, b];
  if (sum === 0) return [0, 0];
  const k = room / sum;
  return [Math.round(a * k), Math.round(b * k)];
}

/**
 * Сдвиг центра карты в пикселях, при котором точка встаёт в середину окна
 * плитки, а не в середину экрана. Язык `map.easeTo({ offset })`.
 */
export function tileOffset(i: { tile: TileRect; viewport: TileViewport }): [number, number] {
  return [
    Math.round(i.tile.left + i.tile.width / 2 - i.viewport.width / 2),
    Math.round(i.tile.top + i.tile.height / 2 - i.viewport.height / 2),
  ];
}

/**
 * Жалоба принимается только на нашу точку. У точки зеркала BTC Map нет ни
 * владельца, которому писать, ни способа её снять: ночной синк вернёт её
 * обратно — кнопка там обещала бы то, чего мы не сделаем.
 */
export function reportablePointId(poiId: string): string | null {
  const m = /^company\/(.+)$/.exec(poiId);
  return m ? m[1] : null;
}
