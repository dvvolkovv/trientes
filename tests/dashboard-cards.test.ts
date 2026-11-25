/**
 * Граница сводки рабочего дня (слайс CM). Спека
 * `docs/superpowers/specs/2026-11-25-merchant-dashboard-design.md`.
 *
 * Проверяется ровно то, что нельзя увидеть глазом: сводка не обходит права
 * (кладовщик не читает выручку сводкой), у каждой плитки есть слова, и порог
 * автозаказа считается одним сравнением на два места.
 */
import { describe, it, expect } from "vitest";
import en from "../messages/en.json";
import { DASH_DEFS, visibleDashCards, dashNeeds } from "../src/lib/dashboard/cards";
import { belowThreshold } from "../src/lib/supply/reorder";
import { ROLE_TEMPLATES, ALL_EDIT, type TeamPermissions } from "../src/lib/company-team/permissions";

function keys(perms: TeamPermissions): string[] {
  return visibleDashCards(perms).map((d) => d.key);
}

const template = (key: string): TeamPermissions =>
  ROLE_TEMPLATES.find((r) => r.key === key)!.permissions;

describe("dashboard composition", () => {
  it("owner-level permissions see all five numbers of the brief", () => {
    expect(keys(ALL_EDIT)).toEqual(["sales", "stock", "tasks", "promos", "customers"]);
  });

  it("warehouse keeper never reads revenue from the summary", () => {
    const seen = keys(template("stock"));
    expect(seen).toContain("stock");
    expect(seen).toContain("tasks");
    expect(seen).not.toContain("sales");
    expect(seen).not.toContain("customers");
    expect(seen).not.toContain("promos");
  });

  it("cashier sees sales but not the store inbox", () => {
    const seen = keys(template("cashier"));
    expect(seen).toContain("sales");
    expect(seen).not.toContain("customers");
    expect(seen).not.toContain("stock");
  });

  it("marketer sees promos and messages, not sales", () => {
    const seen = keys(template("marketing"));
    expect(seen).toEqual(expect.arrayContaining(["promos", "customers", "tasks"]));
    expect(seen).not.toContain("sales");
  });

  it("tasks are visible to every member — a job nobody can see is not a job", () => {
    expect(keys({})).toEqual(["tasks"]);
  });

  it("asks the database only for numbers the viewer may see", () => {
    const needs = dashNeeds(template("stock"));
    expect(needs).toEqual({ sales: false, stock: true, tasks: true, promos: false, customers: false });
  });
});

describe("dashboard labels", () => {
  const dash = en.cabinetDashboard as unknown as Record<string, Record<string, string>>;

  it("every tile has a label and a hub caption", () => {
    for (const def of DASH_DEFS) {
      expect(dash.tile[def.key], `tile label for ${def.key}`).toBeTruthy();
      expect(
        (en.business as unknown as { dashboard: { part: Record<string, string> } }).dashboard.part[def.key],
        `hub caption for ${def.key}`,
      ).toBeTruthy();
    }
  });

  it("has no labels for tiles that no longer exist", () => {
    const live = new Set(DASH_DEFS.map((d) => d.key));
    for (const key of Object.keys(dash.tile)) expect(live.has(key as never)).toBe(true);
  });
});

describe("reorder threshold", () => {
  it("threshold is reached when the shelf holds no more than asked", () => {
    expect(belowThreshold({ onHand: 5, minQty: 10 })).toBe(true);
    expect(belowThreshold({ onHand: 10, minQty: 10 })).toBe(true);
    expect(belowThreshold({ onHand: 11, minQty: 10 })).toBe(false);
  });
});
