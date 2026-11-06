import { describe, expect, it } from "vitest";
import { POINT_MODERATED_FIELDS, pointEditNeedsModeration } from "@/lib/point-edit";

const base = {
  type: "SHOP", name: "Shop", countryCode: "AT", city: "Vienna", street: "Porzellangasse",
  houseNumber: "47", postalCode: "1090", lat: 48.22, lon: 16.36,
  acceptedCoinIds: ["bitcoin"], acceptedCardIds: ["card1"],
  description: null as string | null, openingHours: null as string | null,
  phone: null as string | null, website: null as string | null, logoUrl: null as string | null,
};

describe("pointEditNeedsModeration", () => {
  it("passes an unchanged point without sending it back to the queue", () => {
    expect(pointEditNeedsModeration(base, { ...base })).toBe(false);
  });

  it("lets contact details through — they cannot mislead anyone about what is accepted", () => {
    expect(pointEditNeedsModeration(base, { ...base, phone: "+43 1 234" })).toBe(false);
    expect(pointEditNeedsModeration(base, { ...base, openingHours: "Mo-Fr 9-18" })).toBe(false);
    expect(pointEditNeedsModeration(base, { ...base, description: "уютное кафе" })).toBe(false);
    expect(pointEditNeedsModeration(base, { ...base, website: "https://x.test" })).toBe(false);
  });

  it("sends a renamed or moved point back to moderation", () => {
    expect(pointEditNeedsModeration(base, { ...base, name: "Other shop" })).toBe(true);
    expect(pointEditNeedsModeration(base, { ...base, street: "Hauptstrasse" })).toBe(true);
    expect(pointEditNeedsModeration(base, { ...base, lat: 50.08 })).toBe(true);
    expect(pointEditNeedsModeration(base, { ...base, type: "ATM" })).toBe(true);
  });

  it("sends a changed set of accepted coins back to moderation", () => {
    expect(pointEditNeedsModeration(base, { ...base, acceptedCoinIds: ["bitcoin", "ethereum"] })).toBe(true);
    expect(pointEditNeedsModeration(base, { ...base, acceptedCardIds: [] })).toBe(true);
  });

  it("does not care about the order of the accepted lists", () => {
    const after = { ...base, acceptedCoinIds: ["bitcoin"], acceptedCardIds: ["card1"] };
    expect(pointEditNeedsModeration(base, after)).toBe(false);
    expect(
      pointEditNeedsModeration(
        { ...base, acceptedCoinIds: ["a", "b"] },
        { ...base, acceptedCoinIds: ["b", "a"] },
      ),
    ).toBe(false);
  });

  it("names every moderated field explicitly — an unlisted field must not slip through", () => {
    expect([...POINT_MODERATED_FIELDS].sort()).toEqual(
      ["acceptedCardIds", "acceptedCoinIds", "city", "countryCode", "houseNumber",
       "lat", "lon", "name", "postalCode", "street", "type"].sort(),
    );
  });
});
