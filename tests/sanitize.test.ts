import { DomUtils, parseDocument } from "htmlparser2";
import { describe, expect, it } from "vitest";
import { sanitizeDescription } from "@/lib/sanitize";

// Coin descriptions come from external APIs and are written by the projects
// themselves, so every byte here is attacker-controlled. The sanitizer may only
// ever emit the allowlist from src/lib/sanitize.ts.
const ALLOWED_TAGS = new Set([
  "a", "b", "i", "em", "strong", "p", "ul", "ol", "li", "br", "code", "blockquote",
]);
const ALLOWED_A_ATTRIBUTES = new Set(["href", "rel", "target"]);
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto"]);
const LINK_ATTRIBUTES = 'rel="noopener noreferrer nofollow" target="_blank"';

type ParsedNode = ReturnType<typeof parseDocument>["children"][number];

// The URL parser drops tab and newline characters anywhere and strips leading
// C0 controls and spaces before it reads the scheme.
function urlScheme(href: string): string | undefined {
  const url = href.replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+/, "");
  return /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)?.[1].toLowerCase();
}

/**
 * Asserts the sanitized HTML holds the allowlist, reading it back with an HTML
 * parser that decodes character references by the spec (in attributes too),
 * so `&#106;avascript:` or `java&Tab;script:` is seen as a browser sees it.
 * Text nodes are not checked: the serializer escapes them, and their words
 * ("javascript:", "onboarding=") are not markup.
 */
function expectInert(html: string): void {
  const pending: ParsedNode[] = [...parseDocument(html).children];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (DomUtils.isText(node)) continue;
    // Anything else but an element: comment (CDATA too, in HTML), processing
    // instruction, doctype.
    if (!DomUtils.isTag(node)) {
      throw new Error(`${node.type} node in ${html}`);
    }
    expect(ALLOWED_TAGS.has(node.name), `tag ${node.name} in ${html}`).toBe(true);
    for (const [attribute, value] of Object.entries(node.attribs)) {
      expect(
        node.name === "a" && ALLOWED_A_ATTRIBUTES.has(attribute),
        `attribute ${attribute} on ${node.name} in ${html}`,
      ).toBe(true);
      if (attribute !== "href") continue;
      const scheme = urlScheme(value);
      // No scheme: a relative URL.
      if (scheme !== undefined) {
        expect(ALLOWED_SCHEMES.has(scheme), `href ${JSON.stringify(value)} in ${html}`).toBe(true);
      }
    }
    pending.push(...node.children);
  }
}

// The check itself: a test that cannot fail proves nothing about the sanitizer.
describe("expectInert", () => {
  it.each([
    '<a href="&#106;avascript:x">x</a>',
    '<a href="javascript&colon;x">',
    '<a href="java&Tab;script:x">',
    '<a href="&#x6A;avascript:x">',
    '<a href="JAVASCRIPT:x">',
    '<a href=" javascript:x">',
    '<a href="\u0001javascript:x">',
    '<a href="\njava\tscript:x">',
    "<img src=x>",
    '<a onclick="x">',
    '<a title="x">x</a>',
    '<p style="color:red">x</p>',
    "<!-- x -->",
    "<?x?>",
    "<!DOCTYPE html>",
    "<![CDATA[x]]>",
  ])("rejects %s", (html) => {
    expect(() => expectInert(html)).toThrow();
  });

  it.each([
    "<p>Never paste javascript: URLs</p>",
    `<a href="https://x.org/?bonus=1" ${LINK_ATTRIBUTES}>x</a>`,
    "<p>set onboarding=true</p>",
  ])("accepts %s", (html) => {
    expect(() => expectInert(html)).not.toThrow();
  });
});

