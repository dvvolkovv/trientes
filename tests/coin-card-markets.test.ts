import { describe, it, expect } from "vitest";
import type { SnapshotFetch, SnapshotMap } from "../src/lib/cex-snapshot";
import {
  checkMarket,
  computeAnchorPrices,
  hourBucket,
  pruneCardPricePoints,
  resolveExchange,
  supplyForCap,
  syncCardMarkets,
  type MarketClaim,
  type PrismaLike,
} from "../src/lib/coin-card-markets";
import { getConnector } from "../src/lib/cex-registry";

const NOW = new Date("2026-11-07T14:37:12.000Z");

const claim = (over: Partial<MarketClaim> = {}): MarketClaim => ({
  id: "m1",
  kind: "CEX",
  exchangeId: null,
  exchangeName: "Binance",
  pair: "TAL/USDT",
  ...over,
});

function snapshotOf(id: string, body: unknown): SnapshotMap {
  const c = getConnector(id);
  if (!c) throw new Error(id);
  return new Map([[id, { id, tickers: c.parse(body), fetchedAt: NOW.toISOString() }]]);
}

const binance = (rows: Record<string, unknown>[]) => snapshotOf("binance", rows);

describe("resolveExchange", () => {
  it("DEX в этом слайсе не читается", () => {
    expect(resolveExchange(claim({ kind: "DEX", exchangeName: "Uniswap V3" }))).toBeNull();
  });

  it("предпочитает exchangeId свободному имени", () => {
    expect(resolveExchange(claim({ exchangeId: "kraken", exchangeName: "Binance" }))).toBe("kraken");
  });
});

describe("checkMarket", () => {
  const rows = [{ symbol: "TALUSDT", lastPrice: "2", quoteVolume: "500000", priceChangePercent: "4" }];

  it("подтверждает найденную пару и приводит объём к доллару", () => {
    const r = checkMarket(claim(), "TAL", binance(rows), {});
    expect(r.error).toBeNull();
    expect(r.fact).toEqual({
      nativeSymbol: "TALUSDT", quote: "USDT", priceUsd: 2, volumeUsd24h: 500000, changePct: 4,
    });
  });

  it("не находит пару, которой на бирже нет", () => {
    expect(checkMarket(claim({ pair: "TAL/USDC" }), "TAL", binance(rows), {}).error).toBe("pair_not_found");
  });

  it("незнакомая биржа честно не читается", () => {
    expect(checkMarket(claim({ exchangeName: "SomeDEXchange" }), "TAL", binance(rows), {}).error)
      .toBe("exchange_unsupported");
  });

  it("чужая база пары не подтверждается", () => {
    const r = checkMarket(claim({ pair: "BTC/USDT" }), "TAL", binance([
      { symbol: "BTCUSDT", lastPrice: "50000", quoteVolume: "1", priceChangePercent: "0" },
    ]), {});
    expect(r.error).toBe("base_mismatch");
  });

  it("крипто-котировка переводится через опорный индекс", () => {
    const r = checkMarket(claim({ pair: "TAL/BTC" }), "TAL", binance([
      { symbol: "TALBTC", lastPrice: "0.00004", quoteVolume: "10", priceChangePercent: "1" },
    ]), { BTC: 50_000 });
    expect(r.fact?.priceUsd).toBeCloseTo(2, 9);
    expect(r.fact?.volumeUsd24h).toBe(500_000);
  });

  it("без опорного индекса маршрута к доллару нет", () => {
    const r = checkMarket(claim({ pair: "TAL/BTC" }), "TAL", binance([
      { symbol: "TALBTC", lastPrice: "0.00004", quoteVolume: "10", priceChangePercent: "1" },
    ]), {});
    expect(r.error).toBe("no_usd_route");
  });

  it("отвал биржи виден отдельным кодом", () => {
    const snap: SnapshotMap = new Map([["binance", { id: "binance", error: "exchange_unreachable" }]]);
    expect(checkMarket(claim(), "TAL", snap, {}).error).toBe("exchange_unreachable");
  });

  it("неразбираемая пара", () => {
    expect(checkMarket(claim({ pair: "очень странно" }), "TAL", binance(rows), {}).error)
      .toBe("pair_unparsable");
  });
});

