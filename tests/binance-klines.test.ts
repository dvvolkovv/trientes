import { describe, it, expect } from "vitest";
import { parseKline, type OHLCV } from "@/lib/binance-klines";

describe("parseKline", () => {
  it("maps a Binance kline tuple to OHLCV with time in seconds", () => {
    // [openTime, open, high, low, close, volume, closeTime, ...]
    const tuple = [
      1700000000000, "100.5", "110.0", "99.0", "105.25", "12.5",
      1700000059999, "0", 0, "0", "0", "0",
    ];
    const out: OHLCV = parseKline(tuple);
    expect(out).toEqual({
      time: 1700000000,
      open: 100.5,
      high: 110,
      low: 99,
      close: 105.25,
      volume: 12.5,
    });
  });
});
