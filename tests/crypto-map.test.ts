import { describe, expect, it } from "vitest";
import {
  parseBbox,
  coinPaymentTags,
  buildOverpassQuery,
  parseOverpassElements,
  parseNominatim,
  parseOsrm,
  parseSocials,
  parseOsmImage,
  parseOpenGraph,
  isBlockedIp,
  assertUrlShape,
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

  it("reads opening hours, contacts, socials and image", () => {
    const pois = parseOverpassElements(
      {
        elements: [
          {
            type: "node",
            id: 5,
            lat: 1,
            lon: 2,
            tags: {
              shop: "cafe",
              name: "Sats Cafe",
              "payment:bitcoin": "yes",
              opening_hours: "Mo-Fr 09:00-18:00",
              "contact:phone": "+420 123 456 789",
              "contact:email": "hi@sats.cafe",
              "contact:instagram": "satscafe",
              image: "https://sats.cafe/photo.jpg",
            },
          },
        ],
      },
      btcTags,
    );
    expect(pois[0]).toMatchObject({
      openingHours: "Mo-Fr 09:00-18:00",
      phone: "+420 123 456 789",
      email: "hi@sats.cafe",
      image: "https://sats.cafe/photo.jpg",
      socials: [{ network: "instagram", url: "https://instagram.com/satscafe" }],
    });
  });

  it("falls back to the un-prefixed phone/email tags", () => {
    const pois = parseOverpassElements(
      {
        elements: [
          { type: "node", id: 6, lat: 1, lon: 2, tags: { shop: "cafe", "payment:bitcoin": "yes", phone: "111", email: "a@b.co" } },
        ],
      },
      btcTags,
    );
    expect(pois[0]).toMatchObject({ phone: "111", email: "a@b.co" });
  });

  it("leaves the new fields empty when the tags are absent", () => {
    const pois = parseOverpassElements(
      { elements: [{ type: "node", id: 7, lat: 1, lon: 2, tags: { shop: "cafe", "payment:bitcoin": "yes" } }] },
      btcTags,
    );
    expect(pois[0].openingHours).toBeNull();
    expect(pois[0].phone).toBeNull();
    expect(pois[0].email).toBeNull();
    expect(pois[0].image).toBeNull();
    expect(pois[0].socials).toEqual([]);
  });
});

describe("parseSocials", () => {
  it("normalizes a bare instagram handle to a full URL", () => {
    expect(parseSocials({ "contact:instagram": "satscafe" })).toEqual([
      { network: "instagram", url: "https://instagram.com/satscafe" },
    ]);
  });

  it("passes a full social URL through untouched", () => {
    expect(parseSocials({ "contact:facebook": "https://facebook.com/SatsCafe" })).toEqual([
      { network: "facebook", url: "https://facebook.com/SatsCafe" },
    ]);
  });

  it("maps twitter to x.com and strips a leading @", () => {
    expect(parseSocials({ "contact:twitter": "@sats" })).toEqual([
      { network: "twitter", url: "https://x.com/sats" },
    ]);
  });

  it("turns a whatsapp number into a wa.me link", () => {
    expect(parseSocials({ "contact:whatsapp": "+1 (555) 123-4567" })).toEqual([
      { network: "whatsapp", url: "https://wa.me/15551234567" },
    ]);
  });

  it("returns [] when no social tags are present", () => {
    expect(parseSocials({ shop: "cafe" })).toEqual([]);
  });
});

describe("parseOsmImage", () => {
  it("uses a direct http(s) image url", () => {
    expect(parseOsmImage({ image: "https://ex.com/p.jpg" })).toBe("https://ex.com/p.jpg");
  });

  it("builds a Commons FilePath thumb from wikimedia_commons", () => {
    expect(parseOsmImage({ wikimedia_commons: "File:Sats Cafe.jpg" })).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Sats%20Cafe.jpg?width=400",
    );
  });

  it("ignores a non-http image value", () => {
    expect(parseOsmImage({ image: "ftp://x/p.jpg" })).toBeNull();
  });

  it("returns null without image tags", () => {
    expect(parseOsmImage({ shop: "cafe" })).toBeNull();
  });
});

describe("parseOpenGraph", () => {
  const base = "https://sats.cafe/";

  it("extracts og:title, og:image and og:video", () => {
    const html =
      `<meta property="og:title" content="Sats Cafe">` +
      `<meta property="og:image" content="https://sats.cafe/og.jpg">` +
      `<meta property="og:video" content="https://sats.cafe/promo.mp4">`;
    expect(parseOpenGraph(html, base)).toEqual({
      title: "Sats Cafe",
      image: "https://sats.cafe/og.jpg",
      video: "https://sats.cafe/promo.mp4",
    });
  });

  it("reads content before the property attr and falls back to twitter:image", () => {
    const html = `<meta content="/img/p.jpg" name="twitter:image">`;
    expect(parseOpenGraph(html, base)).toEqual({
      title: null,
      image: "https://sats.cafe/img/p.jpg",
      video: null,
    });
  });

  it("resolves a relative og:image against the base", () => {
    expect(parseOpenGraph(`<meta property="og:image" content="/photo.png">`, base).image).toBe(
      "https://sats.cafe/photo.png",
    );
  });

  it("drops a non-http image", () => {
    expect(parseOpenGraph(`<meta property="og:image" content="data:image/png;base64,xx">`, base).image).toBeNull();
  });

  it("returns nulls when there are no og tags", () => {
    expect(parseOpenGraph("<html></html>", base)).toEqual({ title: null, image: null, video: null });
  });
});

describe("isBlockedIp", () => {
  it("blocks loopback, private and link-local IPv4", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.1.1", "0.0.0.0"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  it("blocks loopback, unique-local and link-local IPv6", () => {
    for (const ip of ["::1", "fc00::1", "fd12::1", "fe80::1", "::"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  it("allows public addresses", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("172.32.0.1")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("assertUrlShape", () => {
  it("returns the parsed URL for a public http(s) host", () => {
    expect(assertUrlShape("https://sats.cafe/x").hostname).toBe("sats.cafe");
  });

  it("rejects non-http schemes", () => {
    expect(() => assertUrlShape("ftp://sats.cafe")).toThrow();
    expect(() => assertUrlShape("file:///etc/passwd")).toThrow();
  });

  it("rejects embedded credentials", () => {
    expect(() => assertUrlShape("https://user:pass@sats.cafe")).toThrow();
  });

  it("rejects localhost and private IP literals", () => {
    expect(() => assertUrlShape("http://localhost/x")).toThrow();
    expect(() => assertUrlShape("http://127.0.0.1/x")).toThrow();
    expect(() => assertUrlShape("http://192.168.0.1/x")).toThrow();
    expect(() => assertUrlShape("http://[::1]/x")).toThrow();
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
