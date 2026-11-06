import { describe, expect, it } from "vitest";
import { BADGE_HEIGHT, buildAcceptBadgeSvg, escapeXml } from "@/lib/coin-card-badge";

describe("escapeXml", () => {
  it("escapes every character that could close a tag or an attribute", () => {
    expect(escapeXml(`<a href="x" & 'y'>`)).toBe(
      "&lt;a href=&quot;x&quot; &amp; &apos;y&apos;&gt;",
    );
  });
});

describe("buildAcceptBadgeSvg", () => {
  it("renders a self-contained svg with the label and the symbol", () => {
    const svg = buildAcceptBadgeSvg({ label: "Принимаем", symbol: "TAL" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(`height="${BADGE_HEIGHT}"`);
    expect(svg).toContain("Принимаем TAL");
    expect(svg).toContain("trientes.org");
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>");
  });

  it("never lets a hostile symbol inject markup", () => {
    const svg = buildAcceptBadgeSvg({ label: "Accepted here", symbol: `</text><script>x</script>` });
    expect(svg).not.toContain("<script>");
    // В SVG ровно два своих <text>, и ни одного лишнего из пользовательских данных.
    expect(svg.match(/<text /g) ?? []).toHaveLength(2);
    // Тикер поднимается в верхний регистр, поэтому и экранированная разметка тоже.
    expect(svg).toContain("&lt;/TEXT&gt;&lt;SCRIPT&gt;");
  });

  it("widens with the text instead of clipping it", () => {
    const narrow = buildAcceptBadgeSvg({ label: "We take", symbol: "TAL" });
    const wide = buildAcceptBadgeSvg({ label: "We proudly accept", symbol: "LONGSYMBOL" });
    const w = (s: string) => Number(/width="(\d+)"/.exec(s)?.[1]);
    expect(w(wide)).toBeGreaterThan(w(narrow));
  });

  it("uppercases the symbol and collapses whitespace in the label", () => {
    const svg = buildAcceptBadgeSvg({ label: "  Принимаем \n тут ", symbol: " tal " });
    expect(svg).toContain("Принимаем тут TAL");
  });
});
