import { describe, expect, it } from "vitest";
import { slugifyCoinName, buildSlugCandidates } from "@/lib/coin-card-slug";

describe("slugifyCoinName", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyCoinName("Foobar Chain")).toBe("foobar-chain");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugifyCoinName("  My!!  Great__Coin.. ")).toBe("my-great-coin");
  });

  it("transliterates cyrillic", () => {
    expect(slugifyCoinName("Монета Жук")).toBe("moneta-zhuk");
  });

  it("falls back to 'coin' when nothing survives", () => {
    expect(slugifyCoinName("!!!")).toBe("coin");
  });

  it("caps length at 60 chars without trailing hyphen", () => {
    const s = slugifyCoinName("a".repeat(100));
    expect(s.length).toBe(60);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("buildSlugCandidates", () => {
  it("puts the plain slug first, then symbol-suffixed, then numbered", () => {
    expect(buildSlugCandidates("Foobar Chain", "FOO")).toEqual([
      "foobar-chain",
      "foobar-chain-foo",
      "foobar-chain-2",
      "foobar-chain-3",
      "foobar-chain-4",
    ]);
  });

  it("does not duplicate the symbol suffix when name already ends with it", () => {
    const c = buildSlugCandidates("Foo", "FOO");
    expect(c[0]).toBe("foo");
    expect(c).not.toContain("foo-foo");
  });
});
