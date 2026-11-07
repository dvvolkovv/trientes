import { describe, it, expect } from "vitest";
import {
  CEX,
  getConnector,
  lookupTicker,
  normalizeExchange,
  snapshotUrl,
} from "../src/lib/cex-registry";

const conn = (id: string) => {
  const c = getConnector(id);
  if (!c) throw new Error(`no connector ${id}`);
  return c;
};

describe("normalizeExchange", () => {
  it("узнаёт биржу в свободном вводе", () => {
    expect(normalizeExchange("Binance")).toBe("binance");
    expect(normalizeExchange("BINANCE Spot")).toBe("binance");
    expect(normalizeExchange("Gate.io")).toBe("gate");
    expect(normalizeExchange("OKEx")).toBe("okx");
    expect(normalizeExchange("Coinbase Pro")).toBe("coinbase");
  });

  it("не притворяется, что знает незнакомую биржу", () => {
    expect(normalizeExchange("LatokenXYZ")).toBeNull();
    expect(normalizeExchange("")).toBeNull();
    expect(normalizeExchange(null)).toBeNull();
  });
});

describe("snapshotUrl", () => {
  it("берёт адрес из реестра", () => {
    expect(snapshotUrl(conn("binance"), {})).toBe("https://api.binance.com/api/v3/ticker/24hr");
  });

  it("слушается переопределения в env", () => {
    const url = snapshotUrl(conn("binance"), { CEX_BASE_BINANCE: "http://proxy:8080/" });
    expect(url).toBe("http://proxy:8080/api/v3/ticker/24hr");
  });
});

describe("парсеры снимков", () => {
  it("binance и mexc", () => {
    const body = [
      { symbol: "TALUSDT", lastPrice: "0.0412", quoteVolume: "120000", priceChangePercent: "3.5" },
      { symbol: "BADUSDT", lastPrice: "oops", quoteVolume: "1", priceChangePercent: "0" },
    ];
    for (const id of ["binance", "mexc"]) {
      const m = conn(id).parse(body);
      expect(m.size).toBe(1); // мусор в цене выбрасывает рынок, а не роняет прогон
      expect(m.get("TALUSDT")).toEqual({
        nativeSymbol: "TALUSDT", price: 0.0412, quoteVolume: 120000, changePct: 3.5,
      });
    }
  });

  it("okx считает изменение от open24h", () => {
    const m = conn("okx").parse({
      data: [{ instId: "TAL-USDT", last: "110", volCcy24h: "5000", open24h: "100" }],
    });
    const t = m.get("TAL-USDT");
    expect(t?.price).toBe(110);
    expect(t?.quoteVolume).toBe(5000);
    expect(t?.changePct).toBeCloseTo(10, 9);
  });

  it("bybit переводит долю в проценты", () => {
    const m = conn("bybit").parse({
      result: { list: [{ symbol: "TALUSDT", lastPrice: "2", turnover24h: "900", price24hPcnt: "-0.05" }] },
    });
    expect(m.get("TALUSDT")?.changePct).toBeCloseTo(-5, 9);
  });

  it("kucoin берёт volValue как объём в котировке", () => {
    const m = conn("kucoin").parse({
      data: { ticker: [{ symbol: "TAL-USDT", last: "3", volValue: "700", changeRate: "0.012" }] },
    });
    const t = m.get("TAL-USDT");
    expect(t?.price).toBe(3);
    expect(t?.quoteVolume).toBe(700);
    expect(t?.changePct).toBeCloseTo(1.2, 9);
  });

  it("gate", () => {
    const m = conn("gate").parse([
      { currency_pair: "TAL_USDT", last: "0.5", quote_volume: "250", change_percentage: "-1.4" },
    ]);
    expect(m.get("TAL_USDT")?.price).toBe(0.5);
    expect(m.get("TAL_USDT")?.changePct).toBe(-1.4);
  });

  it("kraken: объём из базового умножается на vwap", () => {
    const m = conn("kraken").parse({
      result: {
        XXBTZUSD: { c: ["50000", "0.1"], v: ["10", "100"], p: ["49000", "49500"], o: "48000" },
      },
    });
    const t = m.get("XXBTZUSD");
    expect(t?.price).toBe(50000);
    expect(t?.quoteVolume).toBe(100 * 49500);
    expect(t?.changePct).toBeCloseTo(((50000 - 48000) / 48000) * 100, 9);
  });

  it("coinbase: объём в базовой монете переводится в котировку", () => {
    const m = conn("coinbase").parse({
      "TAL-USD": { stats_24hour: { last: "2", volume: "150", open: "1.9" } },
      "FLAT-USD": { last: "4", volume: "10", open: "4" },
    });
    expect(m.get("TAL-USD")?.quoteVolume).toBe(300);
    expect(m.get("FLAT-USD")?.quoteVolume).toBe(40); // плоская форма ответа тоже читается
  });

  it("пустой ответ и мусор дают пустой снимок, а не исключение", () => {
    for (const c of CEX) {
      expect(c.parse(null).size).toBe(0);
      expect(c.parse({}).size).toBe(0);
      expect(c.parse("nonsense").size).toBe(0);
      expect(c.parse([]).size).toBe(0);
    }
  });
});

describe("lookupTicker", () => {
  it("находит пару по формату биржи", () => {
    const c = conn("gate");
    const m = c.parse([{ currency_pair: "TAL_USDT", last: "1", quote_volume: "1", change_percentage: "0" }]);
    expect(lookupTicker(c, m, "TAL", "USDT")?.price).toBe(1);
    expect(lookupTicker(c, m, "TAL", "USDC")).toBeNull();
  });

  it("на kraken перебирает альтнеймы и классы активов", () => {
    const c = conn("kraken");
    const m = c.parse({ result: { XXBTZUSD: { c: ["50000"], v: ["1", "2"], p: ["1", "1"], o: "50000" } } });
    expect(lookupTicker(c, m, "BTC", "USD")?.price).toBe(50000);
  });
});