describe("sanitizeDescription — allowed markup", () => {
  it("keeps the allowed tags and their text", () => {
    const html =
      "<p>Hello <b>bold</b> <i>it</i> <em>em</em> <strong>s</strong> <code>c</code></p>" +
      "<ul><li>a</li></ul><ol><li>b</li></ol><br><blockquote>q</blockquote>";
    const out = sanitizeDescription(html);
    expect(out).toBe(
      "<p>Hello <b>bold</b> <i>it</i> <em>em</em> <strong>s</strong> <code>c</code></p>" +
        "<ul><li>a</li></ul><ol><li>b</li></ol><br /><blockquote>q</blockquote>",
    );
    expectInert(out);
  });

  it("keeps text entity-escaped", () => {
    expect(sanitizeDescription("<p>5 &lt; 6 &amp; 7 > 3</p>")).toBe("<p>5 &lt; 6 &amp; 7 &gt; 3</p>");
  });

  it("opens an https link in a new tab without opener or referrer", () => {
    const out = sanitizeDescription('<a href="https://x">link</a>');
    expect(out).toBe(`<a href="https://x" ${LINK_ATTRIBUTES}>link</a>`);
    expectInert(out);
  });

  it("overrides rel and target set by the author", () => {
    expect(sanitizeDescription('<a href="https://x" rel="opener" target="_self">x</a>')).toBe(
      `<a href="https://x" ${LINK_ATTRIBUTES}>x</a>`,
    );
  });

  it("keeps http and mailto links", () => {
    expect(sanitizeDescription('<a href="http://x/a?b=1&c=2">x</a>')).toBe(
      `<a href="http://x/a?b=1&amp;c=2" ${LINK_ATTRIBUTES}>x</a>`,
    );
    expect(sanitizeDescription('<a href="mailto:team@x.org">m</a>')).toBe(
      `<a href="mailto:team@x.org" ${LINK_ATTRIBUTES}>m</a>`,
    );
  });
});

describe("sanitizeDescription — dangerous link schemes", () => {
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "\u0001javascript:alert(1)",
    "java\nscript:alert(1)",
    "jav&#x09;ascript:alert(1)",
    "jav&#9;ascript:alert(1)",
    "&#106;avascript:alert(1)",
    "&#x6A;avascript&#58;alert(1)",
    "javascript&colon;alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    " data:text/html,<script>alert(1)</script>",
    "DATA:text/html,x",
    "vbscript:msgbox(1)",
    "VBScript:msgbox(1)",
  ])("drops href=%j and keeps the link text", (href) => {
    const out = sanitizeDescription(`<a href="${href}">x</a>`);
    expect(out).toBe(`<a ${LINK_ATTRIBUTES}>x</a>`);
    expectInert(out);
  });
});

