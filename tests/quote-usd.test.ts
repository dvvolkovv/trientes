import { describe, it, expect } from "vitest";
import { isAnchor, quoteToUsd } from "../src/lib/quote-usd";

describe("quoteToUsd", () => {
  it("стейбл = доллар", () => {
    for (const q of ["USDT", "usdc", "FDUSD", "DAI", "USD"]) {
      expect(quoteToUsd(q, {})).toEqual({ usd: 1 });
    }
  });

  it("опорная монета — по нашему индексу", () => {
    expect(quoteToUsd("BTC", { BTC: 50000 })).toEqual({ usd: 50000 });
  });

  it("без опорного индекса маршрута нет", () => {
    expect(quoteToUsd("BTC", {})).toEqual({ error: "no_usd_route" });
    expect(quoteToUsd("BTC", { BTC: 0 })).toEqual({ error: "no_usd_route" });
    expect(quoteToUsd("BTC", { BTC: Number.NaN })).toEqual({ error: "no_usd_route" });
  });

  it("фиат, кроме доллара, отбрасывается явно", () => {
    expect(quoteToUsd("EUR", { BTC: 50000 })).toEqual({ error: "no_usd_route" });
    expect(quoteToUsd("TRY", {})).toEqual({ error: "no_usd_route" });
  });

  it("опорные монеты перечислены", () => {
    expect(isAnchor("eth")).toBe(true);
    expect(isAnchor("TAL")).toBe(false);
  });
});
