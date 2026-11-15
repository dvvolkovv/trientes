import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Требование владельца: в карточке точки всё — кнопки под палец, текстовых
 * ссылок нет. Внешний переход остаётся элементом `<a>` (иначе ломаются
 * «открыть в новой вкладке» и долгое нажатие по номеру), но меряется как
 * кнопка. Тест смотрит в исходник, потому что отрисовки компонентов в проекте
 * нет — jsdom не подключён, UI закрывает Playwright.
 */
const FILES = [
  "src/components/coin-detail/poi-sheet.tsx",
  "src/components/coin-detail/poi-pane-card.tsx",
  "src/components/coin-detail/poi-pane-showcase.tsx",
  "src/components/coin-detail/poi-pane-map.tsx",
  "src/components/coin-detail/poi-banner-overlay.tsx",
];

// `CHIP` — такой же именованный размер под палец (40 px), как `ROW_BTN` и `PRIMARY`.
const TAP_CLASSES = ["ROW_BTN", "PRIMARY", "SECONDARY", "TAP", "CHIP", "min-h-[40px]", "min-h-[44px]", "min-h-[56px]"];

describe("карточка точки: кнопки, а не ссылки", () => {
  for (const file of FILES) {
    it(`${file} — у каждого <a> есть размер под палец`, () => {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      const anchors = src.split(/<a\s/).slice(1);
      const bare = anchors.filter((chunk) => {
        const head = chunk.slice(0, chunk.indexOf(">"));
        return !TAP_CLASSES.some((c) => head.includes(c));
      });
      expect(bare).toEqual([]);
    });

    it(`${file} — нет подчёркнутых ссылок`, () => {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/\bunderline\b/);
    });
  }
});
