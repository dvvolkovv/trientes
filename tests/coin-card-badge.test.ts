import { describe, expect, it } from "vitest";
import {
  BADGE_GAP,
  BADGE_HEIGHT,
  BADGE_PAD,
  buildAcceptBadgeSvg,
  charWidth,
  escapeXml,
  textWidth,
} from "@/lib/coin-card-badge";

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

/** Геометрия, разобранная обратно из разметки: x и отведённая ширина каждой надписи. */
function geometry(svg: string) {
  const width = Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)?.[1]);
  const texts = [...svg.matchAll(/<text x="([\d.]+)"[^>]*textLength="(\d+)" lengthAdjust="([a-zA-Z]+)"/g)].map(
    (m) => ({ x: Number(m[1]), length: Number(m[2]), adjust: m[3] }),
  );
  return { width, texts };
}

describe("ширина бейджа", () => {
  // Ровно те надписи, что уходят на чужие сайты: по одной с каждого языка
  // интерфейса. Живой дефект нашёлся на русской — «Принимаем TALentes.org».
  const LABELS = [
    "We accept",
    "Принимаем",
    "Wir akzeptieren",
    "Nous acceptons",
    "Aceptamos",
    "Aceitamos",
    "Kabul ediyoruz",
    "Prihvaćamo",
    "Prijímame",
    "取扱中",
    "취급 중",
    "我们接受",
  ];

  it.each(LABELS)("надпись «%s» не наезжает на адрес сайта", (label) => {
    const { width, texts } = geometry(buildAcceptBadgeSvg({ label, symbol: "TAL" }));
    expect(texts).toHaveLength(2);
    const [main, site] = texts;
    // Между коробкой надписи и адресом остаётся зазор, а адрес не вылезает за рамку.
    expect(main.x + main.length + BADGE_GAP).toBeLessThanOrEqual(site.x);
    expect(site.x + site.length + BADGE_PAD).toBeLessThanOrEqual(width);
  });

  it("обещание ширины держит сам SVG, а не наша оценка шрифта", () => {
    const { texts } = geometry(buildAcceptBadgeSvg({ label: "Принимаем", symbol: "TAL" }));
    // Без `lengthAdjust` браузер с более широким шрифтом снова вылез бы за коробку.
    for (const t of texts) expect(t.adjust).toBe("spacingAndGlyphs");
  });

  it("кириллица шире латиницы той же длины — средней цифры на символ не осталось", () => {
    const ru = textWidth("Принимаем TAL", 13);
    const en = textWidth("We accept TAL", 13);
    expect("Принимаем TAL".length).toBe("We accept TAL".length);
    expect(ru).toBeGreaterThan(en);
  });

  it("иероглиф занимает полный кегль, а не ширину латинской буквы", () => {
    expect(charWidth("我")).toBe(1);
    expect(charWidth("취")).toBe(1);
    expect(charWidth("中")).toBeGreaterThan(charWidth("a"));
  });

  it("незнакомая буква считается средней, а не нулевой", () => {
    // Ноль означал бы «места не нужно», и надпись легла бы поверх соседней.
    expect(charWidth("ع")).toBeGreaterThan(0.5);
    expect(textWidth("مقبول", 13)).toBeGreaterThan(13);
  });
});
