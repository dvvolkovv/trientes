import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Заголовок раздела кабинета печатается **один раз**.
 *
 * `CabinetSectionShell` печатает `<h1>` с названием раздела, а секции печатали свой
 * `<h2>` с тем же ключом — и человек читал «Подписки · Подписки». Владелец заметил
 * это глазом в подписках, но болезнь была во всех разделах сразу.
 *
 * Тест читает исходники (приём `tests/outbound-timeouts.test.ts` и
 * `tests/cabinet-back-button.test.ts`): проверить это рантаймом нельзя — секции
 * серверные и тянут базу, — а забытый `<h2>` в новом разделе увидит только тот,
 * кто туда зайдёт.
 */

const PAGES_ROOT = "src/app/[locale]/cabinet";
const COMPONENTS = "src/components/cabinet";

/**
 * Секции, чей `<h2>` дублем **не является**: они живут внутри страницы профиля
 * (решение BT — «настройки и безопасность внутри профиля»), и заголовок раздела
 * несут по праву. Имя человека в шапке профиля — тем более не заголовок раздела.
 */
const NESTED = new Set(["settings-section", "security-section", "profile-header", "profile-section"]);

function pagesUsingShell(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      pagesUsingShell(path, out);
      continue;
    }
    if (entry !== "page.tsx") continue;
    const src = readFileSync(path, "utf8");
    if (src.includes("CabinetSectionShell")) out.push(path);
  }
  return out;
}

describe("заголовок раздела кабинета", () => {
  const pages = pagesUsingShell(PAGES_ROOT);

  it("оболочку используют все разделы, иначе тест ничего не проверяет", () => {
    expect(pages.length).toBeGreaterThan(5);
  });

  it("секция под оболочкой не печатает свой заголовок тем же ключом", () => {
    const offenders: string[] = [];
    for (const page of pages) {
      const src = readFileSync(page, "utf8");
      // Какие секции эта страница рисует: по импортам из каталога секций.
      const imports = [...src.matchAll(/from "@\/components\/cabinet\/([a-z0-9-]+)"/g)].map((m) => m[1]);
      for (const name of imports) {
        if (NESTED.has(name)) continue;
        const file = join(COMPONENTS, `${name}.tsx`);
        let body: string;
        try {
          body = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        // Заголовок секции — это `<h2>` с названием, то есть `t("title")` или
        // `t("myTitle")`. Прочие `<h2>` внутри секции (подзаголовки блоков) —
        // не дубль и остаются.
        if (/<h2[^>]*>\{t\("(title|myTitle)"\)\}/.test(body)) {
          offenders.push(`${file} (страница ${page})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
