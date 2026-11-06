import { describe, expect, it } from "vitest";
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
