import { describe, it, expect } from "vitest";
import { parseCoinPaprikaExchange, cpTypeToExchangeType, resolveCpId, CP_TO_CG_ALIAS } from "@/lib/coinpaprika";

describe("parseCoinPaprikaExchange", () => {
  const sample = {
    id: "richamster",
    name: "Richamster",
    type: ["cex"],
    description: "Short description.",
    active: true,
    markets_data_fetched: true,
    adjusted_rank: 217,
    currencies: 24,
    fiats: [{ name: "Ukrainian Hryvnia", symbol: "UAH" }],
    quotes: { USD: { adjusted_volume_24h: 77211.14 } },
    links: { twitter: ["https://twitter.com/Richamster_com"], website: ["https://richamster.com"] },
    last_updated: "2026-05-26T19:27:34Z",
  };

  it("parses a well-formed CoinPaprika exchange", () => {
    const out = parseCoinPaprikaExchange(sample);
    expect(out).toEqual({
      id: "richamster",
      name: "Richamster",
      type: ["cex"],
      description: "Short description.",
      active: true,
      markets_data_fetched: true,
      adjusted_rank: 217,
      currencies: 24,
      fiats: [{ name: "Ukrainian Hryvnia", symbol: "UAH" }],
      volume24hUsd: 77211.14,
      links: { twitter: ["https://twitter.com/Richamster_com"], website: ["https://richamster.com"] },
    });
  });

  it("returns null on malformed payload (missing id)", () => {
    expect(parseCoinPaprikaExchange({ name: "X" })).toBeNull();
  });

  it("defaults missing volume to 0", () => {
    const v = parseCoinPaprikaExchange({ ...sample, quotes: {} });
    expect(v?.volume24hUsd).toBe(0);
  });
});

describe("cpTypeToExchangeType", () => {
  it("maps cex to CEX", () => {
    expect(cpTypeToExchangeType(["cex"])).toBe("CEX");
  });
  it("maps dex to DEX", () => {
    expect(cpTypeToExchangeType(["dex"])).toBe("DEX");
  });
  it("maps both cex and dex to HYBRID", () => {
    expect(cpTypeToExchangeType(["cex", "dex"])).toBe("HYBRID");
  });
  it("maps spot to CEX", () => {
    expect(cpTypeToExchangeType(["spot"])).toBe("CEX");
  });
  it("maps perpetuals to CEX", () => {
    expect(cpTypeToExchangeType(["perpetuals"])).toBe("CEX");
  });
  it("maps other to OTHER", () => {
    expect(cpTypeToExchangeType(["other"])).toBe("OTHER");
  });
  it("returns null for empty array", () => {
    expect(cpTypeToExchangeType([])).toBeNull();
  });
});

describe("resolveCpId", () => {
  it("returns the alias target when present", () => {
    expect(resolveCpId("coinbase")).toBe("gdax");
  });
  it("returns the input id when no alias is set", () => {
    expect(resolveCpId("xeggex")).toBe("xeggex");
  });
  it("CP_TO_CG_ALIAS contains the coinbase→gdax mapping", () => {
    expect(CP_TO_CG_ALIAS.coinbase).toBe("gdax");
  });
});
