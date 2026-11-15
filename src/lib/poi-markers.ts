/**
 * Логотип заведения прямо на точке карты.
 *
 * Круг цвета слоя говорит, что это «магазин» или «банкомат», но не говорит
 * чей он: человек видит точку и не понимает, кому она принадлежит. Там, где
 * знак есть (точка компании, финтех), он и становится меткой.
 *
 * Знак — это чужой адрес из заявки, поэтому он проходит ту же проверку, что
 * и ссылки витрины: только http(s) или наш собственный путь загрузки. Решение
 * «рисовать или не рисовать» вынесено сюда, а не оставлено в навигаторе:
 * метка живёт DOM-элементом рядом с картой и о фильтрах слоёв сама не знает —
 * их надо применять руками, а значит, правило должно быть накрыто тестом.
 */

import type { Poi, PoiLayer } from "@/lib/crypto-map";
import { safeHttpUrl } from "@/lib/safe-url";

/** Адрес знака, пригодный для `<img src>`, или `null`. */
export function poiLogoSrc(poi: { logoUrl?: string | null }): string | null {
  const raw = poi.logoUrl?.trim();
  if (!raw) return null;
  // Свой файл загрузки приходит относительным путём; «//чужой.сайт» — это уже
  // чужой адрес без схемы, и в наш путь он не превращается.
  if (raw.startsWith("/")) return raw.startsWith("//") ? null : raw;
  return safeHttpUrl(raw);
}

/**
 * Видна ли метка сейчас. Фильтры слоёв и «только монета страницы» MapLibre
 * применяет к своим слоям сам, а метку — элемент DOM поверх полотна — надо
 * прятать руками, иначе выключенный слой оставляет на карте свои логотипы.
 */
export function showsLogoMarker(
  poi: Poi,
  i: { visible: Record<PoiLayer, boolean>; coinOnly: boolean },
): boolean {
  if (!poiLogoSrc(poi)) return false;
  if (!i.visible[poi.layer]) return false;
  if (i.coinOnly && !poi.coinSpecific) return false;
  return true;
}
