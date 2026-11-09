import { describe, expect, it } from "vitest";
import { getConnector } from "../src/lib/cex-registry";
import type { SnapshotMap } from "../src/lib/cex-snapshot";
import {
  discoverCardMarkets,
  SEED_QUOTES,
  MAX_REFERENCE_AGE_MS,
  MAX_SEEDED_MARKETS,
  referenceOf,
  seedCardMarkets,
  seedWhere,
  type PrismaLike,
  type SeedCardRow,
} from "../src/lib/coin-card-market-seed";

const NOW = new Date("2026-11-09T14:00:00.000Z");
const FRESH = { priceUsd: 2, fetchedAt: new Date(NOW.getTime() - 60_000) };

function snapshotOf(entries: Record<string, Record<string, unknown>[]>): SnapshotMap {
  const map: SnapshotMap = new Map();
  for (const [id, body] of Object.entries(entries)) {
    const c = getConnector(id);
    if (!c) throw new Error(id);
    map.set(id, { id, tickers: c.parse(body), fetchedAt: NOW.toISOString() });
  }
  return map;
}

const bin = (rows: Record<string, unknown>[]) => ({ binance: rows });
const row = (symbol: string, lastPrice: string, quoteVolume = "1000") => ({
  symbol,
  lastPrice,
  quoteVolume,
  priceChangePercent: "1",
});

