import { describe, expect, it } from "vitest";
import { LIVE_POINT, NOT_DELETED } from "@/lib/soft-delete";

// Опечатка в ключе фрагмента не вызовет ошибку типов (Prisma примет лишнее
// поле как фильтр по неизвестной колонке только в рантайме), поэтому форма
// фиксируется тестом.
describe("soft-delete фрагменты", () => {
  it("NOT_DELETED filters on deletedAt only", () => {
    expect(NOT_DELETED).toEqual({ deletedAt: null });
  });

  it("LIVE_POINT also requires the parent company to be alive", () => {
    expect(LIVE_POINT).toEqual({ deletedAt: null, company: { deletedAt: null } });
  });
});
