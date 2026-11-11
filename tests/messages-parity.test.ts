import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_LABELS } from "@/lib/locales";

/**
 * Границы файла переводов. Загрузчик (`src/i18n.ts`) подмешивает английский как
 * базу, поэтому пропущенный ключ не падает, а тихо выходит на сайт
 * по-английски — такой брак видит только пользователь. Этот тест видит его
 * раньше: новая локаль не считается добавленной, пока файл не повторяет форму
 * английского и не переведён на деле.
 */

type Node = string | string[] | Tree;
type Tree = { [k: string]: Node };

function flatten(node: Node, prefix: string, out: [string, string][]): void {
  if (typeof node === "string") {
    out.push([prefix, node]);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
    return;
  }
  for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
}

function load(locale: string): [string, string][] {
  const file = path.join(process.cwd(), "messages", `${locale}.json`);
  const out: [string, string][] = [];
  flatten(JSON.parse(readFileSync(file, "utf8")) as Tree, "", out);
  return out;
}

function placeholders(s: string): string {
  return (s.match(/\{[^}]+\}/g) ?? []).sort().join("|");
}

const en = load(DEFAULT_LOCALE);
const enMap = new Map(en);

/**
 * Доля строк, совпадающих с английским. Бренд, тикеры и «API» совпадают
 * законно, поэтому порог с запасом: у самой «английской» из живых локалей
 * (немецкой) это 11 %.
 */
const IDENTICAL_SHARE_MAX = 0.25;

describe("messages parity", () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(locale, () => {
      it("has a messages file", () => {
        expect(existsSync(path.join(process.cwd(), "messages", `${locale}.json`))).toBe(true);
      });

      it("has a label in the language switcher", () => {
        expect(LOCALE_LABELS[locale]?.trim().length).toBeGreaterThan(1);
      });

      if (locale === DEFAULT_LOCALE) return;

      const theirs = load(locale);
      const map = new Map(theirs);

      it("covers every English key", () => {
        expect(en.filter(([k]) => !map.has(k)).map(([k]) => k)).toEqual([]);
      });

      it("has no keys the English file lacks", () => {
        expect(theirs.filter(([k]) => !enMap.has(k)).map(([k]) => k)).toEqual([]);
      });

      it("keeps every placeholder of every string", () => {
        const broken = en
          .filter(([k, v]) => map.has(k) && placeholders(map.get(k) as string) !== placeholders(v))
          .map(([k]) => k);
        expect(broken).toEqual([]);
      });

      it("is actually translated, not an English copy", () => {
        const identical = en.filter(([k, v]) => map.get(k) === v).length;
        expect(identical / en.length).toBeLessThan(IDENTICAL_SHARE_MAX);
      });
    });
  }
});
