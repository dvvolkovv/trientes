import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/lib/locales";

/** Messages shown when the map cannot run; `mentions` is a word the text must contain. */
const KEYS: { namespace: string; key: string; mentions?: string }[] = [
  { namespace: "cryptoMap", key: "mapUnavailable", mentions: "WebGL2" },
  { namespace: "business", key: "mapUnavailable", mentions: "WebGL2" },
  // Geocoding failed and there is no map to place the pin on by hand.
  { namespace: "business", key: "geocodingFailedNoMap" },
];

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
    expect(shipped).toEqual([...SUPPORTED_LOCALES].sort());
  });

  const en = load("en");
  for (const locale of SUPPORTED_LOCALES) {
    for (const { namespace, key, mentions } of KEYS) {
      it(`${locale}: ${namespace}.${key} is a real translation`, () => {
        const value = load(locale)[namespace]?.[key];
        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(20);
        if (mentions) expect(value).toContain(mentions);
        if (locale !== "en") expect(value).not.toBe(en[namespace][key]);
      });
    }

    it(`${locale}: business.geocodingFailedNoMap is not the "place the pin on the map" hint`, () => {
      const business = load(locale).business;
      expect(business.geocodingFailedNoMap).not.toBe(business.geocodingFailed);
    });
  }
});
