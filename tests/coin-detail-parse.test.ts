import { describe, expect, it } from "vitest";
import { parseCoinDetail, parseMarketChart, parseTickers } from "@/lib/coingecko";

describe("parseCoinDetail", () => {
  const sample = {
    id: "bitcoin",
    description: { en: "Bitcoin is...", ru: "Биткоин..." },
    links: {
      homepage: ["http://bitcoin.org", "", ""],
      blockchain_site: ["https://mempool.space/", ""],
      whitepaper: "https://bitcoin.org/bitcoin.pdf",
      repos_url: { github: ["https://github.com/bitcoin/bitcoin"], bitbucket: [] },
      twitter_screen_name: "bitcoin",
      subreddit_url: "https://www.reddit.com/r/Bitcoin/",
    },
  };

  it("extracts description, links, twitter", () => {
    expect(parseCoinDetail(sample)).toEqual({
      id: "bitcoin",
      descriptionEn: "Bitcoin is...",
      websiteUrl: "http://bitcoin.org",
      explorerUrl: "https://mempool.space/",
      whitepaperUrl: "https://bitcoin.org/bitcoin.pdf",
      githubUrl: "https://github.com/bitcoin/bitcoin",
      twitterUrl: "https://twitter.com/bitcoin",
      redditUrl: "https://www.reddit.com/r/Bitcoin/",
    });
  });

  it("returns nulls for missing/empty fields", () => {
    const minimal = { id: "x" };
    expect(parseCoinDetail(minimal)).toEqual({
      id: "x",
      descriptionEn: null,
      websiteUrl: null,
      explorerUrl: null,
      whitepaperUrl: null,
      githubUrl: null,
      twitterUrl: null,
      redditUrl: null,
    });
  });

  it("throws on missing id", () => {
    expect(() => parseCoinDetail({})).toThrow();
  });
});

describe("parseMarketChart", () => {
  it("converts [ms, price] tuples into {time:sec, value}", () => {
    const raw = {
      prices: [
        [1700000000000, 100],
        [1700003600000, 105],
      ],
    };
    expect(parseMarketChart(raw)).toEqual([
      { time: 1700000000, value: 100 },
      { time: 1700003600, value: 105 },
    ]);
  });
  it("filters malformed entries", () => {
    expect(parseMarketChart({ prices: [[1, 2], ["bad"], null] })).toEqual([{ time: 0, value: 2 }]);
  });
  it("throws on missing prices array", () => {
    expect(() => parseMarketChart({})).toThrow();
  });
});

describe("parseTickers", () => {
  const ok = {
    market: { name: "Binance" },
    base: "BTC",
    target: "USDT",
    converted_last: { usd: 76791 },
    converted_volume: { usd: 788721355 },
    trade_url: "https://www.binance.com/en/trade/BTC_USDT",
  };
  it("extracts well-formed tickers", () => {
    expect(parseTickers({ tickers: [ok] })).toEqual([
      {
        exchange: "Binance",
        base: "BTC",
        target: "USDT",
        priceUsd: 76791,
        volumeUsd: 788721355,
        tradeUrl: "https://www.binance.com/en/trade/BTC_USDT",
      },
    ]);
  });
  it("skips entries without usd price or volume", () => {
    const bad = { ...ok, converted_last: {} };
    expect(parseTickers({ tickers: [bad] })).toEqual([]);
  });
  it("returns [] when tickers missing", () => {
    expect(parseTickers({})).toEqual([]);
  });
});
