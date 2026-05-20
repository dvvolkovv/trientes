import { describe, expect, it, vi } from "vitest";
import { syncPrices, syncGlobal } from "@/lib/sync/orchestrator";
import { KEYS } from "@/lib/sync/keys";
import type { MarketRow, GlobalSnap } from "@/lib/coingecko";

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
