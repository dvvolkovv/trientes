import { describe, expect, it } from "vitest";
import {
  ADMIN_BUTTON,
  ADMIN_BUTTON_DANGER,
  ADMIN_BUTTON_SECONDARY,
  ADMIN_COLUMN,
  ADMIN_TILE,
  ADMIN_FILTER_GRID,
  ADMIN_FILTER_TILE,
  ADMIN_TAB_STRIP,
} from "@/lib/admin-ui";

describe("правила вида админки", () => {
  it("кнопка не ниже 44 px и во всю ширину", () => {
    for (const cls of [ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY, ADMIN_BUTTON_DANGER]) {
      expect(cls).toContain("h-12");
      expect(cls).toContain("w-full");
      expect(cls).toContain("rounded-");
    }
  });

  it("колонка содержимого по центру", () => {
    expect(ADMIN_COLUMN).toContain("mx-auto");
    expect(ADMIN_COLUMN).toContain("max-w-");
  });

  it("плитка квадратная", () => {
    expect(ADMIN_TILE).toContain("aspect-square");
  });

  // Просьба владельца 22.11: внутри раздела листать только вниз. Полоса
  // разделов — единственное место, где прокрутка вбок остаётся.
  it("фильтры внутри раздела вбок не листаются", () => {
    expect(ADMIN_FILTER_GRID).toContain("grid");
    expect(ADMIN_FILTER_GRID).not.toContain("overflow-x");
    expect(ADMIN_FILTER_TILE).not.toContain("overflow-x");
    expect(ADMIN_TAB_STRIP).toContain("overflow-x-auto");
  });

  it("плитка фильтра не ниже пальца и не квадратная", () => {
    expect(ADMIN_FILTER_TILE).toContain("min-h-[72px]");
    expect(ADMIN_FILTER_TILE).not.toContain("aspect-square");
  });
});
