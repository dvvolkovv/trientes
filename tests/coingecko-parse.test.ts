import { describe, expect, it } from "vitest";
import { parseMarketRow, parseGlobal } from "@/lib/coingecko";

describe("parseMarketRow", () => {
  const sample = {
    id: "bitcoin",
    symbol: "btc",
    name: "Bitcoin",
    image: "https://example.com/btc.png",
    market_cap_rank: 1,
    current_price: 76684,
    market_cap: 1536247155839,
    total_volume: 29246928093,
    circulating_supply: 20031709,
    total_supply: 20031709,
    max_supply: 21000000,
    price_change_percentage_1h_in_currency: 0.025,
    price_change_percentage_24h_in_currency: -0.466,
    price_change_percentage_7d_in_currency: -4.71,
  };

  it("maps a full row", () => {
    expect(parseMarketRow(sample)).toEqual({
      id: "bitcoin",
      symbol: "BTC",
      name: "Bitcoin",
      logoUrl: "https://example.com/btc.png",
      rank: 1,
      priceUsd: 76684,
      marketCapUsd: 1536247155839,
      volume24hUsd: 29246928093,
      circulatingSupply: 20031709,
      totalSupply: 20031709,
      maxSupply: 21000000,
      pctChange1h: 0.025,
      pctChange24h: -0.466,
      pctChange7d: -4.71,
    });
  });

  it("tolerates missing supplies and percent fields", () => {
    const minimal = {
      id: "x", symbol: "x", name: "X", image: null, market_cap_rank: 50,
      current_price: 1, market_cap: 100, total_volume: 10,
      circulating_supply: null, total_supply: null, max_supply: null,
    };
    const row = parseMarketRow(minimal);
    expect(row.circulatingSupply).toBeNull();
    expect(row.totalSupply).toBeNull();
    expect(row.maxSupply).toBeNull();
    expect(row.pctChange1h).toBeNull();
    expect(row.pctChange24h).toBeNull();
    expect(row.pctChange7d).toBeNull();
    expect(row.logoUrl).toBeNull();
  });

  it("uppercases symbol", () => {
    expect(parseMarketRow({ ...sample, symbol: "eth" }).symbol).toBe("ETH");
  });

  it("throws on missing required fields", () => {
    expect(() => parseMarketRow({})).toThrow();
    expect(() => parseMarketRow({ ...sample, id: undefined })).toThrow();
  });
});

describe("parseGlobal", () => {
  it("extracts the fields we need from /global response", () => {
    const raw = {
      data: {
        active_cryptocurrencies: 12345,
        markets: 789,
        total_market_cap: { usd: 2.5e12 },
        total_volume: { usd: 1.2e11 },
        market_cap_percentage: { btc: 52.3, eth: 16.7 },
      },
    };
    expect(parseGlobal(raw)).toEqual({
      totalMarketCapUsd: 2.5e12,
      total24hVolumeUsd: 1.2e11,
      btcDominancePct: 52.3,
      ethDominancePct: 16.7,
      activeCryptos: 12345,
      markets: 789,
    });
  });

  it("throws on malformed response", () => {
    expect(() => parseGlobal({})).toThrow();
    expect(() => parseGlobal({ data: {} })).toThrow();
  });
});
