import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import en from "../messages/en.json";
import {
  CABINET_TILES,
  CABINET_COLOR_KEYS,
  CABINET_HASH_ALIASES,
  cabinetColorKey,
  visibleCabinetTiles,
} from "../src/lib/cabinet/personal-nav";
import { ADMIN_SECTIONS } from "../src/lib/admin-sections";
import { isSectionKey, readSectionColors } from "../src/lib/section-colors";

function lookup(path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[key];
  }, en as unknown);
}

const pageFor = (path: string) =>
  resolve(__dirname, "..", "src/app/[locale]/cabinet", path, "page.tsx");

describe("карта личного кабинета", () => {
  it("у каждой плитки есть подпись в переводах", () => {
    for (const tile of CABINET_TILES) {
      expect(typeof lookup(tile.labelKey), `${tile.key} → ${tile.labelKey}`).toBe("string");
      if (tile.hintKey) {
        expect(typeof lookup(tile.hintKey), `${tile.key} → ${tile.hintKey}`).toBe("string");
      }
    }
  });

  // Плитка без страницы — это дверь в стену: человек нажимает и получает 404.
  it("у каждой плитки есть своя страница", () => {
    for (const tile of CABINET_TILES) {
      if (tile.external) continue;
      expect(existsSync(pageFor(tile.path)), `${tile.key} → ${tile.path}`).toBe(true);
    }
  });

  it("правка профиля из шапки ведёт на существующую страницу", () => {
    expect(existsSync(pageFor("profile"))).toBe(true);
  });

  it("ключей и путей по два не бывает", () => {
    expect(new Set(CABINET_TILES.map((t) => t.key)).size).toBe(CABINET_TILES.length);
    expect(new Set(CABINET_TILES.map((t) => t.path)).size).toBe(CABINET_TILES.length);
  });

  it("служебные плитки видит только сотрудник", () => {
    const guest = visibleCabinetTiles(false).map((t) => t.key);
    expect(guest).not.toContain("admin");
    expect(visibleCabinetTiles(true).map((t) => t.key)).toContain("admin");
  });

  // Слайс BT: язык, валюта, тема, пароль, фактор и сеансы — это всё «я», и
  // живут они в профиле. Своя плитка вернула бы вторую дверь к одному предмету.
  it("у настроек и второго фактора своих плиток нет", () => {
    const keys = CABINET_TILES.map((t) => t.key);
    expect(keys).not.toContain("settings");
    expect(keys).not.toContain("mfa");
  });

  it("прежние якоря настроек и фактора ведут в профиль, к своему месту", () => {
    expect(CABINET_HASH_ALIASES.settings).toBe("profile#settings");
    expect(CABINET_HASH_ALIASES.mfa).toBe("profile#security");
  });

  it("старый якорь ведёт на существующую плитку или на профиль", () => {
    for (const [hash, target] of Object.entries(CABINET_HASH_ALIASES)) {
      const path = target.split("#")[0];
      const known = path === "profile" || CABINET_TILES.some((t) => t.path === path);
      expect(known, `#${hash} → ${target}`).toBe(true);
    }
  });
});

describe("ключи цвета кабинета", () => {
  // Без приставки цвет своей компании красил бы администраторскую очередь
  // компаний: у админки есть и `companies`, и `coins`.
  it("не сталкиваются с разделами админки", () => {
    const admin = new Set<string>(ADMIN_SECTIONS.map((s) => s.key));
    for (const key of CABINET_COLOR_KEYS) {
      expect(key.startsWith("cab:"), key).toBe(true);
      expect(admin.has(key), key).toBe(false);
    }
  });

  it("известны проверке на запись", () => {
    expect(isSectionKey(cabinetColorKey("alerts"))).toBe(true);
    expect(isSectionKey("cab:nosuch")).toBe(false);
  });

  it("чужой ключ из базы читается как отсутствующий", () => {
    expect(readSectionColors({ "cab:alerts": "red", "cab:nosuch": "red", queues: "teal" })).toEqual(
      { "cab:alerts": "red", queues: "teal" },
    );
  });
});
