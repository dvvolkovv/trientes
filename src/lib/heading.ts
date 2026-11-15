/**
 * Курс человека: куда он смотрит и куда едет.
 *
 * Источников два, и у каждого своя беда. GPS сообщает курс движения, но
 * только пока человек движется: стоящему он отдаёт `null` или прошлогоднее
 * значение. Компас телефона работает и у стоящего, но на скорости врёт — его
 * сбивает и наклон руки, и железо вокруг. Поэтому правило простое: едешь —
 * верим GPS, стоишь — верим компасу.
 *
 * Весь разбор держится здесь, без обращений к браузеру: угол — это
 * арифметика, и проверять её живым телефоном нельзя (чтобы увидеть курс на
 * 90 км/ч, надо ехать 90 км/ч).
 */

import { MOVING_MPS } from "@/lib/nav-camera";

/** Медленнее этого курс GPS — шум дрожащего отсчёта, а не направление. */
export const HEADING_MIN_SPEED_MPS = MOVING_MPS;

/** Поворот меньше этого — дрожание датчика; карту ради него не крутим. */
export const HEADING_MIN_DELTA_DEG = 3;

/** Приводит любой угол к [0, 360); `null` для всего, что не число. */
export function normalizeHeading(deg: number | null | undefined): number | null {
  if (typeof deg !== "number" || !Number.isFinite(deg)) return null;
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

/** Кратчайшая дуга между двумя курсами, 0…180. */
export function headingDelta(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Какой курс показывать: курс движения у едущего, компас у стоящего.
 *
 * Скорость неизвестна (`null`) — это не «стоит»: половина браузеров её просто
 * не сообщает. В этом случае курс GPS всё-таки берётся, если он есть.
 */
export function pickHeading(i: {
  gpsHeading: number | null | undefined;
  speedMps: number | null | undefined;
  compassHeading: number | null | undefined;
}): number | null {
  const gps = normalizeHeading(i.gpsHeading);
  const compass = normalizeHeading(i.compassHeading);
  const speed = typeof i.speedMps === "number" && Number.isFinite(i.speedMps) ? i.speedMps : null;
  const moving = speed === null || speed >= HEADING_MIN_SPEED_MPS;
  if (moving && gps !== null) return gps;
  if (compass !== null) return compass;
  return gps;
}

/** Стоит ли двигать карту: первый курс — всегда, дальше — только заметный поворот. */
export function headingChanged(
  prev: number | null,
  next: number | null,
  minDeg: number = HEADING_MIN_DELTA_DEG,
): boolean {
  if (next === null) return false;
  if (prev === null) return true;
  return headingDelta(prev, next) >= minDeg;
}

/**
 * Курс из события ориентации устройства.
 *
 * iOS отдаёт готовый `webkitCompassHeading` — градусы по часовой от севера.
 * Android отдаёт `alpha` против часовой, и только у абсолютной ориентации он
 * вообще привязан к северу: у относительной это угол от случайного нуля, и
 * принимать его за курс нельзя.
 */
export function compassHeadingFrom(e: {
  webkitCompassHeading?: number | null;
  alpha?: number | null;
  absolute?: boolean;
}): number | null {
  const webkit = normalizeHeading(e.webkitCompassHeading);
  if (webkit !== null) return webkit;
  if (!e.absolute) return null;
  const alpha = normalizeHeading(e.alpha);
  return alpha === null ? null : normalizeHeading(360 - alpha);
}
