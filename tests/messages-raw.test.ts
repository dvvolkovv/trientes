import { describe, expect, it } from "vitest";
import { rawMessage } from "@/lib/messages-raw";

describe("rawMessage", () => {
  it("читает английскую строку по точечному пути", async () => {
    const text = await rawMessage("en", "common.cabinet");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain("common.cabinet");
  });

  it("неизвестная локаль сводится к поддерживаемой", async () => {
    expect(await rawMessage("zz", "common.cabinet")).toBe(await rawMessage("en", "common.cabinet"));
  });

  it("подставляет переменные", async () => {
    const text = await rawMessage("en", "__test__", { name: "Alpha" }, "Point {name} is fine");
    expect(text).toBe("Point Alpha is fine");
  });

  it("неизвестный ключ отдаёт запасной текст, а не путь", async () => {
    expect(await rawMessage("en", "no.such.key", {}, "fallback")).toBe("fallback");
  });
});