describe("discoverCardMarkets", () => {
  it("находит пару со стейблом и называет биржу её ярлыком", () => {
    const r = discoverCardMarkets(
      { symbol: "TIA", reference: FRESH },
      snapshotOf(bin([row("TIAUSDT", "2.02")])),
      {},
      NOW,
    );
    expect(r.error).toBeNull();
    expect(r.markets).toEqual([
      {
        exchangeId: "binance",
        exchangeName: "Binance",
        pair: "TIA/USDT",
        priceUsd: 2.02,
        volumeUsd24h: 1000,
      },
    ]);
  });

  it("тикер-двойник с мёртвым объёмом просто не берётся", () => {
    // Чужой актив или застрявший делистинг: цена расходится в разы, торгов нет.
    const r = discoverCardMarkets(
      { symbol: "SAGA", reference: FRESH },
      snapshotOf(bin([row("SAGAUSDT", "140", "0"), row("SAGAUSDC", "2", "1000")])),
      {},
      NOW,
    );
    expect(r.error).toBeNull();
    expect(r.markets).toHaveLength(1);
    expect(r.markets[0].pair).toBe("SAGA/USDC");
    expect(r.rejected).toEqual(["binance:SAGA/USDT"]);
  });

  it("биржа, не согласная ни одной парой, — спор о цене, а не о тикере", () => {
    // Разрешать его молча в пользу опоры нельзя, даже когда другая биржа с
    // опорой сошлась: мы выбрали бы рынок за согласие с CoinGecko.
    const r = discoverCardMarkets(
      { symbol: "ACA", reference: FRESH },
      snapshotOf({
        binance: [row("ACAUSDT", "16", "400000")],
        gate: [{ currency_pair: "ACA_USDT", last: "2", quote_volume: "900" }],
      }),
      {},
      NOW,
    );
    expect(r.error).toBe("reference_conflict");
    expect(r.markets).toEqual([]);
    expect(r.rejected).toEqual(["binance:ACA/USDT"]);
  });

  it("мёртвая котировка на согласной бирже карточку не роняет, даже с большим объёмом", () => {
    // Живой случай POLYX: `BUSD`-пара вчетверо дороже стейбл-пар и с объёмом
    // больше них. Биржа согласна другой парой — значит спора нет.
    const r = discoverCardMarkets(
      { symbol: "POLYX", reference: FRESH },
      snapshotOf({
        binance: [row("POLYXUSDT", "2", "399062"), row("POLYXBUSD", "8", "548337")],
        gate: [{ currency_pair: "POLYX_USDT", last: "2.01", quote_volume: "5000" }],
      }),
      {},
      NOW,
    );
    expect(r.error).toBeNull();
    expect(r.markets.map((m) => `${m.exchangeId}:${m.pair}`)).toEqual([
      "binance:POLYX/USDT",
      "gate:POLYX/USDT",
    ]);
    expect(r.rejected).toEqual(["binance:POLYX/BUSD"]);
  });

  it("все пары разошлись с опорой — это спор, а не отсутствие рынка", () => {
    const r = discoverCardMarkets(
      { symbol: "NTRN", reference: FRESH },
      snapshotOf(bin([row("NTRNUSDT", "11", "200000")])),
      {},
      NOW,
    );
    expect(r.error).toBe("reference_conflict");
  });

  it("допуск в четверть цены пару не теряет", () => {
    const ok = discoverCardMarkets(
      { symbol: "TIA", reference: FRESH },
      snapshotOf(bin([row("TIAUSDT", "2.5")])),
      {},
      NOW,
    );
    expect(ok.markets).toHaveLength(1);

    const off = discoverCardMarkets(
      { symbol: "TIA", reference: FRESH },
      snapshotOf(bin([row("TIAUSDT", "2.51")])),
      {},
      NOW,
    );
    expect(off.markets).toEqual([]);
  });

  it("без опорной цены не сеет вовсе: сверять не с чем", () => {
    const r = discoverCardMarkets(
      { symbol: "SCRT", reference: null },
      snapshotOf(bin([row("SCRTUSDT", "2")])),
      {},
      NOW,
    );
    expect(r.error).toBe("no_reference");
    expect(r.markets).toEqual([]);
  });

  it("устаревшая опорная цена не защищает и считается отсутствующей", () => {
    const stale = { priceUsd: 2, fetchedAt: new Date(NOW.getTime() - MAX_REFERENCE_AGE_MS - 1000) };
    const r = discoverCardMarkets(
      { symbol: "INIT", reference: stale },
      snapshotOf(bin([row("INITUSDT", "2")])),
      {},
      NOW,
    );
    expect(r.error).toBe("no_reference");
  });

  it("крипто-котировка не сеется даже при точной цене: ошибка складывается из двух", () => {
    const r = discoverCardMarkets(
      { symbol: "TIA", reference: FRESH },
      snapshotOf(bin([row("TIABTC", "0.00002")])),
      { BTC: 100_000 },
      NOW,
    );
    expect(r.error).toBe("no_pairs");
    expect(r.markets).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it("недоступная биржа рынков не даёт и прогон не ломает", () => {
    const map: SnapshotMap = new Map([["binance", { id: "binance", error: "exchange_unreachable" }]]);
    const r = discoverCardMarkets({ symbol: "TIA", reference: FRESH }, map, {}, NOW);
    expect(r.error).toBe("no_pairs");
  });

  it("самые объёмные рынки идут первыми и лимит режет хвост", () => {
    const many = Array.from({ length: MAX_SEEDED_MARKETS + 4 }, (_, i) => i);
    // Один коннектор не даст столько пар, поэтому берём стейблы и две биржи.
    const quotes = [...SEED_QUOTES];
    const rowsFor = (vol: number) => quotes.map((q) => row(`TIA${q}`, "2", String(vol)));
    const r = discoverCardMarkets(
      { symbol: "TIA", reference: FRESH },
      snapshotOf({ binance: rowsFor(500), mexc: rowsFor(900) }),
      {},
      NOW,
    );
    expect(many.length).toBeGreaterThan(MAX_SEEDED_MARKETS);
    expect(r.markets).toHaveLength(MAX_SEEDED_MARKETS);
    expect(r.markets[0].exchangeId).toBe("mexc");
    expect(r.markets.every((m) => (m.volumeUsd24h ?? 0) >= 500)).toBe(true);
  });
});

describe("referenceOf", () => {
  const base: SeedCardRow = { id: "c1", slug: "celestia", symbol: "TIA", coin: null };

  it("берёт последний снимок монеты и переводит Decimal через строку", () => {
    const at = new Date(NOW.getTime() - 1000);
    const r = referenceOf({ ...base, coin: { snapshots: [{ priceUsd: "0.4321350000", fetchedAt: at }] } });
    expect(r).toEqual({ priceUsd: 0.432135, fetchedAt: at });
  });

  it("монета без снимка и нулевая цена опорой не считаются", () => {
    expect(referenceOf(base)).toBeNull();
    expect(referenceOf({ ...base, coin: { snapshots: [] } })).toBeNull();
    expect(referenceOf({ ...base, coin: { snapshots: [{ priceUsd: "0", fetchedAt: NOW }] } })).toBeNull();
  });
});

describe("seedWhere", () => {
  it("берёт только открытые карточки без владельца и без рынков", () => {
    expect(seedWhere()).toEqual({
      status: "APPROVED",
      stewardUserId: null,
      companyId: null,
      nativeChain: { not: null },
      markets: { none: {} },
    });
  });

  it("с одной карточкой фильтр не навязывается: это ручной прогон", () => {
    expect(seedWhere("c1")).toEqual({ id: "c1" });
  });
});

describe("seedCardMarkets", () => {
  function fakePrisma(rows: SeedCardRow[]) {
    const created: unknown[] = [];
    const prisma: PrismaLike = {
      coinCard: { findMany: async () => rows },
      coinCardMarket: {
        createMany: async (args: unknown) => {
          const data = (args as { data: unknown[] }).data;
          created.push(...data);
          return { count: data.length };
        },
      },
    };
    return { prisma, created };
  }

  const card = (over: Partial<SeedCardRow> = {}): SeedCardRow => ({
    id: "c1",
    slug: "celestia",
    symbol: "TIA",
    coin: { snapshots: [{ priceUsd: "2", fetchedAt: new Date(NOW.getTime() - 60_000) }] },
    ...over,
  });

  it("пишет заявление о рынке без цены: подтверждает его слайс C", async () => {
    const { prisma, created } = fakePrisma([card()]);
    const { stats } = await seedCardMarkets({
      prisma,
      snapshots: snapshotOf(bin([row("TIAUSDT", "2")])),
      anchors: {},
      now: NOW,
    });
    expect(stats).toEqual({
      cards: 1, created: 1, noReference: 0, noPairs: 0, conflict: 0, rejected: 0,
    });
    expect(created).toEqual([
      {
        cardId: "c1",
        kind: "CEX",
        exchangeId: "binance",
        exchangeName: "Binance",
        pair: "TIA/USDT",
        claimedAt: NOW,
      },
    ]);
  });

  it("на сухом прогоне в базу не пишет, но план отдаёт", async () => {
    const { prisma, created } = fakePrisma([card()]);
    const { stats, plans } = await seedCardMarkets({
      prisma,
      snapshots: snapshotOf(bin([row("TIAUSDT", "2")])),
      anchors: {},
      dryRun: true,
      now: NOW,
    });
    expect(created).toEqual([]);
    expect(stats.created).toBe(0);
    expect(plans[0].result.markets).toHaveLength(1);
    expect(plans[0].referenceUsd).toBe(2);
  });

  it("считает карточки без опоры и без пар отдельно", async () => {
    const { prisma, created } = fakePrisma([
      card({ id: "c1", symbol: "SCRT", coin: { snapshots: [] } }),
      card({ id: "c2", symbol: "UNQ" }),
    ]);
    const { stats } = await seedCardMarkets({
      prisma,
      snapshots: snapshotOf(bin([row("SCRTUSDT", "2")])),
      anchors: {},
      now: NOW,
    });
    expect(stats).toMatchObject({ cards: 2, created: 0, noReference: 1, noPairs: 1 });
    expect(created).toEqual([]);
  });
});
