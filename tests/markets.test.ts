import { describe, expect, it } from "vitest";
import { parseStooqQuote } from "@/lib/markets";

describe("parseStooqQuote", () => {
  it("parses a single Stooq CSV quote line", () => {
    const out = parseStooqQuote("^DJI,2026-05-22,23:00:00,50434.7,50830.2,50434.7,50579.7");
    expect(out).toEqual({
      date: "2026-05-22",
      time: "23:00:00",
      open: 50434.7,
      high: 50830.2,
      low: 50434.7,
      close: 50579.7,
    });
  });

  it("ignores a header line and reads the last data row", () => {
    const csv = "Symbol,Date,Time,Open,High,Low,Close\nXAUUSD,2026-05-22,22:00:32,4544.08,4546.16,4492.33,4508.32\n";
    expect(parseStooqQuote(csv)?.close).toBe(4508.32);
  });

  it("returns null for an N/D (no-data) response", () => {
    expect(parseStooqQuote("XYZ,N/D,N/D,N/D,N/D,N/D,N/D")).toBeNull();
  });

  it("returns null for empty or malformed input", () => {
    expect(parseStooqQuote("")).toBeNull();
    expect(parseStooqQuote("garbage")).toBeNull();
    expect(parseStooqQuote("SYM,2026-05-22,23:00:00,not,a,number,x")).toBeNull();
  });
});
