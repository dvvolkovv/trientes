import { describe, expect, it } from "vitest";
import { CEX, connectorForDirectory, getConnector } from "../src/lib/cex-registry";
import {
  matchExchangeCoins,
  COIN_PRICE_TOLERANCE,
  MAX_REFERENCE_AGE_MS,
  type CoinCandidate,
} from "../src/lib/exchange-coins";

const NOW = new Date("2026-11-12T12:00:00.000Z");
const fresh = (priceUsd: number) => ({ priceUsd, fetchedAt: new Date(NOW.getTime() - 60_000) });

const binance = getConnector("binance")!;
const tickers = (rows: Record<string, unknown>[]) => binance.parse(rows);
const row = (symbol: string, lastPrice: string, quoteVolume = "1000") => ({
  symbol,
  lastPrice,
  quoteVolume,
  priceChangePercent: "2.5",
});

const coin = (symbol: string, reference: CoinCandidate["reference"]): CoinCandidate => ({
  id: symbol.toLowerCase(),
  symbol,
  name: symbol,
  slug: symbol.toLowerCase(),
  logoUrl: null,
  reference,
});

describe("реестр коннекторов знает свою строку каталога", () => {
  it("у каждого коннектора свой непустой directoryId", () => {
    const ids = CEX.map((c) => c.directoryId);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("обратный поиск находит коннектор по id каталога и молчит о чужой бирже", () => {
    // Расхождение id — та самая причина, по которой связь пришпилена в коде.
    expect(connectorForDirectory("gdax")?.id).toBe("coinbase");
    expect(connectorForDirectory("bybit_spot")?.id).toBe("bybit");
    expect(connectorForDirectory("mxc")?.id).toBe("mexc");
    expect(connectorForDirectory("okex")?.id).toBe("okx");
    expect(connectorForDirectory("huobi")).toBeNull();
    expect(connectorForDirectory(null)).toBeNull();
  });
});

describe("matchExchangeCoins", () => {
  it("находит монету каталога в снимке биржи и берёт числа биржи", () => {
    const r = matchExchangeCoins(binance, tickers([row("TIAUSDT", "2.02", "5000")]), [coin("TIA", fresh(2))], NOW);
    expect(r.unverified).toBe(0);
    expect(r.rows).toEqual([
      {
        id: "tia",
        symbol: "TIA",
        name: "TIA",
        slug: "tia",
        logoUrl: null,
        pair: "TIA/USDT",
        priceUsd: 2.02,
        changePct: 2.5,
        volumeUsd24h: 5000,
        pairs: 1,
      },
    ]);
  });

  it("лучшая пара монеты — самая объёмная, остальные только считаются", () => {
    const r = matchExchangeCoins(
      binance,
      tickers([row("TIAUSDT", "2.02", "5000"), row("TIAUSDC", "2.01", "9000")]),
      [coin("TIA", fresh(2))],
      NOW,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].pair).toBe("TIA/USDC");
    expect(r.rows[0].pairs).toBe(2);
  });

  it("тикер-двойник не попадает в список", () => {
    // SAGA на бирже носит и другой актив: цена расходится с опорой в разы.
    const r = matchExchangeCoins(binance, tickers([row("SAGAUSDT", "9.9")]), [coin("SAGA", fresh(0.3))], NOW);
    expect(r.rows).toEqual([]);
    expect(r.rejected).toEqual(["SAGA/USDT"]);
  });

  it("сошедшаяся пара спасает монету, разошедшаяся отбрасывается", () => {
    const r = matchExchangeCoins(
      binance,
      tickers([row("BANDUSDT", "0.31", "100"), row("BANDBUSD", "1.24", "900000")]),
      [coin("BAND", fresh(0.3))],
      NOW,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].pair).toBe("BAND/USDT");
    expect(r.rows[0].pairs).toBe(1);
    expect(r.rejected).toEqual(["BAND/BUSD"]);
  });

  it("монета без опоры не показывается и считается вслух", () => {
    const r = matchExchangeCoins(binance, tickers([row("UNQUSDT", "0.5")]), [coin("UNQ", null)], NOW);
    expect(r.rows).toEqual([]);
    expect(r.unverified).toBe(1);
  });

  it("опора старше двух суток не защищает", () => {
    const stale = { priceUsd: 2, fetchedAt: new Date(NOW.getTime() - MAX_REFERENCE_AGE_MS - 1) };
    const r = matchExchangeCoins(binance, tickers([row("TIAUSDT", "2.02")]), [coin("TIA", stale)], NOW);
    expect(r.rows).toEqual([]);
    expect(r.unverified).toBe(1);
  });

  it("монета без опоры, которой биржа не торгует, в счётчик не идёт", () => {
    // Счётчик говорит «скрыто из-за опоры», а не «монет в каталоге больше».
    const r = matchExchangeCoins(binance, tickers([row("TIAUSDT", "2.02")]), [coin("XYZ", null)], NOW);
    expect(r.unverified).toBe(0);
  });

  it("крипто-котировку от себя не берём", () => {
    const r = matchExchangeCoins(binance, tickers([row("TIABTC", "0.00002")]), [coin("TIA", fresh(2))], NOW);
    expect(r.rows).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it("допуск по цене — объявленная величина, а не случайная", () => {
    const near = 2 * (1 + COIN_PRICE_TOLERANCE - 0.01);
    const far = 2 * (1 + COIN_PRICE_TOLERANCE + 0.01);
    expect(matchExchangeCoins(binance, tickers([row("AUSDT", String(near))]), [coin("A", fresh(2))], NOW).rows).toHaveLength(1);
    expect(matchExchangeCoins(binance, tickers([row("AUSDT", String(far))]), [coin("A", fresh(2))], NOW).rows).toHaveLength(0);
  });

  it("стейбл сам себе не пара", () => {
    const r = matchExchangeCoins(binance, tickers([row("USDTUSDT", "1")]), [coin("USDT", fresh(1))], NOW);
    expect(r.rows).toEqual([]);
  });

  it("сортировка по объёму вниз, пустой объём в хвосте", () => {
    const snap = tickers([
      { symbol: "AUSDT", lastPrice: "2", quoteVolume: "10" },
      { symbol: "BUSDT", lastPrice: "2", quoteVolume: "900" },
      { symbol: "CUSDT", lastPrice: "2" },
    ]);
    const r = matchExchangeCoins(binance, snap, [coin("A", fresh(2)), coin("B", fresh(2)), coin("C", fresh(2))], NOW);
    expect(r.rows.map((x) => x.symbol)).toEqual(["B", "A", "C"]);
  });
});
