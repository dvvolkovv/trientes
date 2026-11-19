import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  // Снимки в наборе помечены 7 ноября, а свежесть читателя считается от «сейчас»:
  // без остановленных часов фикстуры через час стали бы просроченными сами собой.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T12:05:00Z"));
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

afterEach(() => {
  vi.useRealTimers();
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

/**
 * Снимок основного списка держится 15 минут, а прогон цен ходит раз в десять и
 * иногда получает от CoinGecko 429 (бесплатный тариф, лимит на IP общий у веба
 * и воркера). Один сорванный прогон — и ключ `topList` просто истекает, тогда
 * как список монет, заведённых руками, живёт час и остаётся на месте. Прежнее
 * условие `l1.length > 0 || admin.length > 0` в этом случае отдавало **половину
 * списка**: 19 ноября главная четверть часа показывала 27 монет без биткойна.
 * Поэтому снимок годен только целиком; уцелела половина — читаем базу.
 */
describe("readTop100 partial cache", () => {
  function cacheWith(values: Partial<Record<string, string>>) {
    mocks.redis.get.mockImplementation(async (key: string) => values[key] ?? null);
  }

  const cachedRow: MarketRow = {
    id: "cached-coin",
    symbol: "CCH",
    name: "Cached",
    logoUrl: null,
    rank: 7,
    priceUsd: 1,
    marketCapUsd: 2,
    volume24hUsd: 3,
    circulatingSupply: null,
    totalSupply: null,
    maxSupply: null,
    pctChange1h: null,
    pctChange24h: null,
    pctChange7d: null,
    sparkline7d: null,
  };

  it("falls back to the database when the main list expired but the admin list survived", async () => {
    cacheWith({ [KEYS.adminAddedList]: JSON.stringify([cachedRow]) });

    await expect(readTop100()).resolves.toEqual(expectedRows);
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("falls back to the database when the admin list expired but the main list survived", async () => {
    cacheWith({ [KEYS.topList]: JSON.stringify([cachedRow]) });

    await expect(readTop100()).resolves.toEqual(expectedRows);
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("treats an empty main list as a broken read, not an empty market", async () => {
    cacheWith({
      [KEYS.topList]: JSON.stringify([]),
      [KEYS.adminAddedList]: JSON.stringify([cachedRow]),
    });

    await expect(readTop100()).resolves.toEqual(expectedRows);
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("serves both halves from cache without touching the database", async () => {
    cacheWith({
      [KEYS.topList]: JSON.stringify([expectedRows[0]]),
      [KEYS.adminAddedList]: JSON.stringify([cachedRow]),
    });

    await expect(readTop100()).resolves.toEqual([expectedRows[0], cachedRow]);
    expect(mocks.prisma.coin.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("accepts an empty admin list as an answer — there may be no hand-added coins", async () => {
    cacheWith({
      [KEYS.topList]: JSON.stringify([expectedRows[0]]),
      [KEYS.adminAddedList]: JSON.stringify([]),
    });

    await expect(readTop100()).resolves.toEqual([expectedRows[0]]);
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("keeps the surviving half when the database answers with nothing", async () => {
    cacheWith({ [KEYS.adminAddedList]: JSON.stringify([cachedRow]) });
    mocks.prisma.coin.findMany.mockResolvedValue([]);

    await expect(readTop100()).resolves.toEqual([cachedRow]);
  });

  it("treats a corrupt main list as missing", async () => {
    cacheWith({
      [KEYS.topList]: "{not json",
      [KEYS.adminAddedList]: JSON.stringify([cachedRow]),
    });

    await expect(readTop100()).resolves.toEqual(expectedRows);
  });
});

/**
 * Запасной путь читает базу, а в базе лежат и монеты, выпавшие из категории
 * layer-1: их цену не обновляет никто, и самый старый снимок живого прода был
 * от 22 октября. Показать такую цену как сегодняшнюю — соврать, поэтому порог
 * тот же, что у закреплённой строки (слайс AW): старше шести часов в список не
 * идёт. Снимок без штампа времени остаётся: «не знаю, когда» — это не «знаю,
 * что давно» (то же правило у замерших пар бирж).
 */
describe("readTop100 fallback freshness", () => {
  it("drops coins whose latest snapshot is older than six hours", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([
      makeSnapshot("bitcoin"),
      makeSnapshot("ethereum", {
        priceUsd: "200.5",
        circulatingSupply: null,
        totalSupply: null,
        maxSupply: null,
        sparkline7d: null,
        fetchedAt: new Date("2026-11-07T05:00:00Z"),
      }),
    ]);

    const rows = await readTop100();
    expect(rows.map((r) => r.id)).toEqual(["bitcoin"]);
  });

  it("keeps a snapshot with no timestamp — unknown is not stale", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([
      makeSnapshot("bitcoin", { fetchedAt: null }),
    ]);

    const rows = await readTop100();
    expect(rows.map((r) => r.id)).toEqual(["bitcoin"]);
  });
});
