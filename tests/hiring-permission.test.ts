import { describe, expect, it } from "vitest";
import {
  ALL_EDIT,
  ROLE_TEMPLATES,
  TEAM_SECTIONS,
  can,
  inviteRoleAllowed,
  permissionsFor,
} from "@/lib/company-team/permissions";
import { COMPANY_TILES, tileVisible } from "@/lib/cabinet/company-nav";

/**
 * Слайс CH: директор вправе поручить наём кадровику. Правило узкое, и самое
 * опасное в нём — не то, что кадровик может, а то, чего он не может.
 */
describe("раздел найма", () => {
  it("владелец вправе всё, включая наём", () => {
    const perms = permissionsFor({ role: "OWNER", rolePermissions: null });
    expect(can(perms, "hiring", "EDIT")).toBe(true);
    for (const section of TEAM_SECTIONS) expect(can(perms, section, "EDIT"), section).toBe(true);
  });

  it("редактор и наблюдатель наследия найма не получают", () => {
    // Эти члены заведены до появления раздела, и никто не решал давать им право
    // звать людей: молчаливое расширение прав живого редактора недопустимо.
    const editor = permissionsFor({ role: "EDITOR", rolePermissions: null });
    const viewer = permissionsFor({ role: "VIEWER", rolePermissions: null });
    expect(can(editor, "hiring", "VIEW")).toBe(false);
    expect(can(viewer, "hiring", "VIEW")).toBe(false);
    // Всё прочее наследие сохранено дословно (правило BE).
    for (const section of TEAM_SECTIONS) {
      // `automation` (CO) исключён из наследия по тому же разбору, что `hiring`.
      if (section === "hiring" || section === "automation") continue;
      expect(can(editor, section, "EDIT"), section).toBe(true);
      expect(can(viewer, section, "VIEW"), section).toBe(true);
    }
  });

  it("у шаблона кадровика есть наём и нет витрины, склада и цены", () => {
    const hr = ROLE_TEMPLATES.find((t) => t.key === "hr")!;
    expect(hr.permissions.hiring).toBe("EDIT");
    for (const section of ["card", "points", "products", "warehouses", "pricing", "promos", "supply", "customers"] as const) {
      expect(hr.permissions[section], section).toBeUndefined();
    }
  });

  it("приглашение в владельцы выдаёт только владелец", () => {
    expect(inviteRoleAllowed(true, "OWNER")).toBe(true);
    expect(inviteRoleAllowed(false, "OWNER")).toBe(false);
    for (const role of ["EDITOR", "VIEWER"] as const) {
      expect(inviteRoleAllowed(false, role), role).toBe(true);
      expect(inviteRoleAllowed(true, role), role).toBe(true);
    }
  });

  it("у кадровика есть дверь в кабинете, и только одна", () => {
    const hr = ROLE_TEMPLATES.find((t) => t.key === "hr")!.permissions;
    const gate = { permissions: hr, isOwner: false };
    const visible = COMPANY_TILES.filter((t) => tileVisible(t, gate)).map((t) => t.key);
    expect(visible).toContain("team");
    // Журнал остаётся владельцу, состав команды тоже — здесь только наём.
    expect(visible).not.toContain("journal");
    expect(visible).not.toContain("points");
    expect(visible).not.toContain("warehouses");
  });

  it("владелец по-прежнему видит команду", () => {
    const team = COMPANY_TILES.find((t) => t.key === "team")!;
    expect(tileVisible(team, { permissions: ALL_EDIT, isOwner: true })).toBe(true);
    // А редактор наследия — нет: до слайса плитка была видна только владельцу.
    expect(
      tileVisible(team, {
        permissions: permissionsFor({ role: "EDITOR", rolePermissions: null }),
        isOwner: false,
      }),
    ).toBe(false);
  });
});
