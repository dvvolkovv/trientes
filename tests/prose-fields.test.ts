import { describe, expect, it } from "vitest";
import { applyCardProse, collectCardProse } from "@/lib/coin-card-prose";
import {
  collectProse,
  mergeProse,
  normalizeSourceLocale,
  proseHash,
} from "@/lib/prose-fields";

describe("collectProse", () => {
  it("keeps only non-empty strings", () => {
    expect(collectProse({ a: "text", b: null, c: "", d: "   ", e: "more" })).toEqual({
      a: "text",
      e: "more",
    });
  });

  it("drops non-strings — numbers and urls are data, not prose", () => {
    expect(collectProse({ n: 42 as never, u: undefined as never, s: "ok" })).toEqual({ s: "ok" });
  });

  it("returns an empty object when there is nothing to translate", () => {
    expect(collectProse({ a: null, b: "" })).toEqual({});
  });
});

describe("proseHash", () => {
  it("changes when any field changes — a stale translation must not survive an edit", () => {
    const a = proseHash({ x: "one", y: "two" });
    expect(proseHash({ x: "one", y: "two" })).toBe(a);
    expect(proseHash({ x: "one", y: "TWO" })).not.toBe(a);
    expect(proseHash({ x: "one" })).not.toBe(a);
  });

  it("does not depend on key insertion order", () => {
    expect(proseHash({ a: "1", b: "2" })).toBe(proseHash({ b: "2", a: "1" }));
  });
});

describe("mergeProse", () => {
  it("overlays translated fields and keeps the rest untouched", () => {
    const src = { tagline: "ру слоган", description: "ру описание", pitch: null };
    expect(mergeProse(src, { tagline: "de Slogan" })).toEqual({
      tagline: "de Slogan",
      description: "ру описание",
      pitch: null,
    });
  });

  it("ignores translated keys the source does not have", () => {
    expect(mergeProse({ a: "x" }, { a: "y", ghost: "z" })).toEqual({ a: "y" });
  });

  it("ignores empty translations rather than blanking real text", () => {
    expect(mergeProse({ a: "x" }, { a: "   " })).toEqual({ a: "x" });
  });
});

describe("normalizeSourceLocale", () => {
  it("accepts our locales and rejects anything else", () => {
    expect(normalizeSourceLocale("ru")).toBe("ru");
    expect(normalizeSourceLocale(" PT-br ")).toBe("pt-BR");
    expect(normalizeSourceLocale("klingon")).toBe(null);
    expect(normalizeSourceLocale("")).toBe(null);
    expect(normalizeSourceLocale(null)).toBe(null);
  });
});

describe("collectCardProse / applyCardProse", () => {
  const card = {
    tagline: "слоган",
    description: "описание",
    marketing: { pitch: "питч" },
    tokenomics: { emission: "эмиссия", burn: "сжигание", total: 100 },
    payments: { feeNote: "про комиссию", feeUsdTypical: 0.004 },
    legal: {
      disclaimer: true,
      jurisdictions: [
        { countryCode: "PL", status: "ALLOWED", note: "заметка PL", sourceUrl: "https://x.test", asOf: "2026-11-06" },
        { countryCode: "AT", status: "UNCLEAR", note: null, sourceUrl: "https://y.test", asOf: "2026-10-15" },
      ],
    },
  };

  it("collects every prose field, including the fee note and jurisdiction notes", () => {
    const p = collectCardProse(card);
    expect(p.tagline).toBe("слоган");
    expect(p.feeNote).toBe("про комиссию");
    expect(p["legalNote:PL"]).toBe("заметка PL");
    // Пустая заметка не попадает — переводить нечего.
    expect(p["legalNote:AT"]).toBeUndefined();
  });

  it("never collects numbers or urls — they are data, not prose", () => {
    const p = collectCardProse(card);
    expect(Object.values(p)).not.toContain(100);
    expect(JSON.stringify(p)).not.toContain("https://x.test");
  });

  it("writes the translation back into the right place and keeps the data", () => {
    const out = applyCardProse(card, {
      ...collectCardProse(card),
      feeNote: "about the fee",
      "legalNote:PL": "PL note",
    });
    expect((out.payments as { feeNote: string; feeUsdTypical: number }).feeNote).toBe("about the fee");
    expect((out.payments as { feeUsdTypical: number }).feeUsdTypical).toBe(0.004);
    const js = (out.legal as { jurisdictions: { countryCode: string; note: string | null; sourceUrl: string }[] }).jurisdictions;
    expect(js[0].note).toBe("PL note");
    expect(js[0].sourceUrl).toBe("https://x.test");
    expect(js[1].note).toBe(null);
  });
});
