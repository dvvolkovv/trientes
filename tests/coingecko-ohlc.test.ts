import { describe, it, expect } from "vitest";
import { parseOhlc } from "@/lib/coingecko";

describe("parseOhlc", () => {
  it("maps [ms,o,h,l,c] rows to OHLCV with volume 0 and time in seconds", () => {
    const raw = [
      [1700000000000, 100, 110, 95, 105],
      [1700086400000, 105, 120, 104, 118],
    ];
    expect(parseOhlc(raw)).toEqual([
      { time: 1700000000, open: 100, high: 110, low: 95, close: 105, volume: 0 },
      { time: 1700086400, open: 105, high: 120, low: 104, close: 118, volume: 0 },
    ]);
  });
});
