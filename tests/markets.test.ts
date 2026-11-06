import { describe, expect, it } from "vitest";
import { parseCnbcQuotes, MARKET_INSTRUMENTS } from "@/lib/markets";

// Trimmed to the fields the mapper reads; shape copied from a live CNBC response.
function body(quotes: unknown[]): string {
  return JSON.stringify({ FormattedQuoteResult: { FormattedQuote: quotes } });
}

const DJI = {
  symbol: ".DJI",
  code: 0,
  name: "Dow Jones Industrial Average",
  last: "51,523.06",
  open: "53,679.01",
  high: "53,710.61",
  low: "51,486.82",
  change_pct: "-3.44%",
  last_time: "2026-11-05",
};

const CRUDE = {
  symbol: "@CL.1",
  code: 0,
  name: "WTI Crude (Dec'26)",
  last: "91.65",
  open: "91.20",
  high: "92.53",
  low: "90.89",
  change_pct: "+1.25%",
  last_time: "2026-11-06T01:06:00.000-0500",
};

describe("parseCnbcQuotes", () => {
  it("maps a quote onto its instrument, stripping thousands separators and the % sign", () => {
    const [q] = parseCnbcQuotes(body([DJI]));
    expect(q).toEqual({
      symbol: ".DJI",
      name: "Dow Jones",
      group: "index",
      unit: "pts",
      date: "2026-11-05",
      time: null,
      open: 53679.01,
      high: 53710.61,
      low: 51486.82,
      last: 51523.06,
      changePct: -3.44,
    });
  });

  it("converts an offset timestamp to UTC date and time", () => {
    const [q] = parseCnbcQuotes(body([CRUDE]));
    // 01:06:00 -0500 → 06:06:00 UTC, same calendar day
    expect(q.date).toBe("2026-11-06");
    expect(q.time).toBe("06:06:00");
    expect(q.last).toBe(91.65);
    expect(q.changePct).toBe(1.25);
  });

  it("keeps instrument order and skips unknown or errored symbols", () => {
    const out = parseCnbcQuotes(body([CRUDE, { symbol: "@ES.1", code: 1 }, { symbol: "@NOPE.1", code: 0, last: "1" }, DJI]));
    expect(out.map((q) => q.symbol)).toEqual([".DJI", "@CL.1"]);
  });

  it("falls back to the session move when change_pct is not a number", () => {
    const [q] = parseCnbcQuotes(body([{ ...CRUDE, change_pct: "UNCH" }]));
    expect(q.changePct).toBeCloseTo(((91.65 - 91.2) / 91.2) * 100, 6);
  });

  it("nulls out non-numeric OHLC fields instead of emitting NaN", () => {
    const [q] = parseCnbcQuotes(body([{ ...CRUDE, high: "-", low: null, change_pct: "UNCH", open: "-" }]));
    expect(q.high).toBeNull();
    expect(q.low).toBeNull();
    expect(q.open).toBeNull();
    expect(q.changePct).toBeNull();
    expect(q.last).toBe(91.65);
  });

  it("drops a quote with no usable last price", () => {
    expect(parseCnbcQuotes(body([{ ...CRUDE, last: "-" }]))).toEqual([]);
  });

  it("accepts a single quote returned as an object rather than an array", () => {
    expect(parseCnbcQuotes(body(DJI as never)).map((q) => q.symbol)).toEqual([".DJI"]);
  });

  it("returns an empty list for malformed or empty bodies", () => {
    expect(parseCnbcQuotes("")).toEqual([]);
    expect(parseCnbcQuotes("not json")).toEqual([]);
    expect(parseCnbcQuotes("{}")).toEqual([]);
    expect(parseCnbcQuotes(body([]))).toEqual([]);
  });

  it("covers every configured instrument with a unique symbol", () => {
    const symbols = MARKET_INSTRUMENTS.map((i) => i.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(symbols.length).toBe(10);
  });
});
