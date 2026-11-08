import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
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
// Names through which a string becomes markup. Any identifier or string literal
// with one of these names counts, so an object key, a computed key or a spread
// props object is a sink too; a comment is not part of the syntax tree.
const RAW_HTML_NAMES = new Set([
  "dangerouslySetInnerHTML",
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "createContextualFragment",
  "setHTMLUnsafe",
  "parseHTMLUnsafe",
]);
// Raw HTML that is not JSON-LD: expandable-description.tsx renders the output
// of sanitizeDescription (tests/sanitize.test.ts); crypto-navigator.tsx builds
// map popups with escapeHtml and safeHttpUrl.
const RAW_HTML_ALLOWLIST = new Map([
  [path.join("src", "components", "coin-detail", "expandable-description.tsx"), 1],
  [path.join("src", "components", "coin-detail", "crypto-navigator.tsx"), 3],
]);

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  return /\.[cm]?ts$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
}

/**
 * The only sink allowed outside the allowlist: JSON-LD passed straight through
 * serializeJsonLd, `dangerouslySetInnerHTML={{ __html: serializeJsonLd(value) }}`.
 * A variable, a wrapper, a method call or a concatenation in between is not.
 */
function isJsonLdSink(attribute: ts.JsxAttribute): boolean {
  const expression = attribute.initializer && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
  if (!expression || !ts.isObjectLiteralExpression(expression)) return false;
  if (expression.properties.length !== 1) return false;
  const [property] = expression.properties;
  if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return false;
  if (property.name.text !== "__html") return false;
  const value = property.initializer;
  return (
    ts.isCallExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === "serializeJsonLd" &&
    value.arguments.length === 1 &&
    !ts.isSpreadElement(value.arguments[0])
  );
}

/** Line numbers of raw HTML sinks in source that are not serializeJsonLd(...). */
function unsafeSinks(source: string, fileName = "source.tsx"): number[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const lines: number[] = [];
  const report = (node: ts.Node) =>
    lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "dangerouslySetInnerHTML") {
      if (!isJsonLdSink(node)) report(node);
      if (node.initializer) visit(node.initializer);
      return;
    }
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && RAW_HTML_NAMES.has(node.text)) {
      report(node);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "document" &&
      (node.name.text === "write" || node.name.text === "writeln")
    ) {
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
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
    "<script dangerouslySetInnerHTML={{ __html: serializeJsonLd(ld) + raw }} />",
    '<script dangerouslySetInnerHTML={{ __html: serializeJsonLd(ld).replace("a", "<") }} />',
    "<script dangerouslySetInnerHTML={{ __html: serializeJsonLd(...args) }} />",
    "<script dangerouslySetInnerHTML={{ ...props, __html: serializeJsonLd(ld) }} />",
    "<script dangerouslySetInnerHTML={props} />",
    "<script {...{ dangerouslySetInnerHTML: { __html: serializeJsonLd(ld) } }} />",
    'createElement("script", { "dangerouslySetInnerHTML": { __html: html } })',
    'props["dangerouslySetInnerHTML"] = { __html: html };',
    "<div dangerouslySetInnerHTML = {{ __html: html }} />",
    "element.innerHTML = html;",
    'element["outerHTML"] = html;',
    'element.insertAdjacentHTML("beforeend", html);',
    "range.createContextualFragment(html);",
    "document.write(html);",
  ])("flags %s", (source) => {
    expect(unsafeSinks(source)).toHaveLength(1);
  });

  it.each([
    "<script dangerouslySetInnerHTML={{ __html: serializeJsonLd(ld) }} />",
    "<script\n  dangerouslySetInnerHTML={{\n    __html : serializeJsonLd(ld),\n  }}\n/>",
    "// rendered as text, not through dangerouslySetInnerHTML — on purpose",
    "/* element.innerHTML = html */",
    'const note = "never use innerHTML here";',
    "element.textContent = text; stream.write(text);",
  ])("accepts %s", (source) => {
    expect(unsafeSinks(source)).toEqual([]);
  });

  it("parses plain TypeScript, where <T>value is a type assertion", () => {
    expect(unsafeSinks("const node = <HTMLElement>target;\nnode.innerHTML = html;", "source.ts")).toEqual([2]);
  });

  it("reports the line of each sink", () => {
    const source = "a;\n<p dangerouslySetInnerHTML={{ __html: x }} />;\nb;\n<p dangerouslySetInnerHTML={{ __html: y }} />;";
    expect(unsafeSinks(source)).toEqual([2, 4]);
  });
});

describe("raw HTML in src", () => {
  const sinksIn = (file: string) => unsafeSinks(readFileSync(path.join(root, file), "utf8"), file);

  it("goes through serializeJsonLd outside the allowlist", () => {
    const files = sourceFiles();
    // Not vacuous: the walk reaches the pages that emit JSON-LD.
    expect(files).toContain(path.join("src", "app", "[locale]", "coin", "[slug]", "page.tsx"));

    const offenders = files
      .filter((file) => !RAW_HTML_ALLOWLIST.has(file))
      .flatMap((file) => sinksIn(file).map((line) => `${file}:${line}`));
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist to the sinks it was written for", () => {
    const files = new Set(sourceFiles());
    for (const [file, sinks] of RAW_HTML_ALLOWLIST) {
      expect(files.has(file), file).toBe(true);
      expect(sinksIn(file), file).toHaveLength(sinks);
    }
  });
});
