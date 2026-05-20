import { describe, expect, it } from "vitest";
import { parseExchangeRates } from "@/lib/coingecko";

describe("parseExchangeRates", () => {
  const sample = {
    rates: {
      btc: { name: "Bitcoin", unit: "BTC", value: 1, type: "crypto" },
      usd: { name: "US Dollar", unit: "$", value: 76528.56, type: "fiat" },
      eur: { name: "Euro", unit: "€", value: 65998.61, type: "fiat" },
      eth: { name: "Ether", unit: "ETH", value: 36.34, type: "crypto" },
      garbage: { value: "not a number" },
      missing_value: { name: "X" },
    },
  };

  it("extracts known currencies", () => {
    const out = parseExchangeRates(sample);
    expect(out.usd.value).toBe(76528.56);
    expect(out.btc.value).toBe(1);
    expect(out.eth.type).toBe("crypto");
    expect(out.usd.unit).toBe("$");
  });

  it("skips entries without a numeric value", () => {
    const out = parseExchangeRates(sample);
    expect(out.garbage).toBeUndefined();
    expect(out.missing_value).toBeUndefined();
  });

  it("throws on missing rates root", () => {
    expect(() => parseExchangeRates({})).toThrow();
  });
});
