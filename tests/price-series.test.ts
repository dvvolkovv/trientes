import { describe, expect, it } from "vitest";
import { summarizeSeries } from "@/lib/price-series";

describe("summarizeSeries", () => {
  it("returns null for an empty series", () => {
    expect(summarizeSeries([])).toBeNull();
  });

  it("handles a single point (flat, zero change)", () => {
    expect(summarizeSeries([{ time: 1, value: 5 }])).toEqual({
      first: 5,
      last: 5,
      min: 5,
      max: 5,
      change: 0,
      changePct: 0,
    });
  });

  it("computes first/last/min/max and the period change", () => {
    const s = summarizeSeries([
      { time: 0, value: 100 },
      { time: 1, value: 90 },
      { time: 2, value: 120 },
      { time: 3, value: 110 },
    ]);
    expect(s).toEqual({ first: 100, last: 110, min: 90, max: 120, change: 10, changePct: 10 });
  });

  it("reports a negative change with the right percent", () => {
    const s = summarizeSeries([
      { time: 0, value: 200 },
      { time: 1, value: 150 },
    ]);
    expect(s).toMatchObject({ change: -50, changePct: -25 });
  });

  it("guards against a zero baseline (no division by zero)", () => {
    const s = summarizeSeries([
      { time: 0, value: 0 },
      { time: 1, value: 5 },
    ]);
    expect(s).toMatchObject({ change: 5, changePct: 0 });
  });
});
