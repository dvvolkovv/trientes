import { describe, expect, it } from "vitest";
import { acceptedCoinsFromTags, parseOverpassElements } from "@/lib/crypto-map";

describe("acceptedCoinsFromTags", () => {
  it("names the coins the tags name", () => {
    const coins = acceptedCoinsFromTags({ "payment:bitcoin": "yes", "payment:monero": "yes" });
    expect(coins.map((c) => c.symbol)).toEqual(["BTC", "XMR"]);
    expect(coins.every((c) => c.own === false)).toBe(true);
  });

  it("reads the currency spelling too, and never lists a coin twice", () => {
    const coins = acceptedCoinsFromTags({ "payment:bitcoin": "yes", "currency:XBT": "yes" });
    expect(coins.map((c) => c.key)).toEqual(["bitcoin"]);
  });

  it("ignores a tag that is not a yes", () => {
    expect(acceptedCoinsFromTags({ "payment:bitcoin": "no" })).toEqual([]);
  });

  it("does not turn the generic crypto tag into a ticker", () => {
    expect(acceptedCoinsFromTags({ "payment:cryptocurrencies": "yes" })).toEqual([]);
  });

  it("leaves the logo empty — OSM tags carry none", () => {
    expect(acceptedCoinsFromTags({ "payment:bitcoin": "yes" })[0].logoUrl).toBeNull();
  });
});

describe("parseOverpassElements", () => {
  const element = (tags: Record<string, string>) => ({
    elements: [{ type: "node", id: 1, lat: 10, lon: 20, tags: { name: "Shop", ...tags } }],
  });

  it("carries the accepted coins into the Poi", () => {
    const [poi] = parseOverpassElements(element({ "payment:litecoin": "yes" }), ["payment:bitcoin"]);
    expect(poi.acceptedCoins.map((c) => c.symbol)).toEqual(["LTC"]);
    expect(poi.acceptedGeneric).toBe(false);
  });

  it("raises the generic flag for the generic tag", () => {
    const [poi] = parseOverpassElements(element({ "payment:cryptocurrencies": "yes" }), []);
    expect(poi.acceptedCoins).toEqual([]);
    expect(poi.acceptedGeneric).toBe(true);
  });
});
