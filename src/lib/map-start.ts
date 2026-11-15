/**
 * С чего навигатор начинает.
 *
 * Карта всегда открывается у человека под ногами, если ему есть что показать:
 * «где я» — первый вопрос, с которым в навигатор заходят. Пока ответа нет,
 * нужна непустая точка по умолчанию — иначе первый экран это серый океан.
 */

/** Мадрид. Прежде здесь была Прага — выбор владельца, не свойство данных. */
export const MAP_FALLBACK_CENTER: [number, number] = [-3.7037902, 40.4167754];
export const MAP_FALLBACK_ZOOM = 12;

/**
 * Спрашивать ли положение самому при открытии карты.
 *
 * Отказ — это решение человека, и переспрашивать его на каждом заходе значит
 * не услышать: браузер после второго отказа блокирует запрос насовсем. Всё
 * остальное — да: «разрешено» отвечает без единого окна, а «ещё не спросили»
 * это и есть тот вопрос, ради которого человек открыл навигатор.
 */
export function shouldAutoLocate(state: PermissionState | "unknown"): boolean {
  return state !== "denied";
}

/** Состояние разрешения; браузер без Permissions API отвечает «не знаю». */
export async function geolocationPermission(): Promise<PermissionState | "unknown"> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state;
  } catch {
    // Safari до 16 знает Permissions API, но про геолокацию в нём не слышал.
    return "unknown";
  }
}
