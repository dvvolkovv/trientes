import { describe, it, expect } from "vitest";
import { cardTopExchanges, topExchangesByVolume, listedAdapterExchanges } from "@/lib/listings";
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

describe("cardTopExchanges", () => {
  const m = (
    exchangeName: string,
    pair: string,
    priceUsd: number | null,
    volumeUsd24h: number | null,
    tradeUrl: string | null = null,
  ) => ({ exchangeName, pair, priceUsd, volumeUsd24h, tradeUrl });

  it("строит строку биржи из рынка карточки", () => {
    expect(
      cardTopExchanges([m("Trientes DEX", "TAL/USDT", 11995, 195.6, "https://x/#/swap/USDT-TAL")]),
    ).toEqual([
      {
        exchange: "Trientes DEX",
        base: "TAL",
        target: "USDT",
        priceUsd: 11995,
        volumeUsd: 195.6,
        tradeUrl: "https://x/#/swap/USDT-TAL",
      },
    ]);
  });

  it("рынок без цены в таблицу не идёт", () => {
    expect(cardTopExchanges([m("Trientes DEX", "LTC/BTC", null, null)])).toEqual([]);
  });

  it("неизвестный объём остаётся неизвестным и уходит в хвост", () => {
    const rows = cardTopExchanges([
      m("A", "TAL/USDT", 1, null),
      m("B", "TAL/USDC", 1, 10),
    ]);
    expect(rows.map((r) => r.exchange)).toEqual(["B", "A"]);
    expect(rows[1].volumeUsd).toBeNull();
  });
});
