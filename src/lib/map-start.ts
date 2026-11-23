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
/**
 * Знак на месте, ради которого карту открыли. Нужен там, где у места нет строки
 * в фиде: место рекламного материала точкой приёма не является (BZ), и карта
 * просто вставала на координате — пустым полем без всякой отметки.
 */
export type FocusMark = { label: string; logoUrl: string | null; href: string | null };

export type MapFocus = { id: string; lat: number; lon: number; mark?: FocusMark | null };

/** Приближение улицы: названное место должно быть видно домом, а не городом. */
export const MAP_FOCUS_ZOOM = 16;

/**
 * Прямоугольник, в который должны попасть все точки, ради которых карту
 * открыли. Нужен там, где фильтр карты — наша карточка монеты: точек у неё
 * единицы, и человек под ногами почти наверняка стоит не рядом с ними.
 */
export type MapArea = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

/** Отступ от края полотна при посадке на прямоугольник, пиксели. */
export const MAP_AREA_PADDING = 48;

/**
 * С чего карта начинает: названное место, иначе прямоугольник точек, иначе
 * город по умолчанию. Углы отдаются в том порядке, в каком их ждёт MapLibre:
 * юго-запад, северо-восток. Форма возврата — готовые поля MapOptions, чтобы
 * вызов просто разложил её в конструктор карты.
 *
 * Прямоугольник в ноль (одна точка) — не особый случай: посадка упирается в
 * `maxZoom` и камера встаёт ровно на точке.
 */
export function startView(
  focus: MapFocus | null | undefined,
  area?: MapArea | null,
):
  | { center: [number, number]; zoom: number }
  | {
      bounds: [[number, number], [number, number]];
      fitBoundsOptions: { padding: number; maxZoom: number };
    } {
  // Названное место важнее области: ссылка «где именно» зовёт в магазин, а не
  // в страну, где он стоит.
  if (focus) return { center: [focus.lon, focus.lat], zoom: MAP_FOCUS_ZOOM };
  if (area) {
    return {
      bounds: [
        [area.minLon, area.minLat],
        [area.maxLon, area.maxLat],
      ],
      fitBoundsOptions: { padding: MAP_AREA_PADDING, maxZoom: MAP_FOCUS_ZOOM },
    };
  }
  return { center: MAP_FALLBACK_CENTER, zoom: MAP_FALLBACK_ZOOM };
}

/**
 * Спрашивать ли положение самому при открытии карты.
 *
 * Отказ — это решение человека, и переспрашивать его на каждом заходе значит
 * не услышать: браузер после второго отказа блокирует запрос насовсем. Всё
 * остальное — да: «разрешено» отвечает без единого окна, а «ещё не спросили»
 * это и есть тот вопрос, ради которого человек открыл навигатор.
 *
 * Исключение одно: человека позвали в конкретное место — или в область, где
 * эту монету принимают (см. `startView`). Геолокация уводит камеру к нему
 * домой, и названный магазин, ради которого он нажал ссылку, уезжает за край
 * экрана — то есть ссылка не выполняет своего обещания.
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
