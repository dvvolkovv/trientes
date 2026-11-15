import { describe, expect, it } from "vitest";
import { companyPointToPoi } from "@/lib/company-points";
import type { CoinSelector } from "@/lib/crypto-map";

const BTC: CoinSelector = { kind: "coin", coinId: "bitcoin" };
const ETH: CoinSelector = { kind: "coin", coinId: "ethereum" };
const CARD: CoinSelector = { kind: "card", cardId: "clz1abc234def567" };

const row = {
  id: "ckpoint1", type: "ATM", name: "BTC ATM", description: null,
  lat: 50.08, lon: 14.42, address: "Main St", acceptedCoinIds: ["bitcoin"],
  acceptedCardIds: ["clz1abc234def567"],
  logoUrl: "https://x/y.png", openingHours: "24/7", phone: null, website: null,
  socials: [{ network: "telegram", url: "https://t.me/x" }],
  company: { displayName: "ACME", logoUrl: "https://x/c.png", website: "https://acme.co", socials: null },
};

describe("companyPointToPoi", () => {
  it("maps an ATM point to an atm-layer Poi with a company id prefix", () => {
    const p = companyPointToPoi(row as never, BTC);
    expect(p.id).toBe("company/ckpoint1");
    expect(p.layer).toBe("atm");
    expect(p.lat).toBe(50.08);
    expect(p.coinSpecific).toBe(true);
    expect(p.image).toBe("https://x/y.png");
    expect(p.socials).toEqual([{ network: "telegram", url: "https://t.me/x" }]);
  });
  it("maps SHOP/POS/SALES_OFFICE to the merchant layer and reads coinSpecific per coin", () => {
    expect(companyPointToPoi({ ...row, type: "SHOP" } as never, ETH).layer).toBe("merchant");
    expect(companyPointToPoi({ ...row, type: "POS" } as never, ETH).coinSpecific).toBe(false);
  });
  it("reads coinSpecific from acceptedCardIds when a self-listed card is selected", () => {
    expect(companyPointToPoi(row as never, CARD).coinSpecific).toBe(true);
    expect(companyPointToPoi({ ...row, acceptedCardIds: [] } as never, CARD).coinSpecific).toBe(false);
  });
  it("never marks a point card-specific just because the coin id matches", () => {
    const p = companyPointToPoi({ ...row, acceptedCardIds: [] } as never, { kind: "card", cardId: "bitcoin" });
    expect(p.coinSpecific).toBe(false);
  });
  it("survives a legacy row with no acceptedCardIds column value", () => {
    const legacy = { ...row } as Record<string, unknown>;
    delete legacy.acceptedCardIds;
    expect(companyPointToPoi(legacy as never, CARD).coinSpecific).toBe(false);
  });
  it("falls back to the company logo + website when the point has none", () => {
    const p = companyPointToPoi({ ...row, logoUrl: null, website: null } as never, BTC);
    expect(p.image).toBe("https://x/c.png");
    expect(p.website).toBe("https://acme.co");
  });
  it("drops socials with non-http(s) urls (XSS guard)", () => {
    const dirty = {
      ...row,
      socials: [
        { network: "telegram", url: "https://t.me/ok" },
        { network: "evil", url: "javascript:alert(1)" },
        { network: "", url: "https://t.me/empty-network" },
        "not-an-object",
      ],
    };
    const p = companyPointToPoi(dirty as never, BTC);
    expect(p.socials).toEqual([{ network: "telegram", url: "https://t.me/ok" }]);
  });
});

describe("companyPointToPoi — что здесь принимают", () => {
  const registry = {
    coins: new Map([
      ["bitcoin", { symbol: "btc", name: "Bitcoin", logoUrl: "/i/btc.png", slug: "bitcoin" }],
    ]),
    cards: new Map([
      ["card1", { symbol: "tal", name: "Taler", logoUrl: "/i/tal.png", slug: "taler" }],
    ]),
  };

  const point = (over: Record<string, unknown> = {}) =>
    ({
      id: "p1",
      type: "SHOP",
      name: "Shop",
      description: "Point story",
      lat: 10,
      lon: 20,
      address: "Street 1",
      acceptedCoinIds: ["bitcoin", "unknown-coin"],
      acceptedCardIds: ["card1"],
      logoUrl: null,
      photos: [{ url: "https://x.test/a.jpg" }, { url: "javascript:alert(1)" }],
      openingHours: null,
      phone: null,
      website: null,
      socials: null,
      company: {
        displayName: "Acme",
        logoUrl: null,
        website: null,
        socials: null,
        description: "Company story",
        email: null,
        phone: null,
      },
      ...over,
    }) as never;

  it("names both catalogue coins and our own listings", () => {
    const poi = companyPointToPoi(point(), BTC, registry);
    expect(poi.acceptedCoins.map((c) => c.symbol)).toEqual(["BTC", "TAL"]);
    expect(poi.acceptedCoins.find((c) => c.symbol === "TAL")?.own).toBe(true);
  });

  it("drops a coin the catalogue does not know — a chip without a ticker says nothing", () => {
    const poi = companyPointToPoi(point(), BTC, registry);
    expect(poi.acceptedCoins.map((c) => c.key)).not.toContain("unknown-coin");
  });

  it("never raises the generic flag for our own point — it declared names", () => {
    expect(companyPointToPoi(point(), BTC, registry).acceptedGeneric).toBe(false);
  });

  it("carries every photo, sanitized the way socials are", () => {
    const poi = companyPointToPoi(point(), BTC, registry);
    expect(poi.photos).toEqual(["https://x.test/a.jpg"]);
  });

  it("keeps at most five photos", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ url: `https://x.test/${i}.jpg` }));
    const poi = companyPointToPoi(point({ photos: many }), BTC, registry);
    expect(poi.photos).toHaveLength(5);
  });

  it("works without a registry at all — the feed may not have built one", () => {
    expect(companyPointToPoi(point(), BTC).acceptedCoins).toEqual([]);
  });
});
