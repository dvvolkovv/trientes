/**
 * Луч курса у синей точки: куда человек повёрнут.
 *
 * Своё, а не штатное: в MapLibre 6 у `GeolocateControl` опции `showUserHeading`
 * больше нет, луч рисовать нечем. Это элемент разметки в метке карты, и
 * `rotationAlignment: "map"` держит его привязанным к сторонам света, а не к
 * экрану: при повороте карты луч продолжает показывать ту же сторону света.
 *
 * Луч стоит ПОД точкой геолокации (своя метка добавляется раньше): синий
 * кружок должен оставаться кружком, а не прятаться в заливке.
 *
 * Собирается узлами, а не строкой разметки: сырого HTML в проекте нет нигде,
 * и ради одного конуса заводить исключение незачем.
 */

const BEAM_SIZE = 72;
const SVG_NS = "http://www.w3.org/2000/svg";
/** Один на страницу: два одинаковых `id` градиента сломали бы заливку. */
const GRADIENT_ID = "trientes-heading-beam";

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function createHeadingBeamElement(): HTMLElement {
  const root = svg("svg", {
    width: String(BEAM_SIZE),
    height: String(BEAM_SIZE),
    viewBox: `0 0 ${BEAM_SIZE} ${BEAM_SIZE}`,
  });

  // Центр градиента — в вершине конуса, то есть в самой точке положения:
  // первый вариант светил из нижнего края метки, где конуса нет вовсе, и луч
  // выходил почти невидимым (поймано живым прогоном).
  const gradient = svg("radialGradient", {
    id: GRADIENT_ID,
    gradientUnits: "userSpaceOnUse",
    cx: "36",
    cy: "36",
    r: "34",
  });
  gradient.append(
    svg("stop", { offset: "0%", "stop-color": "#1f7df6", "stop-opacity": "0.75" }),
    svg("stop", { offset: "70%", "stop-color": "#1f7df6", "stop-opacity": "0.35" }),
    svg("stop", { offset: "100%", "stop-color": "#1f7df6", "stop-opacity": "0" }),
  );
  const defs = svg("defs", {});
  defs.append(gradient);

  // Конус из середины метки вверх: вершина ровно в точке положения, а
  // расходится он по ходу движения.
  const cone = svg("path", {
    d: "M36 36 L10 4 A 44 44 0 0 1 62 4 Z",
    fill: `url(#${GRADIENT_ID})`,
  });
  root.append(defs, cone);

  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.width = `${BEAM_SIZE}px`;
  el.style.height = `${BEAM_SIZE}px`;
  el.style.pointerEvents = "none";
  el.append(root);
  return el;
}

export { BEAM_SIZE as HEADING_BEAM_SIZE };
