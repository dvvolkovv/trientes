import { describe, it, expect } from "vitest";
import {
  parseBybit,
  parseKucoin,
  parseCryptocom,
  parseKraken,
  baseTicker,
  exchangeSupports,
} from "@/lib/exchanges";

describe("parseBybit", () => {
  it("reverses newest-first list to oldest-first OHLCV", () => {
    const raw = {
      result: {
        list: [
          ["1779469200000", "76950.5", "77102.2", "76775.7", "76988.8", "336.99", "x"],
          ["1779465600000", "76795.7", "77008.1", "76773.1", "76950.5", "308.36", "x"],
        ],
      },
    };
    const out = parseBybit(raw);
    expect(out[0]).toEqual({ time: 1779465600, open: 76795.7, high: 77008.1, low: 76773.1, close: 76950.5, volume: 308.36 });
    expect(out[1].time).toBe(1779469200);
  });
});

describe("parseKucoin", () => {
  it("reverses and maps [time,open,close,high,low,volume] (time in seconds)", () => {
    const raw = {
      data: [
        ["1779469200", "76950.3", "76984.2", "77095", "76769.2", "42.96", "x"],
        ["1779465600", "76796", "76950.2", "76999", "76772.8", "34.54", "x"],
      ],
    };
    const out = parseKucoin(raw);
    expect(out[0]).toEqual({ time: 1779465600, open: 76796, high: 76999, low: 76772.8, close: 76950.2, volume: 34.54 });
    expect(out[1].time).toBe(1779469200);
  });
});

describe("parseCryptocom", () => {
  it("maps {t,o,h,l,c,v} objects (time in ms, already oldest-first)", () => {
    const raw = {
      result: {
        data: [
          { o: "80694.11", h: "80761.94", l: "80651.44", c: "80736.00", v: "17.18", t: 1778392800000 },
          { o: "80736.00", h: "80804.45", l: "80715.65", c: "80736.04", v: "11.27", t: 1778396400000 },
        ],
      },
    };
    const out = parseCryptocom(raw);
    expect(out[0]).toEqual({ time: 1778392800, open: 80694.11, high: 80761.94, low: 80651.44, close: 80736, volume: 17.18 });
    expect(out[1].time).toBe(1778396400);
  });
});

describe("parseKraken", () => {
  it("reads the pair-keyed array, maps [time,o,h,l,c,vwap,volume]", () => {
    const raw = {
      result: {
        XXBTZUSD: [
          [1776877200, "78753.9", "79082.9", "78730.2", "78927.8", "78911.8", "64.30", 2195],
          [1776880800, "78927.8", "79167.1", "78873.1", "79031.7", "78985.5", "44.62", 1828],
        ],
        last: 1776880800,
      },
    };
    const out = parseKraken(raw);
    expect(out[0]).toEqual({ time: 1776877200, open: 78753.9, high: 79082.9, low: 78730.2, close: 78927.8, volume: 64.3 });
    expect(out).toHaveLength(2);
  });
});

describe("baseTicker", () => {
  it("derives the base ticker from the Binance pair map", () => {
    expect(baseTicker("bitcoin")).toBe("BTC");
    expect(baseTicker("solana")).toBe("SOL");
    expect(baseTicker("unknown-coin")).toBeNull();
  });

  it("falls back to the coin's own symbol for coins outside the curated map", () => {
    // Dash isn't in CG_TO_BINANCE but DASHUSDT is a real Binance/Bybit/etc. pair.
    expect(baseTicker("dash", "DASH")).toBe("DASH");
    expect(baseTicker("dash", "dash")).toBe("DASH"); // normalizes case
  });

  it("prefers the curated map over a passed symbol", () => {
    // Curated map is authoritative where a CG id's ticker would mislead.
    expect(baseTicker("bitcoin", "XBT")).toBe("BTC");
  });

  it("rejects malformed symbols so nothing unsafe reaches exchange URLs", () => {
    expect(baseTicker("evil", "../../x")).toBeNull();
    expect(baseTicker("evil", "")).toBeNull();
    expect(baseTicker("unknown-coin")).toBeNull();
  });
});

describe("exchangeSupports", () => {
  it("only Binance supports 1s; KuCoin/Kraken lack 1M", () => {
    expect(exchangeSupports("binance", "1s")).toBe(true);
    expect(exchangeSupports("bybit", "1s")).toBe(false);
    expect(exchangeSupports("kucoin", "1M")).toBe(false);
    expect(exchangeSupports("kraken", "1M")).toBe(false);
    expect(exchangeSupports("cryptocom", "1M")).toBe(true);
    expect(exchangeSupports("kraken", "1h")).toBe(true);
  });
});
