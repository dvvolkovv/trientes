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
 * Точка, ради которой карту открыли: пришла в адресе ссылкой «где именно».
 * `id` — тот же, каким точка приходит в фиде (`company/<id>`), чтобы по нему
 * узнать её в ответе и раскрыть карточку.
 */
export type MapFocus = { id: string; lat: number; lon: number };

/** Приближение улицы: названное место должно быть видно домом, а не городом. */
export const MAP_FOCUS_ZOOM = 16;

/** С какого вида начинается карта: с названного места, иначе с города по умолчанию. */
export function startView(focus: MapFocus | null | undefined): {
  center: [number, number];
  zoom: number;
} {
  if (!focus) return { center: MAP_FALLBACK_CENTER, zoom: MAP_FALLBACK_ZOOM };
  return { center: [focus.lon, focus.lat], zoom: MAP_FOCUS_ZOOM };
}

/**
 * Спрашивать ли положение самому при открытии карты.
 *
 * Отказ — это решение человека, и переспрашивать его на каждом заходе значит
 * не услышать: браузер после второго отказа блокирует запрос насовсем. Всё
 * остальное — да: «разрешено» отвечает без единого окна, а «ещё не спросили»
 * это и есть тот вопрос, ради которого человек открыл навигатор.
 *
 * Исключение одно: человека позвали в конкретное место. Геолокация уводит
 * камеру к нему домой, и названный магазин, ради которого он нажал ссылку,
 * уезжает за край экрана — то есть ссылка не выполняет своего обещания.
 * Кнопка «моё положение» никуда не делась, и «Маршрут сюда» спросит сам.
 */
export function shouldAutoLocate(
  state: PermissionState | "unknown",
  focused = false,
): boolean {
  if (focused) return false;
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
