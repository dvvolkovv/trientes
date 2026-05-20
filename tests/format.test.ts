import { describe, expect, it } from "vitest";
import { formatPrice, formatCompact, formatPercent } from "@/lib/format";

describe("formatPrice", () => {
  it("uses 2 decimals for >= 1", () => {
    expect(formatPrice(76684)).toBe("$76,684.00");
    expect(formatPrice(2108.55)).toBe("$2,108.55");
    expect(formatPrice(1.05)).toBe("$1.05");
  });
  it("uses up to 6 decimals for < 1", () => {
    expect(formatPrice(0.04321)).toBe("$0.043210");
    expect(formatPrice(0.00001234)).toBe("$0.000012");
  });
  it("shows 0 cleanly", () => {
    expect(formatPrice(0)).toBe("$0.00");
  });
});

describe("formatCompact", () => {
  it("uses B/M/K suffixes", () => {
    expect(formatCompact(1_536_247_155_839)).toBe("$1.54T");
    expect(formatCompact(254_473_187_733)).toBe("$254.47B");
    expect(formatCompact(29_246_928_093)).toBe("$29.25B");
    expect(formatCompact(1_500_000)).toBe("$1.50M");
    expect(formatCompact(1_500)).toBe("$1.50K");
    expect(formatCompact(999)).toBe("$999.00");
  });
});

describe("formatPercent", () => {
  it("adds sign and 2 decimals", () => {
    expect(formatPercent(2.345)).toBe("+2.35%");
    expect(formatPercent(-1.234)).toBe("-1.23%");
    expect(formatPercent(0)).toBe("+0.00%");
  });
  it("returns em dash for null", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });
});
