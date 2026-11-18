import { describe, expect, it } from "vitest";
import { slugify, slugCandidates } from "@/lib/slugify";

describe("slugify", () => {
  it("transliterates Cyrillic and keeps latin", () => {
    expect(slugify("Молоко «Домик в деревне» 3,2%")).toBe("moloko-domik-v-derevne-3-2");
    expect(slugify("Nike Air Max 90")).toBe("nike-air-max-90");
  });

  it("never returns an empty slug: the fallback is the caller's word", () => {
    expect(slugify("...", "product")).toBe("product");
    expect(slugify("", "product")).toBe("product");
    expect(slugify("。。。", "product")).toBe("product");
  });

  it("caps the length and leaves no trailing dash", () => {
    const long = slugify("a".repeat(80));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("slugCandidates", () => {
  it("offers the bare slug first, then numbered ones", () => {
    expect(slugCandidates("moloko", 4)).toEqual(["moloko", "moloko-2", "moloko-3", "moloko-4"]);
  });
});
