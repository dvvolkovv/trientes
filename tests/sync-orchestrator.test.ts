import { describe, expect, it, vi } from "vitest";
import { syncPrices, syncGlobal, syncExchangeRates, syncExchanges, syncAdminAddedPrices, syncFearGreed, syncMarkets, syncCoinPaprikaExchanges } from "@/lib/sync/orchestrator";
import { KEYS } from "@/lib/sync/keys";
import type { MarketRow, GlobalSnap, Exchange } from "@/lib/coingecko";
import type { FearGreed } from "@/lib/fear-greed";
import type { CoinPaprikaExchange, CoinPaprikaExchangeDetail } from "@/lib/coinpaprika";

function makeFakes() {
  const redisStore = new Map<string, string>();
  const fakeRedis = {
    set: vi.fn(async (k: string, v: string, _mode: string, _ttl: number) => {
      redisStore.set(k, v);
      return "OK";
    }),
  };
  const upsertedCoins: Array<{ id: string; rank: number }> = [];
  const createdSnapshots: Array<{ coinId: string; priceUsd: number }> = [];
  const fakePrisma = {
    coin: {
      upsert: vi.fn(async ({ where, update, create }: any) => {
        upsertedCoins.push({ id: where.id, rank: create.rank });
        return { id: where.id, ...create, ...update };
      }),
    },
    coinSnapshot: {
      create: vi.fn(async ({ data }: any) => {
        createdSnapshots.push({ coinId: data.coinId, priceUsd: data.priceUsd });
        return { id: "s1", ...data };
      }),
    },
    globalStats: {
      upsert: vi.fn(async ({ create }: any) => create),
    },
  };
  return { redisStore, fakeRedis, fakePrisma, upsertedCoins, createdSnapshots };
}

const row: MarketRow = {
  id: "bitcoin",
  symbol: "BTC",
  name: "Bitcoin",
  logoUrl: "https://example.com/btc.png",
  rank: 1,
  priceUsd: 76684,
  marketCapUsd: 1.5e12,
  volume24hUsd: 2.9e10,
  circulatingSupply: 2e7,
  totalSupply: 2e7,
  maxSupply: 2.1e7,
  pctChange1h: 0.02,
  pctChange24h: -0.46,
  pctChange7d: -4.71,
  sparkline7d: [1, 2, 3],
};

