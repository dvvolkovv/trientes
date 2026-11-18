/**
 * Цвет булавки на карте говорит, **кто за точкой стоит**, а не что это за
 * заведение (что именно — говорит фильтр слоёв и сама карточка).
 *
 * Прежде цвет значил слой: зелёный магазин, оранжевый банкомат, синий банк,
 * фиолетовый финтех. Четыре цвета из разных семей не читались как один знак и
 * ничего не сообщали о главном — можно ли этому месту верить. Теперь палитра
 * фирменная, и в ней ровно три значения:
 *
 * - **оранжевый** — точка предприятия, зарегистрированного у нас: у неё есть
 *   хозяин, карточка и ответственность за написанное;
 * - **металлический** — учреждение из нашего каталога финтеха;
 * - **белый** — точка зеркала BTC Map: чужие данные OpenStreetMap, о заведении
 *   мы не знаем ничего и не обещаем ничего.
 *
 * Правило — свойство источника, а не категории: банк, пришедший из зеркала,
 * остаётся белым, потому что о нём мы знаем ровно столько же, сколько о любой
 * другой точке OSM.
 */

import type { Poi, PoiLayer } from "@/lib/crypto-map";

export type PoiBrand = "own" | "institution" | "osm";

export const BRAND_COLOR: Record<PoiBrand, string> = {
  own: "#FE5C04",
  institution: "#C3C9D2",
  osm: "#F3F5F8",
};

/** Кольцо вокруг булавки, когда точка принимает выбранную монету. */
export const BRAND_RING: Record<PoiBrand, string> = {
  // На оранжевой заливке оранжевое кольцо не видно — там оно белое.
  own: "#FFFFFF",
  institution: "#FE5C04",
  osm: "#FE5C04",
};

export function poiBrand(poi: { id: string; layer: PoiLayer }): PoiBrand {
  if (poi.id.startsWith("company/")) return "own";
  if (poi.id.startsWith("fintech/")) return "institution";
  return "osm";
}

export function poiBrandColor(poi: Poi): string {
  return BRAND_COLOR[poiBrand(poi)];
}
