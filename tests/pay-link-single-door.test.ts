import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Одна дверь к номеру ссылки оплаты (задание, § 2.7).
 *
 * Права проверяются **на сервере, на каждом пути записи**, а не скрытием кнопки — и
 * путь записи должен быть ровно один. Поэтому границу держит тест по исходникам, как
 * `outbound-timeouts` и `cabinet-back-button`: админка, модератор, импорт или новое
 * действие, записавшее `companyPayLink` мимо калитки владельца, назовут себя по имени
 * файла, а не выйдут тихо в прод.
 */

const ROOT = join(__dirname, "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (p: string) => p.slice(join(__dirname, "..").length + 1).replace(/\\/g, "/");

/** Кто вправе писать строки приёма платежей. */
const WRITERS = new Set([
  // Хранилище слайса: установка, отложенная смена, отмена, удаление, сброс.
  "src/lib/pay-link/store.ts",
  // Суточная проверка и исполнение отложенной смены (воркер).
  "src/lib/pay-link/sweep.ts",
  // Единственное серверное действие: владелец, токен, правило.
  "src/app/actions/pay-link.ts",
]);

const WRITE = /prisma\.(companyPayLink|companyPayLinkPending|companyPayLinkCode)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/;

describe("одна дверь к ссылке оплаты", () => {
  const files = walk(ROOT);

  it("строки приёма платежей пишут только три названных файла", () => {
    const offenders = files.filter((f) => WRITE.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders.filter((f) => !WRITERS.has(f))).toEqual([]);
  });

  it("каждое действие записи спрашивает владельца и токен", () => {
    const src = readFileSync(join(ROOT, "app/actions/pay-link.ts"), "utf8");
    const mutating = ["issuePayLinkCode", "checkPayLink", "savePayLink", "cancelPayLinkChange", "removePayLink"];
    for (const name of mutating) {
      const at = src.indexOf(`export async function ${name}(`);
      expect(at, name).toBeGreaterThan(-1);
      // Тело до следующего экспорта: калитка и токен стоят первыми строками.
      const next = src.indexOf("\nexport ", at + 1);
      const body = src.slice(at, next === -1 ? undefined : next);
      expect(body.includes("requireOwnerOf("), `${name}: владелец`).toBe(true);
      expect(body.includes("checkCsrf("), `${name}: токен`).toBe(true);
    }
  });

  it("введённая строка не попадает в адрес: его собирает payHref", () => {
    // Сборка кнопки живёт в одном месте, и в карточку идёт только номер.
    const view = readFileSync(join(ROOT, "lib/company-card/view.ts"), "utf8");
    expect(view.includes("payHref(locale, company.payLink.linkId)")).toBe(true);
  });

  it("страница правки закрыта от встраивания во фрейм", () => {
    const config = readFileSync(join(__dirname, "..", "next.config.ts"), "utf8");
    expect(config.includes("/:locale/cabinet/companies/:id/payments")).toBe(true);
    expect(config.includes("frame-ancestors 'none'")).toBe(true);
    expect(config.includes("X-Frame-Options")).toBe(true);
  });
});
