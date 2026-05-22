import { describe, it, expect } from "vitest";
import { TIMEFRAMES, ALLOWED_INTERVALS } from "@/lib/chart-intervals";

// Seconds covered by one candle of each Binance interval (for span checks).
const CANDLE_SECONDS: Record<string, number> = {
  "1s": 1,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
  "1M": 2592000,
};

describe("TIMEFRAMES", () => {
  it("has no two modes that render identically", () => {
    // Two buttons with the same (interval, limit) draw the exact same chart —
    // that's the 1D/1Y bug. Every mode must be visibly distinct.
    const seen = new Map<string, string>();
    for (const f of TIMEFRAMES) {
      const sig = `${f.interval}:${f.limit}`;
      expect(seen.has(sig), `"${f.key}" renders identically to "${seen.get(sig)}" (${sig})`).toBe(false);
      seen.set(sig, f.key);
    }
  });

  it("every mode requests an interval the API route accepts", () => {
    for (const f of TIMEFRAMES) {
      expect(ALLOWED_INTERVALS.has(f.interval), `interval "${f.interval}" for "${f.key}" is not allowed`).toBe(true);
    }
  });

  it("calendar ranges 1D < 1W < 1M < 1Y and top out at ~1 year", () => {
    const span = (key: string) => {
      const f = TIMEFRAMES.find((t) => t.key === key)!;
      return f.limit * CANDLE_SECONDS[f.interval];
    };
    const year = 366 * 86400;
    for (const key of ["1d", "1w", "1M", "1y"]) {
      expect(span(key), `${key} exceeds one year`).toBeLessThanOrEqual(year);
    }
    expect(span("1d")).toBeLessThan(span("1w"));
    expect(span("1w")).toBeLessThan(span("1M"));
    expect(span("1M")).toBeLessThan(span("1y"));
  });
});
