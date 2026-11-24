import { describe, expect, it } from "vitest";
import {
  ROLE_TEMPLATES,
  TEAM_SECTIONS,
  can,
  movementScopeAllows,
  parsePermissions,
  permissionsFor,
  pointScopeAllows,
  visibleSections,
} from "@/lib/company-team/permissions";

describe("permissionsFor", () => {
  it("владелец правит все разделы и не настраивается", () => {
    const perms = permissionsFor({ role: "OWNER", rolePermissions: { card: "VIEW" } });
    for (const section of TEAM_SECTIONS) expect(can(perms, section, "EDIT")).toBe(true);
  });

  // Наём (`hiring`, слайс CH) в наследие не входит: раздел появился позже этих
  // членов, и право звать людей им никто не давал — см. `hiring-permission.test.ts`.
  it("наследие фазы 10: EDITOR правит всё, VIEWER смотрит всё", () => {
    const editor = permissionsFor({ role: "EDITOR", rolePermissions: null });
    const viewer = permissionsFor({ role: "VIEWER", rolePermissions: null });
    for (const section of TEAM_SECTIONS) {
      if (section === "hiring") {
        expect(can(editor, section, "VIEW")).toBe(false);
        expect(can(viewer, section, "VIEW")).toBe(false);
        continue;
      }
      expect(can(editor, section, "EDIT")).toBe(true);
      expect(can(viewer, section, "EDIT")).toBe(false);
      expect(can(viewer, section, "VIEW")).toBe(true);
    }
  });

  it("своя роль перебивает наследие", () => {
    const perms = permissionsFor({ role: "EDITOR", rolePermissions: { warehouses: "EDIT" } });
    expect(can(perms, "warehouses", "EDIT")).toBe(true);
    // Кладовщик не правит цену — это и есть дыра, которую закрывает слайс.
    expect(can(perms, "pricing", "EDIT")).toBe(false);
    expect(can(perms, "pricing", "VIEW")).toBe(false);
  });

  it("нет члена — нет прав", () => {
    expect(visibleSections(permissionsFor(null))).toEqual([]);
  });
});

describe("parsePermissions", () => {
  it("неизвестный раздел и негодный уровень означают запрет", () => {
    const perms = parsePermissions({ warehouses: "EDIT", acquiring: "EDIT", pricing: "ADMIN", card: 5 });
    expect(perms).toEqual({ warehouses: "EDIT" });
  });

  it("мусор вместо объекта — пустые права", () => {
    expect(parsePermissions(null)).toEqual({});
    expect(parsePermissions("EDIT")).toEqual({});
    expect(parsePermissions(["EDIT"])).toEqual({});
  });
});

describe("ROLE_TEMPLATES", () => {
  it("каждый шаблон назван и содержит только известные разделы и уровни", () => {
    expect(ROLE_TEMPLATES.length).toBeGreaterThan(0);
    for (const template of ROLE_TEMPLATES) {
      expect(template.key).toMatch(/^[a-z]+$/);
      expect(parsePermissions(template.permissions)).toEqual(template.permissions);
    }
  });

  it("у администратора есть всё, у наблюдателя — только смотреть", () => {
    const manager = ROLE_TEMPLATES.find((t) => t.key === "manager")!.permissions;
    const observer = ROLE_TEMPLATES.find((t) => t.key === "observer")!.permissions;
    for (const section of TEAM_SECTIONS) {
      expect(can(manager, section, "EDIT")).toBe(true);
      expect(can(observer, section, "VIEW")).toBe(true);
      expect(can(observer, section, "EDIT")).toBe(false);
    }
  });
});

describe("сужение по точкам", () => {
  it("пустой список — все точки", () => {
    expect(pointScopeAllows([], "p1")).toBe(true);
    expect(pointScopeAllows([], null)).toBe(true);
  });

  it("склад без точки в участок не попадает", () => {
    expect(pointScopeAllows(["p1"], null)).toBe(false);
    expect(pointScopeAllows(["p1"], "p1")).toBe(true);
    expect(pointScopeAllows(["p1"], "p2")).toBe(false);
  });

  it("движение разрешено, только когда оба конца в участке", () => {
    expect(movementScopeAllows(["p1"], { fromPointId: "p1", toPointId: "p1" })).toBe(true);
    expect(movementScopeAllows(["p1"], { fromPointId: "p1", toPointId: "p2" })).toBe(false);
    expect(movementScopeAllows(["p1"], { toPointId: "p1" })).toBe(true);
    expect(movementScopeAllows(["p1"], { toPointId: null })).toBe(false);
    expect(movementScopeAllows([], { fromPointId: null, toPointId: "p9" })).toBe(true);
  });
});
