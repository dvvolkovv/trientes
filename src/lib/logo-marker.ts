/**
 * Метка со знаком предприятия на карте — элемент DOM, а не значок слоя.
 *
 * Почему DOM: значку MapLibre нужен растр с заголовком CORS, а знаки заведений
 * это и svg, и чужие хосты (разбор слайса AK). Сам вид — `.cmap-poi-logo` в
 * `globals.css`: белый кружок 28 px с кольцом цвета источника.
 *
 * Собирается здесь, а не в каждом месте по-своему: метка нужна и точке приёма в
 * навигаторе, и месту рекламного материала, и вторая копия правил вида уже
 * однажды разошлась с первой (список локалей, уборка AU).
 */

import { poiLogoSrc } from "@/lib/poi-markers";

export type LogoMarkerInput = {
  /** Знак предприятия; негодный или пустой — метка остаётся с первой буквой. */
  logoUrl?: string | null;
  /** Чьё это место: заголовок метки и запасная буква вместо знака. */
  label: string;
  /** Цвет кольца — кто за точкой стоит (`BRAND_COLOR`). */
  ringColor: string;
  /** Нажатие ведёт по адресу; без него метка нажатие не обрабатывает. */
  href?: string | null;
};

export function buildLogoMarkerElement(i: LogoMarkerInput): {
  el: HTMLElement;
  /** Картинка знака, если он годен: вызывающий сам решает, что делать с битой. */
  img: HTMLImageElement | null;
} {
  const el = document.createElement(i.href ? "a" : "div");
  el.className = "cmap-poi-logo";
  el.style.borderColor = i.ringColor;
  el.title = i.label;
  if (i.href && el instanceof HTMLAnchorElement) el.href = i.href;

  const src = poiLogoSrc({ logoUrl: i.logoUrl ?? null });
  if (!src) {
    // Знака нет — кружок с первой буквой названия. Пустой белый кружок не
    // говорит ничего, а место тут и есть то, ради чего карту открыли.
    el.textContent = i.label.trim().slice(0, 1).toUpperCase();
    el.style.fontWeight = "700";
    el.style.fontSize = "13px";
    el.style.color = "#10131A";
    return { el, img: null };
  }
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  el.append(img);
  return { el, img };
}
