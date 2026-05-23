import { describe, expect, it } from "vitest";
import {
  parseBbox,
  coinPaymentTags,
  buildOverpassQuery,
  parseOverpassElements,
  parseNominatim,
  parseOsrm,
} from "@/lib/crypto-map";

describe("parseBbox", () => {
  it("parses minLon,minLat,maxLon,maxLat", () => {
    expect(parseBbox("14.40,50.07,14.45,50.10")).toEqual({
      minLon: 14.4,
      minLat: 50.07,
      maxLon: 14.45,
      maxLat: 50.1,
    });
  });

  it("rejects malformed, out-of-range, or inverted boxes", () => {
    expect(parseBbox(null)).toBeNull();
    expect(parseBbox("1,2,3")).toBeNull();
    expect(parseBbox("a,b,c,d")).toBeNull();
    expect(parseBbox("200,0,201,1")).toBeNull(); // lon out of range
    expect(parseBbox("0,0,-1,1")).toBeNull(); // maxLon < minLon
    expect(parseBbox("0,95,1,96")).toBeNull(); // lat out of range
  });
});

describe("coinPaymentTags", () => {
  it("maps bitcoin to its bitcoin/lightning tags", () => {
    const tags = coinPaymentTags("bitcoin", "BTC");
    expect(tags).toContain("payment:bitcoin");
    expect(tags).toContain("currency:XBT");
    expect(tags).toContain("payment:lightning");
  });

  it("maps known altcoins by id or symbol", () => {
    expect(coinPaymentTags("ethereum", "ETH")).toContain("payment:ethereum");
    expect(coinPaymentTags("monero", "XMR")).toContain("currency:XMR");
  });

  it("falls back to the generic cryptocurrencies tag for unmapped coins", () => {
    expect(coinPaymentTags("some-new-l1", "NEW")).toEqual(["payment:cryptocurrencies"]);
  });
});

describe("buildOverpassQuery", () => {
  it("emits a bbox-scoped union over the crypto payment tags", () => {
    const q = buildOverpassQuery({ minLon: 14.4, minLat: 50.07, maxLon: 14.45, maxLat: 50.1 });
    expect(q).toContain("[out:json]");
    // Overpass bbox order is (south,west,north,east) = (minLat,minLon,maxLat,maxLon)
    expect(q).toContain("50.07,14.4,50.1,14.45");
    expect(q).toContain('"payment:bitcoin"="yes"');
    expect(q).toContain('"payment:cryptocurrencies"="yes"');
    expect(q).toContain("out center tags");
  });
});

describe("parseOverpassElements", () => {
  const btcTags = ["payment:bitcoin", "currency:XBT", "payment:lightning"];

  it("categorizes a crypto ATM into the atm layer and reads node coords", () => {
    const pois = parseOverpassElements(
      {
        elements: [
          {
            type: "node",
            id: 3512173733,
            lat: 50.0862517,
            lon: 14.4271405,
            tags: { amenity: "atm", "currency:XBT": "yes", name: "wBTCb.cz" },
          },
        ],
      },
      btcTags,
    );
    expect(pois).toHaveLength(1);
    expect(pois[0]).toMatchObject({
      id: "node/3512173733",
      lat: 50.0862517,
      lon: 14.4271405,
      name: "wBTCb.cz",
      layer: "atm",
      coinSpecific: true,
    });
  });

  it("categorizes a shop accepting bitcoin into the merchant layer", () => {
    const pois = parseOverpassElements(
      {
        elements: [
          {
            type: "node",
            id: 1,
            lat: 1,
            lon: 2,
            tags: { shop: "coffee", name: "Sats Cafe", "payment:bitcoin": "yes", "payment:lightning": "yes" },
          },
        ],
      },
      btcTags,
    );
    expect(pois[0].layer).toBe("merchant");
    expect(pois[0].lightning).toBe(true);
    expect(pois[0].category.toLowerCase()).toContain("coffee");
  });

  it("categorizes banks / financial offices into the financial layer", () => {
    const pois = parseOverpassElements(
      {
        elements: [
          { type: "node", id: 2, lat: 1, lon: 2, tags: { amenity: "bank", name: "Crypto Bank", "payment:cryptocurrencies": "yes" } },
        ],
      },
      btcTags,
    );
    expect(pois[0].layer).toBe("financial");
  });

  it("uses the center coords for ways/relations", () => {
    const pois = parseOverpassElements(
      {
        elements: [
          { type: "way", id: 7, center: { lat: 10, lon: 20 }, tags: { shop: "electronics", "payment:bitcoin": "yes" } },
        ],
      },
      btcTags,
    );
    expect(pois[0]).toMatchObject({ id: "way/7", lat: 10, lon: 20 });
  });

  it("skips elements without resolvable coordinates", () => {
    const pois = parseOverpassElements(
      { elements: [{ type: "relation", id: 9, tags: { "payment:bitcoin": "yes" } }] },
      btcTags,
    );
    expect(pois).toHaveLength(0);
  });

  it("synthesizes a name when the element has none", () => {
    const pois = parseOverpassElements(
      { elements: [{ type: "node", id: 3, lat: 1, lon: 2, tags: { amenity: "atm", "currency:XBT": "yes" } }] },
      btcTags,
    );
    expect(pois[0].name.length).toBeGreaterThan(0);
  });

  it("marks coinSpecific=false when the coin's tags are absent", () => {
    const pois = parseOverpassElements(
      { elements: [{ type: "node", id: 4, lat: 1, lon: 2, tags: { shop: "cafe", "payment:cryptocurrencies": "yes" } }] },
      ["payment:ethereum"],
    );
    expect(pois[0].coinSpecific).toBe(false);
  });

  it("returns [] on a malformed payload", () => {
    expect(parseOverpassElements({}, btcTags)).toEqual([]);
    expect(parseOverpassElements(null, btcTags)).toEqual([]);
  });
});

describe("parseNominatim", () => {
  it("maps results to {label, lat, lon}", () => {
    const out = parseNominatim([
      { display_name: "Prague, Czechia", lat: "50.087", lon: "14.421" },
      { display_name: "no coords" },
    ]);
    expect(out).toEqual([{ label: "Prague, Czechia", lat: 50.087, lon: 14.421 }]);
  });

  it("returns [] for non-array input", () => {
    expect(parseNominatim({})).toEqual([]);
  });
});

describe("parseOsrm", () => {
  it("extracts distance, duration, and geometry from an Ok route", () => {
    const geom = { type: "LineString", coordinates: [[14.42, 50.08], [14.45, 50.09]] };
    const out = parseOsrm({ code: "Ok", routes: [{ distance: 4430.2, duration: 482.9, geometry: geom }] });
    expect(out).toEqual({ distance: 4430.2, duration: 482.9, geometry: geom });
  });

  it("returns null when no route is found", () => {
    expect(parseOsrm({ code: "NoRoute", routes: [] })).toBeNull();
    expect(parseOsrm({})).toBeNull();
  });
});
