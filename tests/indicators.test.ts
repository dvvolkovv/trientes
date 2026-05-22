import { describe, it, expect } from "vitest";
import { sma, ema, bollinger, rsi, macd } from "@/lib/indicators";

describe("sma", () => {
  it("averages over the window, null before the window fills", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe("ema", () => {
  it("seeds with the SMA of the first window then smooths", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBeCloseTo(2, 6); // seed = sma(1,2,3)
    expect(out[3]).toBeCloseTo(3, 6); // 4*0.5 + 2*0.5
    expect(out[4]).toBeCloseTo(4, 6); // 5*0.5 + 3*0.5
  });
});

describe("bollinger", () => {
  it("returns mid/upper/lower with k*stddev band", () => {
    const b = bollinger([2, 4, 6, 8, 10], 5, 2);
    expect(b.mid[4]).toBeCloseTo(6, 6);
    // population stddev of [2,4,6,8,10] = sqrt(8) ≈ 2.828427
    expect(b.upper[4]).toBeCloseTo(6 + 2 * Math.sqrt(8), 6);
    expect(b.lower[4]).toBeCloseTo(6 - 2 * Math.sqrt(8), 6);
    expect(b.mid[3]).toBeNull();
  });
});

describe("rsi", () => {
  it("is 100 when all changes are gains", () => {
    const out = rsi([1, 2, 3, 4, 5, 6], 3);
    expect(out[0]).toBeNull();
    expect(out[out.length - 1]).toBeCloseTo(100, 6);
  });
  it("sits between 0 and 100 for an alternating series after warmup", () => {
    const out = rsi([10, 11, 10, 11, 10, 11, 10, 11], 2);
    expect(out[out.length - 1]).toBeGreaterThan(0);
    expect(out[out.length - 1]).toBeLessThan(100);
  });
});

describe("macd", () => {
  it("returns macd/signal/histogram aligned to input length", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const m = macd(closes, 12, 26, 9);
    expect(m.macd).toHaveLength(60);
    expect(m.signal).toHaveLength(60);
    expect(m.histogram).toHaveLength(60);
    // steady uptrend → macd line positive once defined
    expect(m.macd[59]!).toBeGreaterThan(0);
  });
});
