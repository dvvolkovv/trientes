import type { RouteMode } from "./crypto-map";

/**
 * Передача точки назначения родному навигатору телефона.
 *
 * CarPlay и Android Auto рисуют не страницы, а приложения — шаблонами Apple и
 * Google, под которые нужен навигационный entitlement и настоящее нативное
 * приложение. Обёртка WebView в такой шаблон не вставляется ни при каких
 * условиях. Зато родной навигатор телефона в этих шаблонах уже живёт: отдаём
 * точку ему, и экран машины получает ведение со своим голосом и пробками.
 *
 * Отдаём только точку, не геометрию: чужой навигатор построит свой маршрут по
 * своим пробкам, и он будет лучше нашего.
 */

export type HandoffPlatform = "apple" | "google" | "web";

export function handoffPlatform(userAgent: string): HandoffPlatform {
  const ua = userAgent || "";
  // Настольный Mac — не айфон: Apple Maps там есть, но CarPlay ни при чём, и
  // схема maps:// в браузере работает хуже обычной ссылки.
  if (/iPhone|iPad|iPod/i.test(ua)) return "apple";
  if (/Android/i.test(ua)) return "google";
  return "web";
}

const APPLE_FLAG: Record<RouteMode, string> = { car: "d", walk: "w", transit: "r" };
const GOOGLE_MODE: Record<"car" | "walk", string> = { car: "d", walk: "w" };
const WEB_MODE: Record<RouteMode, string> = {
  car: "driving",
  walk: "walking",
  transit: "transit",
};

export type HandoffDestination = { lat: number; lon: number; name: string };

export function handoffUrl(
  platform: HandoffPlatform,
  dest: HandoffDestination,
  mode: RouteMode,
): string {
  const point = `${dest.lat},${dest.lon}`;
  if (platform === "apple") return `maps://?daddr=${point}&dirflg=${APPLE_FLAG[mode]}`;
  // У схемы google.navigation: общественного транспорта нет — вести «на
  // автобусе» она молча превратит в пешком, поэтому там обычная ссылка.
  if (platform === "google" && mode !== "transit") {
    return `google.navigation:q=${point}&mode=${GOOGLE_MODE[mode]}`;
  }
  const q = new URLSearchParams({ api: "1", destination: point, travelmode: WEB_MODE[mode] });
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}
