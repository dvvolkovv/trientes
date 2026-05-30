import { describe, expect, it } from "vitest";
import {
  fintechCreateSchema,
  sanitizeFintechSocials,
  isValidCountryCode,
  isValidFiat,
  SLUG_RE,
} from "@/lib/fintech";

describe("SLUG_RE", () => {
  it("accepts lowercase + digits + hyphen, 2-40 chars", () => {
    expect(SLUG_RE.test("revolut")).toBe(true);
    expect(SLUG_RE.test("crypto-com")).toBe(true);
    expect(SLUG_RE.test("a")).toBe(false);
    expect(SLUG_RE.test("UPPER")).toBe(false);
    expect(SLUG_RE.test("with space")).toBe(false);
    expect(SLUG_RE.test("a".repeat(41))).toBe(false);
  });
});

describe("isValidCountryCode", () => {
  it("accepts ISO-3166-1 alpha-2 codes", () => {
    expect(isValidCountryCode("US")).toBe(true);
    expect(isValidCountryCode("GB")).toBe(true);
    expect(isValidCountryCode("XX")).toBe(false);
    expect(isValidCountryCode("us")).toBe(false);
  });
});

describe("isValidFiat", () => {
  it("accepts known ISO-4217 codes", () => {
    expect(isValidFiat("USD")).toBe(true);
    expect(isValidFiat("EUR")).toBe(true);
    expect(isValidFiat("XYZ")).toBe(false);
  });
});

describe("sanitizeFintechSocials", () => {
  it("drops non-http(s) urls", () => {
    expect(
      sanitizeFintechSocials([
        { network: "twitter", url: "https://x.com/revolut" },
        { network: "evil", url: "javascript:alert(1)" },
      ]),
    ).toEqual([{ network: "twitter", url: "https://x.com/revolut" }]);
  });
  it("drops empty network or non-string url", () => {
    expect(
      sanitizeFintechSocials([
        { network: "", url: "https://x.com/" },
        { network: "tg", url: 123 as unknown as string },
        { network: "tg", url: "https://t.me/x" },
      ]),
    ).toEqual([{ network: "tg", url: "https://t.me/x" }]);
  });
  it("returns [] for non-array input", () => {
    expect(sanitizeFintechSocials({} as unknown)).toEqual([]);
    expect(sanitizeFintechSocials(null)).toEqual([]);
  });
  it("caps at 10 entries", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ network: `n${i}`, url: `https://x/${i}` }));
    expect(sanitizeFintechSocials(many)).toHaveLength(10);
  });
});

describe("fintechCreateSchema", () => {
  const valid = {
    slug: "revolut",
    displayName: "Revolut",
    website: "https://revolut.com",
    services: ["CARD", "IBAN"],
    availableIn: ["GB", "US"],
    supportedCoinIds: ["bitcoin", "ethereum"],
    supportedFiats: ["USD", "EUR"],
  };

  it("accepts a minimal valid payload", () => {
    expect(fintechCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects bad slug", () => {
    expect(fintechCreateSchema.safeParse({ ...valid, slug: "Bad Slug" }).success).toBe(false);
  });

  it("rejects non-http website", () => {
    expect(fintechCreateSchema.safeParse({ ...valid, website: "ftp://x" }).success).toBe(false);
  });

  it("rejects (0,0) HQ coords", () => {
    expect(fintechCreateSchema.safeParse({ ...valid, hqLat: 0, hqLon: 0 }).success).toBe(false);
  });

  it("requires both hqLat and hqLon if either is provided", () => {
    expect(fintechCreateSchema.safeParse({ ...valid, hqLat: 51.5 }).success).toBe(false);
    expect(fintechCreateSchema.safeParse({ ...valid, hqLat: 51.5, hqLon: -0.1 }).success).toBe(true);
  });

  it("caps array sizes", () => {
    const big = Array.from({ length: 31 }, () => "US");
    expect(fintechCreateSchema.safeParse({ ...valid, availableIn: big }).success).toBe(false);
  });

  it("rejects unknown country code in availableIn", () => {
    expect(fintechCreateSchema.safeParse({ ...valid, availableIn: ["ZZ"] }).success).toBe(false);
  });
});
