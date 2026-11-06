import { describe, expect, it } from "vitest";
import { MAX_ACCEPTED_CARDS, validateCompanyProfile, validateCompanyPoint } from "@/lib/company";

describe("validateCompanyProfile", () => {
  it("accepts a minimal valid profile and trims", () => {
    const r = validateCompanyProfile({ legalName: " ACME LLC ", displayName: " ACME " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.legalName).toBe("ACME LLC");
  });
  it("requires legalName and displayName", () => {
    expect(validateCompanyProfile({ legalName: "", displayName: "x" })).toMatchObject({ ok: false, reason: "legal_name_required" });
    expect(validateCompanyProfile({ legalName: "x", displayName: "" })).toMatchObject({ ok: false, reason: "display_name_required" });
  });
  it("rejects a non-http website", () => {
    expect(validateCompanyProfile({ legalName: "a", displayName: "b", website: "javascript:alert(1)" }))
      .toMatchObject({ ok: false, reason: "website_invalid" });
  });
});

describe("validateCompanyPoint", () => {
  const base = { type: "SHOP", name: "Shop", lat: 50.08, lon: 14.42 };
  it("accepts a valid point", () => {
    const r = validateCompanyPoint(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.type).toBe("SHOP");
  });
  it("rejects an unknown type", () => {
    expect(validateCompanyPoint({ ...base, type: "BANK" })).toMatchObject({ ok: false, reason: "type_invalid" });
  });
  it("requires a name", () => {
    expect(validateCompanyPoint({ ...base, name: " " })).toMatchObject({ ok: false, reason: "name_required" });
  });
  it("rejects out-of-range coordinates", () => {
    expect(validateCompanyPoint({ ...base, lat: 100 })).toMatchObject({ ok: false, reason: "coords_invalid" });
    expect(validateCompanyPoint({ ...base, lon: 999 })).toMatchObject({ ok: false, reason: "coords_invalid" });
  });
  it("rejects nullish coordinates", () => {
    expect(validateCompanyPoint({ ...base, lat: null })).toMatchObject({ ok: false, reason: "coords_invalid" });
    expect(validateCompanyPoint({ ...base, lon: null })).toMatchObject({ ok: false, reason: "coords_invalid" });
    expect(validateCompanyPoint({ ...base, lat: undefined })).toMatchObject({ ok: false, reason: "coords_invalid" });
  });
  it("normalizes acceptedCoinIds to lowercase unique slugs", () => {
    const r = validateCompanyPoint({ ...base, acceptedCoinIds: ["Bitcoin", "bitcoin", "ETH"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.acceptedCoinIds).toEqual(["bitcoin", "eth"]);
  });
});

describe("validateCompanyPoint — собственные листинги", () => {
  const base = { type: "SHOP", name: "Shop", lat: 50.08, lon: 14.42 };

  it("keeps card ids verbatim — a cuid is case-sensitive, unlike a CoinGecko id", () => {
    const r = validateCompanyPoint({ ...base, acceptedCardIds: ["clzABC234def567"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.acceptedCardIds).toEqual(["clzABC234def567"]);
  });

  it("defaults to an empty array and drops blanks and duplicates", () => {
    const empty = validateCompanyPoint(base);
    expect(empty.ok && empty.data.acceptedCardIds).toEqual([]);
    const r = validateCompanyPoint({
      ...base,
      acceptedCardIds: [" clz1abc234def567 ", "clz1abc234def567", "", "   "],
    });
    expect(r.ok && r.data.acceptedCardIds).toEqual(["clz1abc234def567"]);
  });

  it("still lowercases CoinGecko ids, which are case-insensitive by convention", () => {
    const r = validateCompanyPoint({ ...base, acceptedCoinIds: ["Bitcoin"] });
    expect(r.ok && r.data.acceptedCoinIds).toEqual(["bitcoin"]);
  });

  it("caps the card list so one point cannot claim the whole catalogue", () => {
    const many = Array.from({ length: MAX_ACCEPTED_CARDS + 10 }, (_, i) => `clz1abc234def${i}`);
    const r = validateCompanyPoint({ ...base, acceptedCardIds: many });
    expect(r.ok && r.data.acceptedCardIds.length).toBe(MAX_ACCEPTED_CARDS);
  });
});
