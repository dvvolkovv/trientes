import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * У каждой страницы, открытой из кабинета, сверху есть возврат в кабинет.
 *
 * Просьба владельца дословно: «мне нужно, чтобы в каждом разделе, когда я туда
 * попадаю, была такая кнопочка сверху… где-то есть, где-то нет». Страниц под
 * `/cabinet` три десятка, и забытая в новой заметна только тому, кто туда
 * зайдёт, — поэтому граница здесь, а не в глазах. Тот же приём, что
 * `tests/outbound-timeouts.test.ts`: читаем исходники и называем файл.
 *
 * Кнопку даёт либо оболочка разделов личного кабинета (`CabinetSectionShell`),
 * либо сам компонент. Исключения ровно два и оба честные: хаб кабинета — он и
 * есть то место, куда ведёт кнопка, и страница-перенаправление, у которой нет
 * своего вида вовсе.
 */

const ROOT = join(process.cwd(), "src/app/[locale]/cabinet");

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

const HUB = join(ROOT, "page.tsx");

/** Страница, которая только перенаправляет, своего верха не имеет. */
function isRedirectOnly(src: string): boolean {
  return /\b(permanentRedirect|redirect)\(/.test(src) && !src.includes("<main");
}

describe("возврат в кабинет", () => {
  it("стоит на каждой странице кабинета", () => {
    const files = pages(ROOT).filter((f) => f !== HUB);
    expect(files.length).toBeGreaterThan(25);
    const without = files
      .filter((f) => {
        const src = readFileSync(f, "utf-8");
        if (isRedirectOnly(src)) return false;
        return !src.includes("<CabinetBackButton") && !src.includes("CabinetSectionShell");
      })
      .map((f) => f.slice(process.cwd().length + 1));
    expect(without).toEqual([]);
  });

  it("ведёт в кабинет, а не на шаг назад: шаг назад — это хлебные крошки", () => {
    const src = readFileSync(join(process.cwd(), "src/components/cabinet/back-button.tsx"), "utf-8");
    expect(src).toContain("/cabinet`");
  });
});
