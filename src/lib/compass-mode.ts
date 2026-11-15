/**
 * Компас под картой: два состояния одной кнопки.
 *
 * «Север вверх» — карта стоит, стрелка показывает, где север. «По движению» —
 * карта поворачивается туда, куда человек едет, и то, что впереди, нарисовано
 * сверху. Именно второго не хватало: стоящая севером вверх карта показывает
 * едущему на юг его дорогу снизу вверх, то есть «назад».
 *
 * Правило нажатия вынесено сюда, а не оставлено в обработчике, потому что у
 * него есть неочевидная середина: повёрнутую пальцами карту первое нажатие
 * выпрямляет, а не включает слежение. Иначе выхода из повёрнутой карты не
 * остаётся вовсе — кнопка одна, и она бы сразу уходила в другой режим.
 */

export type CompassMode = "north" | "heading";

/** Меньше этого поворот и наклон глазом не видны — считаем карту прямой. */
export const STRAIGHT_EPS = 0.5;

export function isStraight(i: { bearing: number; pitch: number }): boolean {
  return Math.abs(i.bearing) < STRAIGHT_EPS && Math.abs(i.pitch) < STRAIGHT_EPS;
}

/**
 * Что делать по нажатию на компас.
 *
 * `straighten` — вернуть карту севером вверх и снять наклон; `mode` — режим
 * после нажатия.
 */
export function compassTap(i: {
  mode: CompassMode;
  bearing: number;
  pitch: number;
}): { mode: CompassMode; straighten: boolean } {
  // Слежение выключается в «севером вверх»: человек просит остановить карту,
  // и оставить её под случайным углом значило бы не выполнить просьбу.
  if (i.mode === "heading") return { mode: "north", straighten: true };
  // Карта повёрнута руками — первое нажатие выпрямляет.
  if (!isStraight(i)) return { mode: "north", straighten: true };
  return { mode: "heading", straighten: false };
}

/**
 * Подпись кнопки: ключи в пространстве `cryptoMap`.
 *
 * Названо ровно то, что сделает нажатие, — у кнопки три разных действия, и
 * «Повернуть карту на север» на уже прямой карте было бы прямой неправдой.
 */
export function compassLabelKeys(i: { mode: CompassMode; straight: boolean }): {
  aria: string;
  short: string;
} {
  if (i.mode === "heading") return { aria: "headingUpOff", short: "headingUpShort" };
  return { aria: i.straight ? "headingUpOn" : "resetNorth", short: "north" };
}