describe("computeAnchorPrices", () => {
  it("считает BTC по стейбл-парам нескольких бирж", () => {
    const snapshots: SnapshotMap = new Map([
      ...binance([
        { symbol: "BTCUSDT", lastPrice: "50000", quoteVolume: "900000000", priceChangePercent: "1" },
      ]),
      ...snapshotOf("kraken", {
        result: { XXBTZUSD: { c: ["50100"], v: ["1", "2000"], p: ["50000", "50050"], o: "49500" } },
      }),
      ["okx", { id: "okx", error: "exchange_unreachable" as const }],
    ]);
    const anchors = computeAnchorPrices(snapshots);
    expect(anchors.BTC).toBe(50000); // перевес объёма у Binance
    expect(anchors.ETH).toBeUndefined();
  });
});

describe("hourBucket", () => {
  it("округляет вниз до часа", () => {
    expect(hourBucket(NOW).toISOString()).toBe("2026-11-07T14:00:00.000Z");
  });
});

/* ─── прогон ─────────────────────────────────────────────────────────────── */

type Call = { table: string; args: Record<string, unknown> };

function fakePrisma(cards: unknown[]): { prisma: PrismaLike; calls: Call[] } {
  const calls: Call[] = [];
  const prisma: PrismaLike = {
    coinCard: {
      findMany: async () => cards as never,
      update: async (args) => { calls.push({ table: "card", args: args as Record<string, unknown> }); return null; },
    },
    coinCardMarket: {
      update: async (args) => { calls.push({ table: "market", args: args as Record<string, unknown> }); return null; },
    },
    coinCardPriceIndex: {
      upsert: async (args) => { calls.push({ table: "index", args: args as Record<string, unknown> }); return null; },
    },
    coinCardPricePoint: {
      upsert: async (args) => { calls.push({ table: "point", args: args as Record<string, unknown> }); return null; },
      deleteMany: async (args) => { calls.push({ table: "prune", args: args as Record<string, unknown> }); return { count: 7 }; },
    },
  };
  return { prisma, calls };
}

/** Снимки для восьми бирж: отвечают только названные, остальные — таймаут. */
function fetchFor(bodies: Record<string, unknown>): SnapshotFetch {
  return async (url: string) => {
    const id = Object.keys(bodies).find((key) => url.includes(key));
    if (!id) throw new Error("network down");
    return { ok: true, status: 200, json: async () => bodies[id] };
  };
}

const card = {
  id: "c1",
  symbol: "TAL",
  provenance: {},
  tokenomics: null,
  supply: null,
  markets: [
    { id: "m-binance", kind: "CEX", exchangeId: null, exchangeName: "Binance", pair: "TAL/USDT", priceUsd: null, volumeUsd24h: null },
    { id: "m-gate", kind: "CEX", exchangeId: null, exchangeName: "Gate.io", pair: "TAL/USDT", priceUsd: null, volumeUsd24h: null },
    { id: "m-ghost", kind: "CEX", exchangeId: null, exchangeName: "Kraken", pair: "TAL/USD", priceUsd: null, volumeUsd24h: null },
    { id: "m-dex", kind: "DEX", exchangeId: null, exchangeName: "Uniswap V3", pair: "TAL/WETH", priceUsd: 9, volumeUsd24h: 1 },
  ],
};

