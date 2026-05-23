import { describe, expect, it } from "vitest";
import { parseFearGreed } from "@/lib/fear-greed";

describe("parseFearGreed", () => {
  it("extracts the latest reading from the alternative.me /fng response", () => {
    const raw = {
      name: "Fear and Greed Index",
      data: [
        {
          value: "40",
          value_classification: "Fear",
          timestamp: "1551157200",
          time_until_update: "68499",
        },
      ],
      metadata: { error: null },
    };
    expect(parseFearGreed(raw)).toEqual({
      value: 40,
      classification: "Fear",
      updatedAt: 1551157200,
    });
  });

  it("rounds non-integer values and trims the classification", () => {
    const raw = { data: [{ value: "74.6", value_classification: " Greed ", timestamp: "1700000000" }] };
    expect(parseFearGreed(raw)).toEqual({
      value: 75,
      classification: "Greed",
      updatedAt: 1700000000,
    });
  });

  it("falls back to now when the timestamp is missing or malformed", () => {
    const before = Math.floor(Date.now() / 1000);
    const fg = parseFearGreed({ data: [{ value: "50", value_classification: "Neutral" }] });
    expect(fg.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("throws on a malformed response", () => {
    expect(() => parseFearGreed({})).toThrow();
    expect(() => parseFearGreed({ data: [] })).toThrow();
    expect(() => parseFearGreed({ data: [{ value: "n/a", value_classification: "Fear" }] })).toThrow();
  });
});
