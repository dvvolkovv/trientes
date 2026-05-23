import { describe, expect, it } from "vitest";
import { targetLanguageName } from "@/lib/translate";

describe("targetLanguageName", () => {
  it("maps supported interface locales to a language name", () => {
    expect(targetLanguageName("ru")).toBe("Russian");
    expect(targetLanguageName("zh-CN")).toBe("Simplified Chinese");
    expect(targetLanguageName("pt-BR")).toBe("Brazilian Portuguese");
  });

  it("returns null for English and unknown locales (source passes through untranslated)", () => {
    expect(targetLanguageName("en")).toBeNull();
    expect(targetLanguageName("xx")).toBeNull();
  });
});
