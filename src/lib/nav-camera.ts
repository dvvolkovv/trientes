/**
 * Камера ведения: куда смотреть, с какой высоты и под каким углом.
 *
 * Чистая арифметика без MapLibre — у ведения это единственная часть, которую
 * видно глазом и которую при этом нельзя проверить руками: чтобы увидеть
 * приближение на 90 км/ч, надо ехать 90 км/ч.
 */

export const NAV_PITCH = 55;

/** Доля высоты экрана, на которую своя метка опущена ниже середины. */
const PUCK_DROP = 0.2;

/** Заглядывание вперёд по линии, из которого берётся курс. */
export const LOOK_AHEAD_M = 30;

// Стоящему нужен дом на углу, едущему по трассе — следующая развязка.
const ZOOM_BY_SPEED: [number, number][] = [
  [0, 18],
  [2, 17.5],
  [8, 16.5],
  [16, 15.8],
  [30, 15.2],
];

export function followZoom(speedMps: number): number {
  const v = Math.max(0, speedMps);
  const last = ZOOM_BY_SPEED[ZOOM_BY_SPEED.length - 1];
  if (v >= last[0]) return last[1];
  for (let i = 1; i < ZOOM_BY_SPEED.length; i++) {
    const [s1, z1] = ZOOM_BY_SPEED[i];
    if (v <= s1) {
      const [s0, z0] = ZOOM_BY_SPEED[i - 1];
      const k = s1 === s0 ? 0 : (v - s0) / (s1 - s0);
      return z0 + (z1 - z0) * k;
    }
  }
  return last[1];
}

export type NavCamera = {
  center: [number, number];
  /** `null` — курс неизвестен, карту крутить нечем. */
  bearing: number | null;
  zoom: number;
  pitch: number;
  /** Смещение центра в пикселях: метка уезжает вниз, дорога впереди — вверх. */
  offset: [number, number];
};

export function cameraFor(i: {
  position: [number, number];
  snapped: [number, number] | null;
  routeBearing: number | null;
  gpsBearing: number | null;
  speedMps: number;
  offRouteMeters: number | null;
  viewportHeight: number;
}): NavCamera {
  // Сошедшего с маршрута на линии удерживать не за что: показываем, где он на
  // самом деле, и крутим по компасу, пока маршрут строится заново.
  const onRoute = i.offRouteMeters === null && i.snapped !== null;
  return {
    center: onRoute ? (i.snapped as [number, number]) : i.position,
    bearing: onRoute ? (i.routeBearing ?? i.gpsBearing) : (i.gpsBearing ?? i.routeBearing),
    zoom: followZoom(i.speedMps),
    pitch: NAV_PITCH,
    offset: [0, Math.round(i.viewportHeight * PUCK_DROP)],
  };
}