describe("syncCardMarkets", () => {
  it("пишет цены подтверждённым рынкам, помечает ненайденные и считает индекс", async () => {
    const { prisma, calls } = fakePrisma([card]);
    const stats = await syncCardMarkets({
      prisma,
      now: NOW,
      fetchImpl: fetchFor({
        "api.binance.com": [
          { symbol: "TALUSDT", lastPrice: "2.00", quoteVolume: "600000", priceChangePercent: "3" },
        ],
        "api.gateio.ws": [
          { currency_pair: "TAL_USDT", last: "2.02", quote_volume: "400000", change_percentage: "2" },
        ],
        "api.kraken.com": { result: { ADAUSD: { c: ["1"], v: ["1", "1"], p: ["1", "1"], o: "1" } } },
      }),
    });

    expect(stats).toEqual({ cards: 1, marketsChecked: 4, confirmed: 2, failed: 2, indexed: 1 });

    const markets = calls.filter((c) => c.table === "market");
    const byId = new Map(markets.map((c) => [(c.args.where as { id: string }).id, c.args.data as Record<string, unknown>]));
    expect(byId.get("m-binance")).toMatchObject({ priceUsd: 2, confirmedAt: NOW, checkError: null, isOutlier: false });
    expect(byId.get("m-ghost")).toMatchObject({ checkError: "pair_not_found", confirmedAt: null, priceUsd: null });
    expect(byId.get("m-dex")).toMatchObject({ checkError: "exchange_unsupported", priceUsd: null });

    const index = calls.find((c) => c.table === "index");
    expect(index?.args).toMatchObject({
      where: { cardId: "c1" },
      create: { cardId: "c1", marketCount: 2, confidence: "MEDIUM", method: "VWMEDIAN_V1" },
    });
    expect((index?.args.create as { priceUsd: number }).priceUsd).toBe(2);

    const point = calls.find((c) => c.table === "point");
    expect(point?.args).toMatchObject({ where: { cardId_at: { cardId: "c1", at: hourBucket(NOW) } } });

    const prov = calls.find((c) => c.table === "card");
    expect((prov?.args.data as { provenance: Record<string, unknown> }).provenance).toMatchObject({
      price: { kind: "AGGREGATED", source: "2", at: NOW.toISOString() },
    });
  });

  it("недоступная биржа не стирает прежнюю цену рынка", async () => {
    const { prisma, calls } = fakePrisma([{
      ...card,
      markets: [{ ...card.markets[0], priceUsd: 1.9, volumeUsd24h: 100 }],
    }]);
    const stats = await syncCardMarkets({ prisma, now: NOW, fetchImpl: fetchFor({}) });

    expect(stats.confirmed).toBe(0);
    expect(stats.indexed).toBe(0);
    const data = calls.find((c) => c.table === "market")?.args.data as Record<string, unknown>;
    expect(data).toMatchObject({ checkError: "exchange_unreachable", confirmedAt: null });
    expect(data).not.toHaveProperty("priceUsd");
  });

  it("частичный отвал бирж не мешает считать индекс", async () => {
    const { prisma, calls } = fakePrisma([card]);
    const stats = await syncCardMarkets({
      prisma,
      now: NOW,
      fetchImpl: fetchFor({
        "api.binance.com": [
          { symbol: "TALUSDT", lastPrice: "2.00", quoteVolume: "600000", priceChangePercent: "3" },
        ],
      }),
    });
    expect(stats.indexed).toBe(1);
    const index = calls.find((c) => c.table === "index");
    expect(index?.args).toMatchObject({ create: { marketCount: 1, confidence: "LOW" } });
  });

  it("без карточек не ходит в сеть вообще", async () => {
    const { prisma } = fakePrisma([]);
    let touched = false;
    const stats = await syncCardMarkets({
      prisma,
      now: NOW,
      fetchImpl: async () => { touched = true; throw new Error("не должно случиться"); },
    });
    expect(stats.cards).toBe(0);
    expect(touched).toBe(false);
  });
});

describe("supplyForCap", () => {
  it("берёт проверенный выпуск, когда он есть", () => {
    expect(
      supplyForCap({
        tokenomics: { circulating: 999, max: 2000 },
        supply: { circulating: "700", totalSupply: "1000" },
      }),
    ).toEqual({ circulating: "700", fdvBase: "2000", source: "ONCHAIN" });
  });

  it("без максимального выпуска FDV считается по общему из сети", () => {
    expect(
      supplyForCap({ tokenomics: {}, supply: { circulating: "700", totalSupply: "1000" } }),
    ).toEqual({ circulating: "700", fdvBase: "1000", source: "ONCHAIN" });
  });

  it("без записи из сети берёт заявление проекта и честно это помечает", () => {
    expect(supplyForCap({ tokenomics: { circulating: 500, total: 900 }, supply: null })).toEqual({
      circulating: "500",
      fdvBase: "900",
      source: "SELF_REPORTED",
    });
  });

  it("нечего умножать — нет и капитализации", () => {
    expect(supplyForCap({ tokenomics: {}, supply: null })).toEqual({
      circulating: null,
      fdvBase: null,
      source: "SELF_REPORTED",
    });
  });
});

