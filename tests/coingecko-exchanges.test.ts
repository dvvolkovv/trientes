import { describe, expect, it } from "vitest";
import { parseExchange } from "@/lib/coingecko";

describe("parseExchange", () => {
  const sample = {
    id: "gdax",
    name: "Coinbase Exchange",
    year_established: 2012,
    country: "United States",
    description: "A leading U.S.-based exchange",
    url: "https://www.coinbase.com/",
    image: "https://example.com/coinbase.png",
    has_trading_incentive: false,
    trust_score: 10,
    trust_score_rank: 1,
    trade_volume_24h_btc: 15509.32,
  };

  it("maps fields and computes USD volume from a btcUsd ratio", () => {
    expect(parseExchange(sample, 76000)).toEqual({
      id: "gdax",
      name: "Coinbase Exchange",
      logoUrl: "https://example.com/coinbase.png",
      country: "United States",
      yearEstablished: 2012,
      trustScore: 10,
      trustScoreRank: 1,
      volume24hBtc: 15509.32,
      volume24hUsd: 15509.32 * 76000,
      url: "https://www.coinbase.com/",
      hasTradingIncentive: false,
      description: null,
      exchangeType: null,
      currencies: null,
      pairsCount: null,
      fiats: [],
      socials: null,
      source: "cg",
    });
  });

  it("handles missing optionals as null", () => {
    const minimal = {
      id: "x",
      name: "X",
      trade_volume_24h_btc: 0,
    };
    expect(parseExchange(minimal, 70000)).toEqual({
      id: "x",
      name: "X",
      logoUrl: null,
      country: null,
      yearEstablished: null,
      trustScore: null,
      trustScoreRank: null,
      volume24hBtc: 0,
      volume24hUsd: 0,
      url: null,
      hasTradingIncentive: false,
      description: null,
      exchangeType: null,
      currencies: null,
      pairsCount: null,
      fiats: [],
      socials: null,
      source: "cg",
    });
  });

  it("throws on missing id or name", () => {
    expect(() => parseExchange({}, 1)).toThrow();
    expect(() => parseExchange({ id: "a" }, 1)).toThrow();
  });
});