describe("syncPrices", () => {
  it("writes list snapshot to Redis", async () => {
    const { redisStore, fakeRedis, fakePrisma } = makeFakes();
    await syncPrices({
      fetchTop100L1: async () => [row],
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    const stored = redisStore.get(KEYS.topList);
    expect(stored).toBeDefined();
    expect(JSON.parse(stored!)).toHaveLength(1);
    expect(JSON.parse(stored!)[0].id).toBe("bitcoin");
  });

  it("upserts Coin and creates CoinSnapshot per row", async () => {
    const { fakeRedis, fakePrisma, upsertedCoins, createdSnapshots } = makeFakes();
    await syncPrices({
      fetchTop100L1: async () => [row, { ...row, id: "ethereum", symbol: "ETH", rank: 2, priceUsd: 2108 }],
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    expect(upsertedCoins).toEqual([
      { id: "bitcoin", rank: 1 },
      { id: "ethereum", rank: 2 },
    ]);
    expect(createdSnapshots.map((s) => s.coinId)).toEqual(["bitcoin", "ethereum"]);
  });

  it("returns the count", async () => {
    const { fakeRedis, fakePrisma } = makeFakes();
    const result = await syncPrices({
      fetchTop100L1: async () => [row, { ...row, id: "ethereum" }],
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    expect(result).toEqual({ count: 2 });
  });

  it("propagates fetch errors", async () => {
    const { fakeRedis, fakePrisma } = makeFakes();
    await expect(
      syncPrices({
        fetchTop100L1: async () => { throw new Error("network"); },
        redis: fakeRedis as never,
        prisma: fakePrisma as never,
      }),
    ).rejects.toThrow("network");
  });
});

describe("syncGlobal", () => {
  const snap: GlobalSnap = {
    totalMarketCapUsd: 2.5e12,
    total24hVolumeUsd: 1.2e11,
    btcDominancePct: 52.3,
    ethDominancePct: 16.7,
    activeCryptos: 12345,
    markets: 789,
  };

  it("writes Redis + upserts GlobalStats", async () => {
    const { redisStore, fakeRedis, fakePrisma } = makeFakes();
    await syncGlobal({
      fetchGlobalSnap: async () => snap,
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    expect(JSON.parse(redisStore.get(KEYS.globalStats)!)).toMatchObject({
      btcDominancePct: 52.3,
    });
    expect(fakePrisma.globalStats.upsert).toHaveBeenCalled();
  });
});

describe("syncFearGreed", () => {
  const fg: FearGreed = { value: 40, classification: "Fear", updatedAt: 1700000000 };

  it("writes the index JSON to Redis and returns its value", async () => {
    const { redisStore, fakeRedis } = makeFakes();
    const result = await syncFearGreed({
      fetchFearGreed: async () => fg,
      redis: fakeRedis as never,
    });
    expect(result).toEqual({ value: 40 });
    expect(JSON.parse(redisStore.get(KEYS.fearGreed)!)).toEqual(fg);
  });

  it("propagates fetch errors", async () => {
    const { fakeRedis } = makeFakes();
    await expect(
      syncFearGreed({
        fetchFearGreed: async () => { throw new Error("network"); },
        redis: fakeRedis as never,
      }),
    ).rejects.toThrow("network");
  });
});

describe("syncMarkets", () => {
  it("writes the quotes to Redis and returns the count", async () => {
    const { redisStore, fakeRedis } = makeFakes();
    const quotes = [
      { symbol: "^dji", name: "Dow Jones", group: "index", unit: "pts", date: "2026-05-22", time: "23:00:00", open: 1, high: 2, low: 1, last: 2, changePct: 100 },
      { symbol: "xauusd", name: "gold", group: "metal", unit: "usd", date: "2026-05-22", time: "22:00:00", open: 4544, high: 4546, low: 4492, last: 4508, changePct: -0.79 },
    ];
    const result = await syncMarkets({
      fetchMarkets: async () => quotes as never,
      redis: fakeRedis as never,
    });
    expect(result).toEqual({ count: 2 });
    expect(JSON.parse(redisStore.get(KEYS.markets)!)).toHaveLength(2);
  });
});

describe("syncExchangeRates", () => {
  it("writes rates JSON to Redis under exchange:rates", async () => {
    const { redisStore, fakeRedis } = makeFakes();
    await syncExchangeRates({
      fetchExchangeRates: async () => ({
        usd: { name: "US Dollar", unit: "$", value: 75000, type: "fiat" as const },
      }),
      redis: fakeRedis as never,
    });
    expect(redisStore.get(KEYS.exchangeRates)).toBeDefined();
    expect(JSON.parse(redisStore.get(KEYS.exchangeRates)!).usd.value).toBe(75000);
  });
});

describe("syncExchanges", () => {
  const ex: Exchange = {
    id: "gdax",
    name: "Coinbase Exchange",
    logoUrl: "https://example.com/c.png",
    country: "United States",
    yearEstablished: 2012,
    trustScore: 10,
    trustScoreRank: 1,
    volume24hBtc: 15000,
    volume24hUsd: 15000 * 76000,
    url: "https://coinbase.com/",
    hasTradingIncentive: false,
    description: null,
    exchangeType: null,
    currencies: null,
    pairsCount: null,
    fiats: [],
    socials: null,
    source: "cg",
  };

  it("writes Redis snapshot and upserts each exchange", async () => {
    const redisStore = new Map<string, string>();
    const fakeRedis = { set: vi.fn(async (k: string, v: string) => { redisStore.set(k, v); return "OK"; }) };
    const upserts: string[] = [];
    const fakePrisma = {
      exchange: {
        upsert: vi.fn(async ({ where }: any) => { upserts.push(where.id); return {}; }),
      },
    };
    const result = await syncExchanges({
      fetchExchanges: async () => [ex, { ...ex, id: "binance", trustScoreRank: 2 }],
      btcUsd: 76000,
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    // Curated exchanges (e.g. richamster) are prepended to the CoinGecko list.
    expect(result).toEqual({ count: 3 });
    expect(upserts).toEqual(["richamster", "gdax", "binance"]);
    expect(JSON.parse(redisStore.get("snapshot:exchanges:top100")!)).toHaveLength(3);
  });
});

describe("syncAdminAddedPrices", () => {
  const row: MarketRow = {
    id: "myadmin", symbol: "ADM", name: "Admin Coin", logoUrl: null,
    rank: 9999, priceUsd: 1, marketCapUsd: 100, volume24hUsd: 10,
    circulatingSupply: null, totalSupply: null, maxSupply: null,
    pctChange1h: null, pctChange24h: null, pctChange7d: null,
    sparkline7d: null,
  };

  it("writes empty list and skips fetch when no admin ids", async () => {
    const redisStore = new Map<string, string>();
    const fakeRedis = { set: vi.fn(async (k: string, v: string) => { redisStore.set(k, v); return "OK"; }) };
    const fetchByIds = vi.fn(async () => []);
    const fakePrisma = makeFakes().fakePrisma;
    const result = await syncAdminAddedPrices({
      listAdminAddedIds: async () => [],
      fetchByIds: fetchByIds as never,
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    expect(result).toEqual({ count: 0 });
    expect(fetchByIds).not.toHaveBeenCalled();
    expect(redisStore.get("snapshot:list:admin")).toBe("[]");
  });

  it("fetches and persists when admin ids exist", async () => {
    const { redisStore, fakeRedis, fakePrisma, createdSnapshots, upsertedCoins } = makeFakes();
    const fetchByIds = vi.fn(async (ids: string[]) => ids.map((id) => ({ ...row, id })));
    const result = await syncAdminAddedPrices({
      listAdminAddedIds: async () => ["coinx"],
      fetchByIds: fetchByIds as never,
      redis: fakeRedis as never,
      prisma: fakePrisma as never,
    });
    expect(result).toEqual({ count: 1 });
    expect(fetchByIds).toHaveBeenCalledWith(["coinx"]);
    expect(JSON.parse(redisStore.get("snapshot:list:admin")!)).toHaveLength(1);
    expect(upsertedCoins).toEqual([{ id: "coinx", rank: 9999 }]);
    expect(createdSnapshots).toEqual([{ coinId: "coinx", priceUsd: 1 }]);
  });
});

describe("syncCoinPaprikaExchanges", () => {
  const cpRichamster: CoinPaprikaExchange = {
    id: "richamster",
    name: "Richamster",
    type: ["cex"],
    description: "A team of crypto enthusiasts.",
    active: true,
    markets_data_fetched: true,
    adjusted_rank: 217,
    currencies: 24,
    fiats: [{ name: "Ukrainian Hryvnia", symbol: "UAH" }],
    volume24hUsd: 200_000,
    links: { twitter: ["https://twitter.com/Richamster_com"], website: ["https://richamster.com"] },
  };

  const cpNew: CoinPaprikaExchange = {
    id: "xeggex",
    name: "XeggeX",
    type: ["cex"],
    description: null,
    active: true,
    markets_data_fetched: true,
    adjusted_rank: 3,
    currencies: 50,
    fiats: [],
    volume24hUsd: 5_000_000,
    links: { website: ["https://xeggex.com"] },
  };

  it("creates a new row for CP-only exchange and enriches existing one only on nulls", async () => {
    const existing: Record<string, any> = {
      richamster: {
        id: "richamster", name: "Richamster.com", description: null, exchangeType: null,
        currencies: null, pairsCount: null, fiats: [], socials: null, source: "curated",
      },
    };
    const updates: any[] = [];
    const creates: any[] = [];
    const fakePrisma = {
      exchange: {
        findUnique: vi.fn(async ({ where }: any) => existing[where.id] ?? null),
        update: vi.fn(async ({ where, data }: any) => { updates.push({ id: where.id, data }); return {}; }),
        create: vi.fn(async ({ data }: any) => { creates.push(data); return {}; }),
      },
    };
    const result = await syncCoinPaprikaExchanges({
      fetchAll: async () => [cpRichamster, cpNew],
      fetchDetail: async (id) => ({ ...(id === "xeggex" ? cpNew : cpRichamster), pairsCount: 120, markets: [] }),
      prisma: { ...fakePrisma, exchangeMarket: { upsert: vi.fn(async () => ({})) } } as never,
      minVolumeUsd: 100_000,
      btcUsd: 50_000,
      detailCallBudget: 100,
    });

    expect(result.enriched).toBe(1);
    expect(result.created).toBe(1);

    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("richamster");
    expect(updates[0].data.description).toBe("A team of crypto enthusiasts.");
    expect(updates[0].data.exchangeType).toBe("CEX");
    expect(updates[0].data.currencies).toBe(24);
    expect(updates[0].data.pairsCount).toBe(120);
    expect(updates[0].data.fiats).toEqual(["UAH"]);
    expect(updates[0].data.socials).toEqual({ twitter: "https://twitter.com/Richamster_com", website: "https://richamster.com" });
    expect(updates[0].data.source).toBeUndefined();
    expect(updates[0].data.name).toBeUndefined();
    expect(updates[0].data.url).toBeUndefined();

    expect(creates).toHaveLength(1);
    expect(creates[0].id).toBe("xeggex");
    expect(creates[0].source).toBe("cp");
    expect(creates[0].name).toBe("XeggeX");
    expect(creates[0].url).toBe("https://xeggex.com");
    expect(creates[0].volume24hUsd).toBe(5_000_000);
    expect(creates[0].volume24hBtc).toBe(100);
    expect(creates[0].pairsCount).toBe(120);
    expect(creates[0].logoUrl).toBe("https://static.coinpaprika.com/exchange/xeggex/logo.png");
  });

  it("skips rows under the volume threshold", async () => {
    const fakePrisma = {
      exchange: {
        findUnique: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
    };
    const result = await syncCoinPaprikaExchanges({
      fetchAll: async () => [{ ...cpNew, volume24hUsd: 5_000 }],
      fetchDetail: async () => null,
      prisma: { ...fakePrisma, exchangeMarket: { upsert: vi.fn() } } as never,
      minVolumeUsd: 100_000,
      btcUsd: 50_000,
      detailCallBudget: 100,
    });
    expect(result).toEqual({ created: 0, enriched: 0, skipped: 1, marketsUpserted: 0, detailsAttempted: 0 });
    expect(fakePrisma.exchange.findUnique).not.toHaveBeenCalled();
  });

  it("honors CP_TO_CG_ALIAS for known divergent ids", async () => {
    const existing: Record<string, any> = {
      gdax: { id: "gdax", name: "Coinbase Exchange", description: null, exchangeType: null, currencies: null, pairsCount: null, fiats: [], socials: null, source: "cg" },
    };
    const updates: any[] = [];
    const fakePrisma = {
      exchange: {
        findUnique: vi.fn(async ({ where }: any) => existing[where.id] ?? null),
        update: vi.fn(async ({ where, data }: any) => { updates.push({ id: where.id, data }); return {}; }),
        create: vi.fn(),
      },
    };
    await syncCoinPaprikaExchanges({
      fetchAll: async () => [{ ...cpNew, id: "coinbase", name: "Coinbase" }],
      fetchDetail: async () => ({ ...cpNew, id: "coinbase", name: "Coinbase", pairsCount: 200, markets: [] }),
      prisma: { ...fakePrisma, exchangeMarket: { upsert: vi.fn() } } as never,
      minVolumeUsd: 100_000,
      btcUsd: 50_000,
      detailCallBudget: 100,
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("gdax");
    expect(fakePrisma.exchange.create).not.toHaveBeenCalled();
  });
});
