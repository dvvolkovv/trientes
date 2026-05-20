import { describe, expect, it } from "vitest";
import { CG_TO_BINANCE, BINANCE_TO_CG, parseMiniTicker } from "@/lib/live/binance-mapping";

describe("binance mapping", () => {
  it("CG_TO_BINANCE has 20 entries", () => {
    expect(Object.keys(CG_TO_BINANCE)).toHaveLength(20);
  });
  it("round-trips", () => {
    for (const [cg, bn] of Object.entries(CG_TO_BINANCE)) {
      expect(BINANCE_TO_CG[bn]).toBe(cg);
    }
  });
});

describe("parseMiniTicker", () => {
  it("extracts symbol and close price", () => {
    expect(parseMiniTicker({ e: "24hrMiniTicker", s: "BTCUSDT", c: "70123.45" })).toEqual({
      binancePair: "BTCUSDT",
      price: 70123.45,
    });
  });
  it("rejects wrong event types", () => {
    expect(parseMiniTicker({ e: "trade", s: "BTCUSDT", c: "1" })).toBeNull();
  });
  it("rejects missing/non-numeric price", () => {
    expect(parseMiniTicker({ e: "24hrMiniTicker", s: "BTCUSDT" })).toBeNull();
    expect(parseMiniTicker({ e: "24hrMiniTicker", s: "BTCUSDT", c: "abc" })).toBeNull();
  });
});
