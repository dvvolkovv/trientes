import { describe, expect, it } from "vitest";
import { dexHref } from "@/lib/dex-link";

describe("dexHref", () => {
  it("keeps Russian and falls back to English for the other site locales", () => {
    expect(dexHref("ru")).toBe("/exchange/?lang=ru#/swap");
    for (const locale of ["en", "de", "es", "fr", "ja", "ko", "pt-BR", "tr", "zh-CN"]) {
      expect(dexHref(locale)).toBe("/exchange/?lang=en#/swap");
    }
  });
});
