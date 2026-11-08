import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "@/lib/json-ld";

const root = path.resolve(__dirname, "..");

// Every value here can be written by a company, a fintech or an external coin
// API, so each one must stay inside its <script type="application/ld+json">.
const PAYLOADS = [
  "</script><img src=x onerror=alert(1)>",
  "</SCRIPT ><script>alert(1)</script>",
  "<!-- <script>",
  "<script",
  "]]>",
  "line\u2028separator\u2029paragraph",
  "&amp; &lt;/script&gt; &#x3c;",
  "Криптовалюта «Талер»",
  "🚀 coin 🦄",
];

const VALUES: unknown[] = [
  ...PAYLOADS,
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: PAYLOADS[0],
    legalName: PAYLOADS[1],
    description: PAYLOADS.join(" "),
    logo: "https://example.com/logo.png?a=1&b=<2>",
  },
  {
    "@type": "BreadcrumbList",
    itemListElement: PAYLOADS.map((name, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: { [name]: [name, index, null, true] },
    })),
  },
];

const CASES = VALUES.map((value) => [JSON.stringify(value).slice(0, 60), value] as const);

const UNSAFE_OUTPUT = /[<>&\u2028\u2029]/;
// The pattern this module replaces: raw JSON inside an inline script element.
const UNSAFE_JSON_LD = /dangerouslySetInnerHTML=\{\{\s*__html:\s*JSON\.stringify\(/g;

describe("serializeJsonLd", () => {
  it.each(CASES)("round-trips %s",
    (_label, value) => {
      expect(JSON.parse(serializeJsonLd(value))).toEqual(value);
    },
  );

  it.each(CASES)("emits no character that can end the script element: %s",
    (_label, value) => {
      const json = serializeJsonLd(value);
      expect(json).not.toMatch(UNSAFE_OUTPUT);
      expect(json.toLowerCase()).not.toContain("</script");
      expect(json).not.toContain("<!--");
    },
  );

  it("escapes with JSON unicode escapes", () => {
    expect(serializeJsonLd({ name: "<a>&\u2028\u2029" })).toBe(
      '{"name":"\\u003ca\\u003e\\u0026\\u2028\\u2029"}',
    );
  });

  it("matches JSON.stringify for safe input", () => {
    const value = { "@type": "Thing", name: "Taler", position: 1, sameAs: ["https://x.org/a"] };
    expect(serializeJsonLd(value)).toBe(JSON.stringify(value));
  });

  it("omits undefined fields like JSON.stringify", () => {
    const value = { name: "x", description: undefined, list: [undefined, 1] };
    expect(serializeJsonLd(value)).toBe(JSON.stringify(value));
    expect(serializeJsonLd(value)).toBe('{"name":"x","list":[null,1]}');
  });

  it("throws for a value JSON cannot represent", () => {
    expect(() => serializeJsonLd(undefined)).toThrow(TypeError);
  });
});

describe("JSON-LD script elements", () => {
  it("never inline raw JSON.stringify output in src/**/*.tsx", () => {
    const files = readdirSync(path.join(root, "src"), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => path.join("src", file));
    // Not vacuous: the walk reaches the pages that emit JSON-LD.
    expect(files).toContain(path.join("src", "app", "[locale]", "coin", "[slug]", "page.tsx"));

    const offenders = files.flatMap((file) => {
      const source = readFileSync(path.join(root, file), "utf8");
      return [...source.matchAll(UNSAFE_JSON_LD)].map(
        (match) => `${file}:${source.slice(0, match.index).split("\n").length}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});
