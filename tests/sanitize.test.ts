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

// What description.tsx must never ship, whatever the parser made of the input.
const EXECUTABLE =
  /<script|javascript:|on\w+=|<svg|<noscript|<textarea|<meta|<iframe|<img/i;

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Asserts the sanitized HTML holds the allowlist. Text is entity-escaped on
 * output, so every literal `<` starts a tag the sanitizer chose to emit.
 */
function expectInert(html: string): void {
  expect(html, html).not.toMatch(EXECUTABLE);
  for (const [tag] of html.matchAll(/<[^>]*>?/g)) {
    const match = tag.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/);
    expect(match, `malformed tag ${tag} in ${html}`).not.toBeNull();
    const [, name, rest] = match!;
    expect(ALLOWED_TAGS.has(name.toLowerCase()), `tag ${name} in ${html}`).toBe(true);
    if (name.toLowerCase() !== "a") {
      expect(rest.trim(), `attributes on ${tag} in ${html}`).toMatch(/^\/?$/);
      continue;
    }
    const body = rest.replace(/"[^"]*"/g, '""');
    expect(body, `unquoted attribute in ${tag}`).toMatch(/^(\s+[a-z-]+="")*\s*$/);
    for (const [, attribute, value] of rest.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
      expect(ALLOWED_A_ATTRIBUTES.has(attribute), `attribute ${attribute} in ${html}`).toBe(true);
      if (attribute !== "href") continue;
      // Browsers drop ASCII whitespace and control characters inside a scheme.
      const href = decodeAttribute(value).replace(/[\u0000- ]/g, "");
      const scheme = href.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]?.toLowerCase();
      if (scheme) expect(ALLOWED_SCHEMES.has(scheme), `href ${value} in ${html}`).toBe(true);
    }
  }
}

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
