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
  it("отдаёт логотип точки, а при его отсутствии — логотип компании", () => {
    expect(companyPointToPoi(row as never, BTC).logoUrl).toBe("https://x/y.png");
    expect(companyPointToPoi({ ...row, logoUrl: null } as never, BTC).logoUrl).toBe("https://x/c.png");
    const bare = { ...row, logoUrl: null, company: { ...row.company, logoUrl: null } };
    expect(companyPointToPoi(bare as never, BTC).logoUrl).toBeNull();
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

/**
 * Слайс BX. Фид обязан читать выключатели предприятия сам: он публичный, и
 * «спрятать в браузере» значит всё равно отдать наружу. И он обязан понимать
 * наследование: пустые часы точки — это «как у предприятия», а не «часов нет».
 */
describe("карточка с карты: выключатели и наследование (BX)", () => {
  const WORKWEEK = { mon: { kind: "open", spans: [["09:00", "18:00"]] } };
  const arcon = {
    ...row,
    type: "SHOP",
    phone: null,
    hours: null,
    timezone: null,
    photos: [{ url: "/uploads/points/p/a.jpg" }],
    acceptedCoinIds: [],
    acceptedCardIds: [],
    companyId: "cmp1",
    company: {
      displayName: "Arcon",
      logoUrl: "https://x/c.png",
      website: "https://arcon.ch",
      socials: null,
      description: "Строим",
      email: "a@arcon.ch",
      phone: "+41 79",
      category: null,
      hours: WORKWEEK,
      timezone: "Europe/Zurich",
      publicFields: null,
      acceptedCoinIds: ["bitcoin"],
      acceptedCardIds: [],
      returnPolicy: "14 дней",
      returnDays: 14,
      registrationNumber: "CHE-108.021.845",
      taxNumber: null,
    },
  };

  it("пустые часы точки показывают часы предприятия и его пояс", () => {
    const p = companyPointToPoi(arcon as never, ETH);
    expect(p.hours?.mon).toEqual({ kind: "open", spans: [["09:00", "18:00"]] });
    expect(p.timezone).toBe("Europe/Zurich");
    // Чьё расписание — сказано прямо: часы конторы это не часы торговли.
    expect(p.hoursFrom).toBe("company");
  });

  it("пустой набор монет точки показывает монеты предприятия", () => {
    expect(companyPointToPoi(arcon as never, BTC).coinSpecific).toBe(true);
    expect(companyPointToPoi(arcon as never, ETH).coinSpecific).toBe(false);
  });

  it("выключенный модуль не приходит в ответе вовсе", () => {
    const off = {
      ...arcon,
      company: {
        ...arcon.company,
        publicFields: {
          phone: false, email: false, hours: false, coins: false,
          photos: false, socials: false, website: false,
          description: false, returnPolicy: false,
        },
      },
    };
    const p = companyPointToPoi(off as never, BTC);
    expect(p.phone).toBeNull();
    expect(p.email).toBeNull();
    expect(p.website).toBeNull();
    expect(p.description).toBeNull();
    expect(p.hours).toBeNull();
    expect(p.photos).toEqual([]);
    expect(p.socials).toEqual([]);
    expect(p.acceptedCoins).toEqual([]);
    expect(p.returnPolicy).toBeNull();
    // Выключенные монеты гасят и признак «принимает выбранную»: иначе булавка
    // обещала бы приём, которого в карточке не видно.
    expect(p.coinSpecific).toBe(false);
  });

  it("включённые модули приходят, а реквизиты выключателя не имеют (решение BV)", () => {
    const p = companyPointToPoi(arcon as never, BTC);
    expect(p.phone).toBe("+41 79");
    expect(p.returnPolicy).toBe("14 дней");
    expect(p.returnDays).toBe(14);
    expect(p.requisites?.registrationNumber).toBe("CHE-108.021.845");
    expect(p.companyId).toBe("cmp1");
  });

  it("выключенные фотографии не подставляются и в превью булавки", () => {
    const off = { ...arcon, company: { ...arcon.company, publicFields: { photos: false } } };
    const p = companyPointToPoi(off as never, BTC);
    expect(p.photos).toEqual([]);
    // Остаётся логотип: знак заведения — не фотография витрины.
    expect(p.image).toBe("https://x/y.png");
  });
});
