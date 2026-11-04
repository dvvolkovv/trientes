import { describe, expect, it } from "vitest";
import { dexHref } from "@/lib/dex-link";
import { SUPPORTED_LOCALES } from "@/lib/locales";

describe("dexHref", () => {
  it("keeps Russian and falls back to English for the other site locales", () => {
    expect(dexHref("ru")).toBe("/exchange/?lang=ru#/swap");
    for (const locale of SUPPORTED_LOCALES.filter((locale) => locale !== "ru")) {
      expect(dexHref(locale)).toBe("/exchange/?lang=en#/swap");
    }
  });
});
