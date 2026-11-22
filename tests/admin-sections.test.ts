import { describe, it, expect } from "vitest";
import en from "../messages/en.json";
import {
  ADMIN_SECTIONS,
  SECTION_COLORS,
  SECTION_COLOR_KEYS,
  readSectionColors,
  sectionColorHex,
  isAdminSectionKey,
  isSectionColorKey,
  STATUS_FILTER_COLORS,
  statusFilterHex,
} from "../src/lib/admin-sections";
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
  it("у каждого цвета есть имя в переводах", () => {
    for (const key of SECTION_COLOR_KEYS) {
      expect(typeof lookup(`appearance.colors.${key}`), key).toBe("string");
    }
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
