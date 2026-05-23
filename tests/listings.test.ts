import { describe, it, expect } from "vitest";
import { topExchangesByVolume, listedAdapterExchanges } from "@/lib/listings";
import type { TickerRow } from "@/lib/coingecko";

const t = (exchange: string, volumeUsd: number, extra: Partial<TickerRow> = {}): TickerRow => ({
  exchange,
  base: "BTC",
  target: "USDT",
  priceUsd: 100,
  volumeUsd,
  tradeUrl: null,
  ...extra,
});

describe("topExchangesByVolume", () => {
  it("aggregates volume per exchange and keeps the highest-volume pair as representative", () => {
    const tickers: TickerRow[] = [
      t("Binance", 300, { target: "USDT", priceUsd: 100, tradeUrl: "https://b/usdt" }),
      t("Binance", 500, { target: "USDC", priceUsd: 101, tradeUrl: "https://b/usdc" }),
      t("Kraken", 400, { target: "USD", priceUsd: 99, tradeUrl: null }),
    ];
    const out = topExchangesByVolume(tickers);
    expect(out).toEqual([
      { exchange: "Binance", base: "BTC", target: "USDC", priceUsd: 101, volumeUsd: 800, tradeUrl: "https://b/usdc" },
      { exchange: "Kraken", base: "BTC", target: "USD", priceUsd: 99, volumeUsd: 400, tradeUrl: null },
    ]);
  });

  it("returns one distinct entry per exchange, sorted by summed volume descending", () => {
    const out = topExchangesByVolume([t("A", 10), t("B", 30), t("C", 20), t("B", 5)]);
    expect(out.map((e) => e.exchange)).toEqual(["B", "C", "A"]);
    expect(out.find((e) => e.exchange === "B")?.volumeUsd).toBe(35);
  });

  it("caps the result to the limit", () => {
    const out = topExchangesByVolume([t("A", 10), t("B", 30), t("C", 20)], 2);
    expect(out.map((e) => e.exchange)).toEqual(["B", "C"]);
  });

  it("returns an empty array for no tickers", () => {
    expect(topExchangesByVolume([])).toEqual([]);
  });
});

describe("listedAdapterExchanges", () => {
  it("normalizes ticker exchange names to adapter ids and ignores unknown venues", () => {
    const tickers = [
      t("Binance", 1),
      t("Crypto.com Exchange", 1),
      t("KuCoin", 1),
      t("Bybit", 1),
      t("Kraken", 1),
      t("SomeUnknownDEX", 1),
    ];
    expect([...listedAdapterExchanges(tickers)].sort()).toEqual(["binance", "bybit", "cryptocom", "kraken", "kucoin"]);
  });

  it("maps the bare 'Crypto.com' name to cryptocom", () => {
    expect([...listedAdapterExchanges([t("Crypto.com", 1)])]).toEqual(["cryptocom"]);
  });

  it("returns an empty set for no tickers", () => {
    expect(listedAdapterExchanges([]).size).toBe(0);
  });
});
