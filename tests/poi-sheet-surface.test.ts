import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Две жалобы глазом, которые легко вернуть правкой разметки, поэтому они
 * закреплены чтением исходника (отрисовки компонентов в проекте нет — jsdom
 * не подключён, UI закрывает Playwright):
 *
 * 1. Карта просвечивала сквозь страницу заведения. Фон листа зависел от
 *    страницы, а страница меняется только в конце жеста — пока палец тянул
 *    лист, «Место» ехало поверх живой карты без подложки.
 * 2. Подсказка манёвра лежала на карте и закрывала собой тот перекрёсток, к
 *    которому вела.
 */
function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("лист точки: страница закрывает карту собой", () => {
  const src = read("src/components/coin-detail/poi-sheet.tsx");

  it("у страниц, кроме карты, свой непрозрачный фон", () => {
    const pane = src.slice(src.indexOf('role="tabpanel"'));
    const decision = pane.slice(0, pane.indexOf("</div>"));
    expect(decision).toContain('p === "map"');
    expect(decision).toContain("bg-card");
  });

  it("корень листа прозрачен только на странице карты", () => {
    expect(src).toContain('onMapPage\n      ? "bg-transparent pointer-events-none"');
  });

  it("шапка полупрозрачна только у отстоявшейся страницы карты", () => {
    expect(src).toMatch(/drag === null \? "bg-card\/90 backdrop-blur" : "bg-card"/);
  });
});

describe("подсказка манёвра стоит над картой, а не на ней", () => {
  it("баннер не позиционирован поверх полотна", () => {
    const src = read("src/components/coin-detail/route-steps-panel.tsx");
    const banner = src.slice(src.indexOf("export function ManeuverBanner"));
    expect(banner).not.toContain("absolute");
  });

  it("в полном экране баннер — отдельная строка, карта занимает остаток", () => {
    const src = read("src/components/coin-detail/crypto-navigator.tsx");
    expect(src).toContain("flex flex-col bg-bg");
    expect(src).toContain('"relative w-full min-h-0 flex-1 overflow-hidden"');
  });
});
