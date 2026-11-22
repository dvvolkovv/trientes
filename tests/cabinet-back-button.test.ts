import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * У каждого раздела кабинета предприятия сверху есть возврат в кабинет.
 *
 * Просьба владельца дословно: «мне нужно, чтобы в каждом разделе, когда я туда
 * попадаю, была такая кнопочка сверху». Разделов восемнадцать, и забытый в
 * девятнадцатом она заметна только тому, кто туда зайдёт, — поэтому граница
 * здесь, а не в глазах. Тот же приём, что `tests/outbound-timeouts.test.ts`:
 * читаем исходники и называем файл, в котором кнопки нет.
 */

const ROOT = join(process.cwd(), "src/app/[locale]/cabinet/companies/[id]");

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

describe("возврат в кабинет", () => {
  it("стоит на каждой странице кабинета предприятия", () => {
    const files = pages(ROOT);
    expect(files.length).toBeGreaterThan(10);
    const without = files
      .filter((f) => !readFileSync(f, "utf-8").includes("<CabinetBackButton"))
      .map((f) => f.slice(process.cwd().length + 1));
    expect(without).toEqual([]);
  });

  it("ведёт в кабинет, а не на шаг назад: шаг назад — это хлебные крошки", () => {
    const src = readFileSync(join(process.cwd(), "src/components/cabinet/company-back.tsx"), "utf-8");
    expect(src).toContain("/cabinet`");
  });
});
