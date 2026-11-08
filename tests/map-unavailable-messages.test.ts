import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = ["de", "en", "es", "fr", "ja", "ko", "pt-BR", "ru", "tr", "zh-CN"];
const KEYS = [
  ["cryptoMap", "mapUnavailable"],
  ["business", "mapUnavailable"],
] as const;

type Messages = Record<string, Record<string, unknown>>;

function load(locale: string): Messages {
  return JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8")) as Messages;
}

describe("map-unavailable fallback messages", () => {
  it("covers every shipped locale", () => {
    const shipped = readdirSync(path.join(process.cwd(), "messages"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
    expect(shipped).toEqual([...LOCALES].sort());
  });

  const en = load("en");
  for (const locale of LOCALES) {
    for (const [namespace, key] of KEYS) {
      it(`${locale}: ${namespace}.${key} is a real translation`, () => {
        const value = load(locale)[namespace]?.[key];
        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(20);
        expect(value).toContain("WebGL2");
        if (locale !== "en") expect(value).not.toBe(en[namespace][key]);
      });
    }
  }
});