describe("капитализация в индексе", () => {
  const feed = () =>
    fetchFor({
      "api.binance.com": [
        { symbol: "TALUSDT", lastPrice: "2.00", quoteVolume: "600000", priceChangePercent: "3" },
      ],
      "api.gateio.ws": [
        { currency_pair: "TAL_USDT", last: "2.02", quote_volume: "400000", change_percentage: "2" },
      ],
    });

  it("считается по проверенному выпуску и помечается ONCHAIN", async () => {
    const { prisma, calls } = fakePrisma([
      {
        ...card,
        tokenomics: { max: 2000 },
        supply: { circulating: "700", totalSupply: "1000" },
      },
    ]);
    await syncCardMarkets({ prisma, now: NOW, fetchImpl: feed() });

    const index = calls.find((c) => c.table === "index");
    expect(index?.args.create).toMatchObject({
      marketCapUsd: 1400,
      fdvUsd: 4000,
      supplySource: "ONCHAIN",
    });
    const prov = calls.find((c) => c.table === "card");
    expect((prov?.args.data as { provenance: Record<string, unknown> }).provenance).toMatchObject({
      marketCap: { kind: "AGGREGATED", source: "2", at: NOW.toISOString() },
    });
  });

  it("по заявлению проекта помечается SELF_REPORTED", async () => {
    const { prisma, calls } = fakePrisma([
      { ...card, tokenomics: { circulating: 300, total: 1000 }, supply: null },
    ]);
    await syncCardMarkets({ prisma, now: NOW, fetchImpl: feed() });

    const index = calls.find((c) => c.table === "index");
    expect(index?.args.create).toMatchObject({
      marketCapUsd: 600,
      fdvUsd: 2000,
      supplySource: "SELF_REPORTED",
    });
    const prov = calls.find((c) => c.table === "card");
    expect((prov?.args.data as { provenance: Record<string, unknown> }).provenance).toMatchObject({
      marketCap: { kind: "SELF_REPORTED", source: null, at: NOW.toISOString() },
    });
  });

  it("без выпуска вовсе капитализация остаётся пустой", async () => {
    const { prisma, calls } = fakePrisma([{ ...card, tokenomics: {}, supply: null }]);
    await syncCardMarkets({ prisma, now: NOW, fetchImpl: feed() });

    const index = calls.find((c) => c.table === "index");
    expect(index?.args.create).toMatchObject({
      marketCapUsd: null,
      fdvUsd: null,
      supplySource: null,
    });
    const prov = calls.find((c) => c.table === "card");
    expect((prov?.args.data as { provenance: Record<string, unknown> }).provenance).not.toHaveProperty(
      "marketCap",
    );
  });
});

describe("pruneCardPricePoints", () => {
  it("чистит точки старше 90 дней", async () => {
    const { prisma, calls } = fakePrisma([]);
    const count = await pruneCardPricePoints({ prisma, now: NOW });
    expect(count).toBe(7);
    const where = calls.find((c) => c.table === "prune")?.args.where as { at: { lt: Date } };
    expect(where.at.lt.toISOString()).toBe("2026-08-09T14:37:12.000Z");
  });
});

describe("supplyForCap и выпуск, относящийся к одной сети", () => {
  const supply = { circulating: "1000000", totalSupply: "1000000" };

  it("обычная проверенная строка выпуска идёт в капитализацию", () => {
    const got = supplyForCap({ tokenomics: {}, supply: { ...supply, checkError: null } });
    expect(got).toEqual({ circulating: "1000000", fdvBase: "1000000", source: "ONCHAIN" });
  });

  it("supply_share — считаем по заявлению, а не по остатку в одной сети", () => {
    const got = supplyForCap({
      tokenomics: { circulating: 999_000_000, total: 1_000_000_000 },
      supply: { ...supply, checkError: "supply_share" },
    });
    expect(got).toEqual({
      circulating: "999000000",
      fdvBase: "1000000000",
      source: "SELF_REPORTED",
    });
  });
});
