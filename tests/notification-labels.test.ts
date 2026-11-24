import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Граница: у каждого вида звонка сотруднику есть подпись в интерфейсе и строка
 * для Telegram, и подписей для исчезнувших видов нет.
 *
 * Слайс CI нашёл это живым чтением файлов: `ACCESS_REVIEW_DUE` (слайс AS) и
 * `PRODUCT_REPORTED` (BB) подписи не имели вовсе — на экране колокольчика
 * стояло бы имя ключа. Та же болезнь, что `TASK_CREATED` кодом в живом прогоне
 * BF и поля различий рекламы в CE.
 */

const schema = readFileSync("prisma/schema.prisma", "utf8");
const notify = readFileSync("src/lib/cases/admin-notify.ts", "utf8");
const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as {
  admin: { bell: { kinds: Record<string, string> } };
};

function enumValues(name: string): string[] {
  const m = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
  if (m === null) throw new Error(`enum ${name} not found`);
  return m[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").replace(/\/\/\/.*$/, "").trim())
    .filter((line) => /^[A-Z_]+$/.test(line));
}

describe("AdminNotificationKind labels", () => {
  const kinds = enumValues("AdminNotificationKind");

  it("их больше восьми — enum прочитан, а не пуст", () => {
    expect(kinds.length).toBeGreaterThan(8);
  });

  it("у каждого вида есть подпись на экране колокольчика", () => {
    const missing = kinds.filter((k) => !(k in en.admin.bell.kinds));
    expect(missing).toEqual([]);
  });

  it("подписей для исчезнувших видов нет", () => {
    const extra = Object.keys(en.admin.bell.kinds).filter((k) => !kinds.includes(k));
    expect(extra).toEqual([]);
  });

  it("у каждого вида есть строка для Telegram", () => {
    const missing = kinds.filter((k) => !notify.includes(`${k}:`));
    expect(missing).toEqual([]);
  });
});
