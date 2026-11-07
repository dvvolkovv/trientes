import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { MarketRow } from "@/lib/coingecko";

const mocks = vi.hoisted(() => ({
  redis: {
    status: "ready",
    connect: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
  prisma: {
    coin: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({ redis: mocks.redis }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { readTop100 } from "@/lib/snapshot";
import { KEYS } from "@/lib/sync/keys";

type SnapshotFixture = {
  id: string | null;
  coinId: string;
  priceUsd: string | null;
  marketCapUsd: string | null;
  volume24hUsd: string | null;
  circulatingSupply: string | null;
  totalSupply: string | null;
  maxSupply: string | null;
  pctChange1h: number | null;
  pctChange24h: number | null;
  pctChange7d: number | null;
  sparkline7d: number[] | null;
  fetchedAt: Date | null;
};

const coins = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin", logoUrl: "btc.png", rank: 1 },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", logoUrl: null, rank: 2 },
  { id: "empty", symbol: "EMPTY", name: "No snapshot", logoUrl: null, rank: 3 },
];

function makeSnapshot(coinId: string, overrides: Partial<SnapshotFixture> = {}): SnapshotFixture {
  return {
    id: `${coinId}-latest`,
    coinId,
    priceUsd: "100.25",
    marketCapUsd: "1000000",
    volume24hUsd: "50000",
    circulatingSupply: "1000",
    totalSupply: "2000",
    maxSupply: "3000",
    pctChange1h: 0.1,
    pctChange24h: 1.2,
    pctChange7d: -3.4,
    sparkline7d: [90, 100, 110],
    fetchedAt: new Date("2026-11-07T12:00:00Z"),
    ...overrides,
  };
}

const latestSnapshots = [
  makeSnapshot("bitcoin"),
  makeSnapshot("ethereum", {
    priceUsd: "200.5",
    circulatingSupply: null,
    totalSupply: null,
    maxSupply: null,
    sparkline7d: null,
  }),
];

const expectedRows: MarketRow[] = [
  {
    id: "bitcoin",
    symbol: "BTC",
    name: "Bitcoin",
    logoUrl: "btc.png",
    rank: 1,
    priceUsd: 100.25,
    marketCapUsd: 1000000,
    volume24hUsd: 50000,
    circulatingSupply: 1000,
    totalSupply: 2000,
    maxSupply: 3000,
    pctChange1h: 0.1,
    pctChange24h: 1.2,
    pctChange7d: -3.4,
    sparkline7d: [90, 100, 110],
  },
  {
    id: "ethereum",
    symbol: "ETH",
    name: "Ethereum",
    logoUrl: null,
    rank: 2,
    priceUsd: 200.5,
    marketCapUsd: 1000000,
    volume24hUsd: 50000,
    circulatingSupply: null,
    totalSupply: null,
    maxSupply: null,
    pctChange1h: 0.1,
    pctChange24h: 1.2,
    pctChange7d: -3.4,
    sparkline7d: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redis.status = "ready";
  mocks.redis.get.mockResolvedValue(null);
  mocks.prisma.coin.findMany.mockImplementation(async (args?: {
    include?: { snapshots?: { take?: number } };
  }) => {
    const take = args?.include?.snapshots?.take;
    if (take === undefined) return coins;
    return coins.map((coin) => ({
      ...coin,
      snapshots: latestSnapshots
        .filter((snapshot) => snapshot.coinId === coin.id)
        .slice(0, take),
    }));
  });
  mocks.prisma.$queryRaw.mockResolvedValue([
    latestSnapshots[1],
    {
      ...makeSnapshot("empty"),
      id: null,
      priceUsd: null,
      marketCapUsd: null,
      volume24hUsd: null,
      circulatingSupply: null,
      totalSupply: null,
      maxSupply: null,
      pctChange1h: null,
      pctChange24h: null,
      pctChange7d: null,
      sparkline7d: null,
      fetchedAt: null,
    },
    latestSnapshots[0],
  ]);
});

describe("readTop100 cold-cache fallback", () => {
  it("uses bounded latest-per-coin SQL and preserves the MarketRow mapping", async () => {
    await expect(readTop100()).resolves.toEqual(expectedRows);

    expect(mocks.redis.get).toHaveBeenCalledTimes(2);
    expect(mocks.redis.get).toHaveBeenCalledWith(KEYS.topList);
    expect(mocks.redis.get).toHaveBeenCalledWith(KEYS.adminAddedList);
    expect(mocks.redis.set).not.toHaveBeenCalled();

    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.coin.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { rank: "asc" },
      take: 200,
    });

    const queryCall = mocks.prisma.$queryRaw.mock.calls[0];
    const query = queryCall?.[0] as TemplateStringsArray;
    const idFilter = queryCall?.[1];
    const sql = query.join("?").replace(/\s+/g, " ").trim();
    expect(sql).toContain('FROM "Coin" AS c');
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain('snap."coinId" = c.id');
    expect(sql).toMatch(/ORDER BY snap\."fetchedAt" DESC LIMIT 1/);
    expect(sql).toContain("WHERE c.id IN (?)");
    expect(idFilter).toEqual(Prisma.join(coins.map((coin) => coin.id)));
    expect(sql).not.toContain('WHERE c."isActive" = TRUE');
    expect(sql).not.toMatch(/\bLIMIT 200\b/);
    expect(sql).toMatch(/ORDER BY c\."rank" ASC$/);
  });

  it("skips the snapshot query when the bounded coin list is empty", async () => {
    mocks.prisma.coin.findMany.mockResolvedValue([]);

    await expect(readTop100()).resolves.toEqual([]);

    expect(mocks.prisma.coin.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { rank: "asc" },
      take: 200,
    });
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });
});
