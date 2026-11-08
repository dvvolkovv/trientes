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

const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
// A raw HTML sink: the JSX attribute or an object key, not the word in a comment.
const RAW_HTML_SINK = /\bdangerouslySetInnerHTML\b["']?(?=\s*[=:])/g;
// The only sink allowed outside the allowlist: JSON-LD passed straight through
// serializeJsonLd. A variable, a wrapper or a concatenation in between is not.
const SAFE_SINK = /^\s*=\s*\{\{\s*__html\s*:\s*serializeJsonLd\(/;
// Raw HTML that is not JSON-LD: expandable-description.tsx renders the output
// of sanitizeDescription (tests/sanitize.test.ts).
const RAW_HTML_ALLOWLIST = new Map([
  [path.join("src", "components", "coin-detail", "expandable-description.tsx"), 1],
]);

/** Line numbers of raw HTML sinks in source that are not serializeJsonLd(...). */
function unsafeSinks(source: string): number[] {
  return [...source.matchAll(RAW_HTML_SINK)]
    .filter((match) => !SAFE_SINK.test(source.slice(match.index + match[0].length)))
    .map((match) => source.slice(0, match.index).split("\n").length);
}

function sourceFiles(): string[] {
  return readdirSync(path.join(root, "src"), { recursive: true, encoding: "utf8" })
    .filter((file) => SOURCE_FILE.test(file))
    .map((file) => path.join("src", file));
}

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

// The check itself: a check that cannot fail proves nothing about src.
describe("unsafeSinks", () => {
  it.each([
    "<script dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />",
    "<script dangerouslySetInnerHTML={{ __html : JSON.stringify(ld) }} />",
    "<script dangerouslySetInnerHTML={{ __html: String(JSON.stringify(ld)) }} />",
    "const json = JSON.stringify(ld);\n<script dangerouslySetInnerHTML={{ __html: json }} />",
    "<script dangerouslySetInnerHTML={{ __html: serializeJsonLd }} />",
    "<script {...{ dangerouslySetInnerHTML: { __html: serializeJsonLd(ld) } }} />",
    'createElement("script", { "dangerouslySetInnerHTML": { __html: html } })',
    "<div dangerouslySetInnerHTML = {{ __html: html }} />",
  ])("flags %s", (source) => {
    expect(unsafeSinks(source)).toHaveLength(1);
  });

  it.each([
    "<script dangerouslySetInnerHTML={{ __html: serializeJsonLd(ld) }} />",
    "<script\n  dangerouslySetInnerHTML={{\n    __html : serializeJsonLd(ld),\n  }}\n/>",
    "// rendered as text, not through dangerouslySetInnerHTML — on purpose",
  ])("accepts %s", (source) => {
    expect(unsafeSinks(source)).toEqual([]);
  });

  it("reports the line of each sink", () => {
    const source = "a\n<p dangerouslySetInnerHTML={{ __html: x }} />\nb\n<p dangerouslySetInnerHTML={{ __html: y }} />";
    expect(unsafeSinks(source)).toEqual([2, 4]);
  });
});

describe("raw HTML in src", () => {
  it("goes through serializeJsonLd outside the allowlist", () => {
    const files = sourceFiles();
    // Not vacuous: the walk reaches the pages that emit JSON-LD.
    expect(files).toContain(path.join("src", "app", "[locale]", "coin", "[slug]", "page.tsx"));

    const offenders = files
      .filter((file) => !RAW_HTML_ALLOWLIST.has(file))
      .flatMap((file) =>
        unsafeSinks(readFileSync(path.join(root, file), "utf8")).map((line) => `${file}:${line}`),
      );
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist to the sinks it was written for", () => {
    const files = new Set(sourceFiles());
    for (const [file, sinks] of RAW_HTML_ALLOWLIST) {
      expect(files.has(file), file).toBe(true);
      expect(unsafeSinks(readFileSync(path.join(root, file), "utf8")), file).toHaveLength(sinks);
    }
  });
});
