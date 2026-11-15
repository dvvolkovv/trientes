import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TransitLeg } from "@/lib/crypto-map";
import { legSpans, transitCue } from "@/lib/transit-guidance";
import { transitCueText } from "@/components/coin-detail/transit-itinerary";

/**
 * Подсказка транспорта собирается из ключей перевода, и промах в ключе виден
 * не тестом, а человеком в вагоне: вместо «садитесь на метро A» он услышал бы
 * `nav.transit.board`. Поэтому фраза строится настоящим словарём, и каждый
 * ключ обязан в нём быть, а каждый плейсхолдер — быть подставленным.
 */
const messages = JSON.parse(
  readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
) as { cryptoMap: Record<string, unknown> };

function lookup(key: string): string | null {
  let node: unknown = messages.cryptoMap;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : null;
}

const missing: string[] = [];

function t(key: string, values?: Record<string, string | number>): string {
  const template = lookup(key);
  if (template === null) {
    missing.push(key);
    return key;
  }
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
}

const LAT = 50.09;
function east(m: number): [number, number] {
  return [m / ((Math.PI / 180) * 6_371_000 * Math.cos((LAT * Math.PI) / 180)), LAT];
}

function leg(i: Partial<TransitLeg> & { coordinates: [number, number][] }): TransitLeg {
  return {
    mode: "WALK",
    line: null,
    from: null,
    to: null,
    duration: 0,
    dashed: true,
    color: "#8a8f98",
    meters: 0,
    headsign: null,
    agency: null,
    fromPoint: null,
    toPoint: null,
    fromTrack: null,
    toTrack: null,
    startTime: null,
    endTime: null,
    realTime: false,
    stops: [],
    walkSteps: [],
    ...i,
  };
}

const legs: TransitLeg[] = [
  leg({ coordinates: [east(0), east(300)], meters: 300, to: "Staroměstská" }),
  leg({
    mode: "SUBWAY",
    dashed: false,
    line: "A",
    from: "Staroměstská",
    to: "Dejvická",
    fromTrack: "2",
    headsign: "Nemocnice Motol",
    coordinates: [east(300), east(600), east(1200)],
    stops: [{ name: "Malostranská", lat: LAT, lon: east(600)[0], arrival: null }],
  }),
  leg({ coordinates: [east(1200), east(1400)], meters: 200, from: "Dejvická" }),
];
const spans = legSpans(legs);
const phrase = (travelled: number) => transitCueText(transitCue({ travelled, legs, spans })!, t);

describe("transitCueText", () => {
  it("names the stop to walk to", () => {
    expect(phrase(50)).toBe("Walk 250 m to Staroměstská");
  });

  it("names the vehicle, the line, the direction and the platform", () => {
    const said = phrase(295);
    expect(said).toContain("Staroměstská");
    expect(said).toContain("the metro");
    expect(said).toContain("A");
    expect(said).toContain("Nemocnice Motol");
    expect(said).toContain("Platform 2");
  });

  it("says where to get off and how many stops are left", () => {
    expect(phrase(400)).toContain("get off at Dejvická");
    expect(phrase(400)).toContain("Stops: 2");
    expect(phrase(800)).toContain("Next stop is yours");
    expect(phrase(1190)).toBe("Get off here: Dejvická");
  });

  it("walks the last leg to the destination, not to a stop", () => {
    expect(phrase(1300)).toBe("Walk 100 m to your destination");
  });

  it("uses only keys that exist, with every placeholder filled", () => {
    const all = [50, 295, 400, 800, 1190, 1300].map(phrase);
    expect(missing).toEqual([]);
    for (const said of all) expect(said).not.toMatch(/[{}]/);
  });
});
