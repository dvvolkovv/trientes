/**
 * Булавка на карте несёт два знака, и путать их нельзя.
 *
 * **Каёмка — кто за точкой стоит:**
 * - **оранжевая** — предприятие, зарегистрированное у нас: есть хозяин,
 *   карточка и ответственность за написанное;
 * - **серая (металлик)** — учреждение из нашего каталога финтеха;
 * - **белая** — точка зеркала BTC Map: чужие данные OpenStreetMap, мы не
 *   обещаем ничего.
 *
 * Правило каёмки — свойство **источника, а не вывески**: банк, пришедший из
 * зеркала, остаётся белым, потому что о нём мы знаем ровно столько же, сколько
 * о любой другой точке OSM.
 *
 * **Пульсирующая точка в середине — что это за место:** банкоматы, банки и
 * обменники пульсируют оранжевым, магазины зелёным, заправки синим. Пульс, а
 * не статичная заливка, — решение владельца: живой огонёк виден на пёстрой
 * подложке там, где ровный кружок теряется.
 *
 * Прежде цвет булавки означал слой целиком (зелёный магазин, оранжевый
 * банкомат, синий банк, фиолетовый финтех) — четыре цвета из разных семей, и
 * главного вопроса, можно ли написанному верить, они не решали.
 */

import type { Poi, PoiLayer } from "@/lib/crypto-map";
import { LAYER_COLOR } from "@/lib/poi-layers";

export type PoiBrand = "own" | "institution" | "osm";

/** Цвет каёмки — источник точки. */
export const BRAND_COLOR: Record<PoiBrand, string> = {
  own: "#FE5C04",
  institution: "#C3C9D2",
  osm: "#FFFFFF",
};

export function poiBrand(poi: { id: string; layer: PoiLayer }): PoiBrand {
  if (poi.id.startsWith("company/")) return "own";
  if (poi.id.startsWith("fintech/")) return "institution";
  return "osm";
}

/** Заправки и зарядные станции — синий пульс; это категория, а не слой. */
const FUEL_CATEGORY = /\b(fuel|petrol|gas station|charging station)\b/i;

export const FUEL_PULSE = "#4D8DF6";

/**
 * Цвет пульса. Категория сильнее слоя ровно в одном месте: заправка приходит
 * к нам как «магазин» (в OSM это `amenity=fuel`), а владелец назвал ей свой
 * цвет — значит, решает категория.
 */
export function poiPulseColor(poi: { layer: PoiLayer; category?: string | null }): string {
  if (poi.layer === "merchant" && poi.category && FUEL_CATEGORY.test(poi.category)) {
    return FUEL_PULSE;
  }
  return LAYER_COLOR[poi.layer] ?? LAYER_COLOR.merchant;
}

export function poiBrandColor(poi: Poi): string {
  return BRAND_COLOR[poiBrand(poi)];
}

/**
 * Как дышит точка: радиус и прозрачность по фазе 0…1. Чистая функция, потому
 * что анимацию карты иначе не проверить — кадры рисует MapLibre, а правило
 * пульса должно быть видно в тесте.
 *
 * Синус, а не пила: пульс должен возвращаться плавно, иначе на карте он
 * выглядит как мигание неисправной лампы.
 */
export function pulseFrame(phase: number): { radius: number; opacity: number } {
  const wave = (1 - Math.cos(phase * 2 * Math.PI)) / 2; // 0 → 1 → 0
  return {
    radius: 2.6 + wave * 2.2,
    opacity: 1 - wave * 0.4,
  };
}

/** Длина одного вдоха-выдоха. Медленно: карта — не светофор. */
export const PULSE_PERIOD_MS = 1800;
