/**
 * Слои точек навигатора и их цвета.
 *
 * Жили в самом навигаторе, пока цвет и перечень не понадобились второму
 * месту — полосе «Доступно в стране» над картой. Своя копия перечня у двух
 * мест разошлась бы на первом же новом слое.
 */

import type { PoiLayer } from "@/lib/crypto-map";

export type { PoiLayer };

export const POI_LAYERS = ["merchant", "atm", "financial", "fintech"] as const satisfies readonly PoiLayer[];

export const LAYER_COLOR: Record<PoiLayer, string> = {
  merchant: "#30B658",
  atm: "#FE5C04",
  financial: "#5B8DEF",
  fintech: "#A855F7",
};
