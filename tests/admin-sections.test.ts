import { describe, it, expect } from "vitest";
import en from "../messages/en.json";
import { ADMIN_SECTIONS, isAdminSectionKey } from "../src/lib/admin-sections";
import { SECTION_COLORS, SECTION_COLOR_KEYS, readSectionColors, sectionColorHex, isSectionColorKey, STATUS_FILTER_COLORS, statusFilterHex } from "../src/lib/section-colors";
import { adminChoiceLook } from "../src/lib/admin-ui";
import { ADMIN_TABS } from "../src/lib/admin-tabs";
import { QUEUES } from "../src/lib/cases/queues";

function lookup(path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[key];
  }, en.admin as unknown);
}

describe("реестр разделов админки", () => {
  it("каждая закладка полосы есть в реестре", () => {
    for (const tab of ADMIN_TABS) {
      expect(ADMIN_SECTIONS.some((s) => s.key === tab.key), tab.key).toBe(true);
    }
  });

  it("каждая очередь есть в реестре", () => {
    for (const q of QUEUES) {
      expect(ADMIN_SECTIONS.some((s) => s.key === q.key), q.key).toBe(true);
    }
  });

  it("у каждого раздела есть подпись в переводах", () => {
    for (const s of ADMIN_SECTIONS) {
      expect(typeof lookup(s.labelKey), `${s.key} → ${s.labelKey}`).toBe("string");
    }
  });

  it("в реестре нет повторов ключа", () => {
    expect(new Set(ADMIN_SECTIONS.map((s) => s.key)).size).toBe(ADMIN_SECTIONS.length);
  });
});

describe("палитра", () => {
  // Имена цветов живут в `common`: они служат и админке, и кабинету.
  it("у каждого цвета есть имя в переводах", () => {
    const colors = (en.common as Record<string, unknown>).colors as Record<string, unknown>;
    for (const key of SECTION_COLOR_KEYS) {
      expect(typeof colors?.[key], key).toBe("string");
    }
    expect(typeof colors?.none).toBe("string");
  });

  it("два цвета не совпадают значением", () => {
    const values = Object.values(SECTION_COLORS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("чтение словаря", () => {
  it("чужие ключи и цвета вне палитры отбрасываются", () => {
    expect(
      readSectionColors({ queues: "red", nosuch: "red", staff: "#ff0000", audit: "violet" }),
    ).toEqual({ queues: "red", audit: "violet" });
  });

  it("негодное значение читается как пустой словарь", () => {
    expect(readSectionColors(null)).toEqual({});
    expect(readSectionColors(["red"])).toEqual({});
    expect(readSectionColors("red")).toEqual({});
  });

  it("цвет отдаётся только известному разделу", () => {
    const colors = readSectionColors({ queues: "teal" });
    expect(sectionColorHex(colors, "queues")).toBe(SECTION_COLORS.teal);
    expect(sectionColorHex(colors, "staff")).toBeNull();
    expect(sectionColorHex(colors, "nosuch")).toBeNull();
  });

  it("охранники ключей", () => {
    expect(isAdminSectionKey("queues")).toBe(true);
    expect(isAdminSectionKey("nosuch")).toBe(false);
    expect(isSectionColorKey("red")).toBe(true);
    expect(isSectionColorKey("#ff0000")).toBe(false);
  });
});

describe("цвет состояния заявки", () => {
  it("каждое состояние красится цветом из палитры", () => {
    for (const [status, color] of Object.entries(STATUS_FILTER_COLORS)) {
      expect(SECTION_COLOR_KEYS, status).toContain(color);
      expect(statusFilterHex(status)).toBe(SECTION_COLORS[color]);
    }
  });

  it("отклонённое — красное, одобренное — зелёное", () => {
    expect(statusFilterHex("rejected")).toBe(SECTION_COLORS.red);
    expect(statusFilterHex("approved")).toBe(SECTION_COLORS.green);
  });

  it("состоянию вне списка цвета нет", () => {
    expect(statusFilterHex("deleted")).toBeNull();
  });
});

describe("яркость контура у нажатой кнопки", () => {
  it("цветная: нажатая несёт полный цвет и второй контур, ненажатая — вполсилы", () => {
    const hex = SECTION_COLORS.red;
    const on = adminChoiceLook(hex, true);
    const off = adminChoiceLook(hex, false);
    expect(on.style?.borderColor).toBe(hex);
    expect(String(on.style?.boxShadow)).toContain(hex);
    expect(off.style?.borderColor).toBe(`${hex}8c`);
    expect(off.style?.boxShadow).toBeUndefined();
  });

  it("без цвета: нажатая тоже получает второй контур", () => {
    expect(adminChoiceLook(null, true).className).toContain("shadow-[0_0_0_1px");
    expect(adminChoiceLook(null, false).className).not.toContain("shadow-");
  });

  it("толщина рамки у обоих состояний одна — строка не дёргается", () => {
    for (const hex of [null, SECTION_COLORS.teal]) {
      for (const active of [true, false]) {
        expect(adminChoiceLook(hex, active).className).not.toContain("border-2");
      }
    }
  });
});
