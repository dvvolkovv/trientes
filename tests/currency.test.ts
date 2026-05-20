import { describe, expect, it } from "vitest";
import {
  convert,
  formatPriceInCurrency,
  formatCompactInCurrency,
  CURRENCIES,
  type Currency,
} from "@/lib/currency";
import type { ExchangeRates } from "@/lib/coingecko";

const rates: ExchangeRates = {
  btc: { name: "Bitcoin", unit: "BTC", value: 1, type: "crypto" },
  eth: { name: "Ether", unit: "ETH", value: 36, type: "crypto" },
  usd: { name: "US Dollar", unit: "$", value: 75000, type: "fiat" },
  eur: { name: "Euro", unit: "€", value: 70000, type: "fiat" },
  rub: { name: "Russian Ruble", unit: "₽", value: 5_400_000, type: "fiat" },
};

describe("convert", () => {
  it("returns USD price as-is", () => {
    expect(convert(100, "USD", rates)).toBe(100);
  });
  it("converts to EUR via rates ratio", () => {
    // 100 USD = (100 / 75000) BTC = 0.001333 BTC; in EUR = 0.001333 * 70000 = 93.33
    expect(convert(100, "EUR", rates)).toBeCloseTo(93.333, 2);
  });
  it("converts to BTC", () => {
    // 1 BTC value=1 in rates; 75000 USD = 1 BTC
    expect(convert(75000, "BTC", rates)).toBeCloseTo(1, 5);
  });
  it("converts to ETH", () => {
    // 75000 USD = 1 BTC = 36 ETH
    expect(convert(75000, "ETH", rates)).toBeCloseTo(36, 5);
  });
  it("returns NaN when target rate missing", () => {
    expect(Number.isNaN(convert(100, "JPY" as Currency, rates))).toBe(true);
  });
});

describe("formatPriceInCurrency", () => {
  it("formats USD with $ prefix and 2 decimals", () => {
    expect(formatPriceInCurrency(1234.56, "USD", rates)).toBe("$1,234.56");
  });
  it("formats EUR with €", () => {
    // 1234.56 USD → ~1152.59 EUR with the test rates
    const out = formatPriceInCurrency(1234.56, "EUR", rates);
    expect(out.startsWith("€")).toBe(true);
  });
  it("formats RUB with ₽ suffix (Cyrillic convention) or prefix — accept prefix for now", () => {
    expect(formatPriceInCurrency(1, "RUB", rates).includes("₽")).toBe(true);
  });
  it("formats BTC with 6 decimals and ₿ prefix", () => {
    // 75000 USD = 1 BTC
    expect(formatPriceInCurrency(75000, "BTC", rates)).toBe("₿1.000000");
  });
  it("formats ETH with 4 decimals and Ξ prefix", () => {
    expect(formatPriceInCurrency(75000, "ETH", rates)).toBe("Ξ36.0000");
  });
  it("uses CN¥ for CNY to disambiguate from JPY ¥", () => {
    const ratesWithCNY = { ...rates, cny: { name: "Yuan", unit: "¥", value: 520_000, type: "fiat" as const } };
    expect(formatPriceInCurrency(1, "CNY", ratesWithCNY).startsWith("CN¥")).toBe(true);
  });
});

describe("formatCompactInCurrency", () => {
  it("uses currency prefix with T/B/M/K suffixes", () => {
    expect(formatCompactInCurrency(1.5e12, "USD", rates)).toBe("$1.50T");
    const eurOut = formatCompactInCurrency(1e9, "EUR", rates);
    expect(eurOut.startsWith("€") && eurOut.endsWith("M")).toBe(true);  // 1B USD * (70k/75k) = ~933M EUR
  });
});

describe("CURRENCIES", () => {
  it("lists exactly 8 currencies", () => {
    expect(CURRENCIES).toEqual(["USD", "EUR", "RUB", "GBP", "JPY", "CNY", "BTC", "ETH"]);
  });
});
