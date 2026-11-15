import { describe, expect, it } from "vitest";
import { footerActions } from "@/lib/poi-sheet-actions";

describe("footerActions", () => {
  it("never shows the same label twice", () => {
    for (const hasRoute of [false, true]) {
      const labels = footerActions(hasRoute).map((a) => a.labelKey);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("always offers the start button", () => {
    for (const hasRoute of [false, true]) {
      expect(footerActions(hasRoute).map((a) => a.key)).toContain("go");
    }
  });

  it("offers building a route only while there is none, and clearing only once there is", () => {
    expect(footerActions(false).map((a) => a.key)).toEqual(["routeHere", "go"]);
    expect(footerActions(true).map((a) => a.key)).toEqual(["go", "clearRoute"]);
  });

  it("keeps exactly one primary action in each state", () => {
    for (const hasRoute of [false, true]) {
      const primary = footerActions(hasRoute).filter((a) => a.kind === "primary");
      expect(primary).toHaveLength(1);
    }
    // Пока маршрута нет, главное действие — построить его; как только он есть,
    // главным становится «Поехали».
    expect(footerActions(false).find((a) => a.kind === "primary")?.key).toBe("routeHere");
    expect(footerActions(true).find((a) => a.kind === "primary")?.key).toBe("go");
  });
});
