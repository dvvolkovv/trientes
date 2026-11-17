import { describe, expect, it } from "vitest";
import {
  ADMIN_BUTTON,
  ADMIN_BUTTON_DANGER,
  ADMIN_BUTTON_SECONDARY,
  ADMIN_COLUMN,
  ADMIN_TILE,
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
});