describe("sanitizeDescription — dangerous elements and attributes", () => {
  it.each([
    ["script", "<script>alert(1)</script>after"],
    ["script with src", '<script src="https://evil.test/x.js"></script>after'],
    ["style", "<style>body{background:url(javascript:alert(1))}</style>after"],
    ["iframe", '<iframe src="javascript:alert(1)"></iframe>after'],
    ["iframe srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe>after'],
    ["img onerror", "<img src=x onerror=alert(1)>after"],
    ["svg onload", "<svg onload=alert(1)><circle r=1 /></svg>after"],
    ["form action", '<form action="javascript:alert(1)"><input type=submit></form>after'],
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">after'],
    ["object/embed", '<object data="javascript:alert(1)"></object><embed src="javascript:alert(1)">after'],
    ["math xlink:href", '<math><mi xlink:href="javascript:alert(1)">after</mi></math>'],
    ["html comment", "<!-- <script>alert(1)</script> -->after"],
    ["nested script", "<scr<script>ipt>alert(1)</script>after"],
  ])("removes %s", (_name, html) => {
    const out = sanitizeDescription(html);
    expect(out).toContain("after");
    expectInert(out);
  });

  it("removes on* and style attributes from allowed tags", () => {
    expect(sanitizeDescription('<p onmouseover="alert(1)" style="color:red">p</p>')).toBe("<p>p</p>");
    expect(
      sanitizeDescription(
        '<a href="https://x" onclick="alert(1)" onfocus=alert(2) style="x" title="t" id="i">x</a>',
      ),
    ).toBe(`<a href="https://x" ${LINK_ATTRIBUTES}>x</a>`);
  });

  it("drops a non-allowed element nested in a link", () => {
    const out = sanitizeDescription('<a href="https://x"><img src=x onerror=alert(1)>t</a>');
    expect(out).toBe(`<a href="https://x" ${LINK_ATTRIBUTES}>t</a>`);
  });
});

// Payloads from the sanitize-html advisories fixed in 2.17.5–2.18.0. Each needs
// a non-default allowlist to bite; these check that ours never lets them through.
describe("sanitizeDescription — sanitize-html advisory payloads", () => {
  it.each([
    // GHSA-jxwj-j7wr-gfrw: htmlparser2 does not close RCDATA on `</textarea/>`.
    ["</textarea/> solidus close", '<textarea></textarea/><img src=x onerror="alert(document.domain)">'],
    ["</textarea/> before a link", '<p>x</p><textarea></textarea/><a href="javascript:alert(1)">y</a>'],
    ["</xmp/> solidus close", "<xmp></xmp/><img src=x onerror=alert(1)>"],
    // GHSA-x3q4-9hxx-gx8m: an implied close ends the <noscript> discard region early.
    ["<noscript> implied close", '<div><noscript></div><img src="http://evil.test/t.gif"></noscript>'],
    ["<noscript> implied close with a link", '<p><noscript></p><a href="javascript:alert(1)">x</a></noscript>'],
    [
      "<noscript> behind CDATA",
      '<p>Hi</p><![CDATA[ x > <noscript>]]><a href="javascript:alert(1)">Reset</a><img src="https://evil.test/b.gif"></noscript>',
    ],
    // GHSA-g8qq-57p8-ggw5: SVG SMIL animation rewrites href to a javascript: list entry.
    [
      "SVG SMIL <animate values>",
      "<svg><a><animate attributeName=\"href\" values=\"#safe;javascript:alert('XSS')\" dur=\".01s\" fill=\"freeze\"></animate><text y=\"30\">Click me</text></a></svg>",
    ],
    [
      "SVG SMIL <set to>",
      '<svg><a xlink:href="#x"><set attributeName="href" to="javascript:alert(1)"/><text>z</text></a></svg>',
    ],
    // GHSA-cv27-6wvh-8x7j: the URL inside meta refresh `content` is not scheme-checked.
    ["meta refresh javascript:", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
    ["meta refresh data:", '<meta http-equiv="refresh" content="0;url=data:text/html,<script>alert(1)</script>">'],
    // GHSA-vccv-cmxp-4j9h: URL attributes other than href/src/cite skip naughtyHref().
    [
      "action/formaction/data/poster",
      '<form action="javascript:alert(1)"><button formaction="javascript:alert(2)">b</button></form>' +
        '<object data="javascript:alert(3)"></object><video poster="javascript:alert(4)"></video>',
    ],
  ])("neutralises %s", (_name, html) => {
    expectInert(sanitizeDescription(html));
  });
});

// description.tsx cuts the raw HTML with html.slice(0, 500) + "…" before
// sanitizing, so the sanitizer regularly sees a tag cut at any byte.
describe("sanitizeDescription — truncated input", () => {
  it.each([
    ["link with javascript:", '<p>About <a href="javascript:alert(1)" onclick="alert(2)">us</a></p>'],
    ["obfuscated scheme", '<a href="jav&#x09;ascript:alert(1)">x</a><p>tail</p>'],
    ["script", "<script>alert(1)</script><p>after</p>"],
    ["img onerror", "<img src=x onerror=alert(1)><p>after</p>"],
    [
      "svg animate",
      '<svg onload=alert(1)><a><animate attributeName="href" values="#safe;javascript:alert(1)"></animate><text>Click</text></a></svg>',
    ],
    ["</textarea/>", '<textarea></textarea/><img src=x onerror="alert(document.domain)"><p>tail</p>'],
    ["<noscript> implied close", '<div><noscript></div><img src="http://evil.test/t.gif" onerror="alert(1)"></noscript>'],
    [
      "<noscript> behind CDATA",
      '<p>Hi</p><![CDATA[ x > <noscript>]]><a href="javascript:alert(1)">Reset</a><img src=x onerror=alert(1)></noscript>',
    ],
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)"><p>x</p>'],
    ["iframe", '<iframe src="javascript:alert(1)"></iframe><p>x</p>'],
    ["nested script", "<scr<script>ipt>alert(1)</script>"],
    ["split script", "<<script>script>alert(1)<</script>/script>"],
  ])("never emits executable content for any prefix of %s", (_name, html) => {
    for (let n = 0; n <= html.length; n++) {
      expectInert(sanitizeDescription(html.slice(0, n) + "…"));
    }
  });
});
