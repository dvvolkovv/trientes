import { describe, expect, it, vi } from "vitest";

import { syncCoinloreExchanges } from "@/lib/sync/orchestrator";
import type { CoinloreExchange, CoinlorePair } from "@/lib/coinlore";

const ex = (over: Partial<CoinloreExchange> = {}): CoinloreExchange => ({
  id: "5",
  name: "Binance",
  nameId: "binance",
  volumeUsd: 1e9,
  activePairs: 908,
  url: null,
  country: null,
  ...over,
});

const pair = (over: Partial<CoinlorePair> = {}): CoinlorePair => ({
  base: "BTC",
  quote: "USDT",
  priceUsd: 61_700,
  volumeUsd: 1.4e9,
  tradedAt: new Date(),
  ...over,
});

function prismaStub(rows: { id: string; name: string; volume24hUsd: number | null }[]) {
  const updates: Record<string, Record<string, unknown>> = {};
  const markets: Record<string, Record<string, unknown>> = {};
  const update = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    updates[args.where.id] = args.data;
  });
  const upsert = vi.fn(async (args: { where: { id: string }; create: Record<string, unknown> }) => {
    markets[args.where.id] = args.create;
  });
  return {
    updates,
    markets,
    update,
    upsert,
    prisma: {
      exchange: { findMany: vi.fn(async () => rows), update },
      exchangeMarket: { upsert },
    },
  };
}

const now = new Date(Date.UTC(2026, 10, 20, 12, 0, 0));

describe("syncCoinloreExchanges", () => {
  it("пишет число пар и пары сошедшейся биржи", async () => {
    const s = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: 5 }]);
    const r = await syncCoinloreExchanges({
      prisma: s.prisma,
      fetchExchanges: async () => [ex()],
      fetchPairs: async () => [pair({ tradedAt: now })],
      pairBudget: 10,
      now,
    });
    expect(r).toMatchObject({ matched: 1, unmatched: 0, marketsUpserted: 1, pairFailures: 0 });
    expect(s.updates.binance.pairsCount).toBe(908);
    expect(s.updates.binance.marketsFetchedAt).toBe(now);
    expect(s.markets["binance:BTC:USDT:spot"]).toMatchObject({ exchangeId: "binance", pair: "BTC/USDT", priceUsd: 61_700 });
  });

  it("новой биржи не заводит: несошедшаяся считается вслух", async () => {
    const s = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: 5 }]);
    const r = await syncCoinloreExchanges({
      prisma: s.prisma,
      fetchExchanges: async () => [ex({ id: "999", name: "ZKE", nameId: "zke" }), ex()],
      fetchPairs: async () => [],
      pairBudget: 10,
      now,
    });
    expect(r.unmatched).toBe(1);
    expect(s.update).toHaveBeenCalledTimes(1);
  });

  it("объём чужой строки не затирается", async () => {
    const s = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: 5 }]);
    await syncCoinloreExchanges({
      prisma: s.prisma,
      fetchExchanges: async () => [ex()],
      fetchPairs: async () => [],
      pairBudget: 10,
      now,
    });
    expect(s.updates.binance.volume24hUsd).toBeUndefined();
  });

  it("объём пишется только там, где у нашей строки его нет", async () => {
    const s = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: null }]);
    await syncCoinloreExchanges({
      prisma: s.prisma,
      fetchExchanges: async () => [ex()],
      fetchPairs: async () => [],
      pairBudget: 10,
      now,
    });
    expect(s.updates.binance.volume24hUsd).toBe(1e9);
  });

  it("пара, не торговавшаяся неделю, не пишется", async () => {
    const s = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: 5 }]);
    const old = new Date(now.getTime() - 8 * 24 * 3600 * 1000);
    const r = await syncCoinloreExchanges({
      prisma: s.prisma,
      fetchExchanges: async () => [ex()],
      fetchPairs: async () => [pair({ tradedAt: old })],
      pairBudget: 10,
      now,
    });
    expect(r.marketsUpserted).toBe(0);
    expect(r.pairsStale).toBe(1);
    expect(s.updates.binance.marketsFetchedAt).toBeUndefined();
  });

  it("пара без времени остаётся: «не знаю когда» — это не «знаю, что давно»", async () => {
    const s = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: 5 }]);
    const r = await syncCoinloreExchanges({
      prisma: s.prisma,
      fetchExchanges: async () => [ex()],
      fetchPairs: async () => [pair({ tradedAt: null })],
      pairBudget: 10,
      now,
    });
    expect(r.marketsUpserted).toBe(1);
  });

  it("бюджет пар не перешагивается, и обойдённое называется", async () => {
    const s = prismaStub([
      { id: "binance", name: "Binance", volume24hUsd: 5 },
      { id: "kucoin", name: "KuCoin", volume24hUsd: 5 },
    ]);
    const fetchPairs = vi.fn(async () => []);
    const r = await syncCoinloreExchanges({
      prisma: s.prisma,
      fetchExchanges: async () => [ex(), ex({ id: "6", name: "KuCoin", nameId: "kucoin", volumeUsd: 1e8 })],
      fetchPairs,
      pairBudget: 1,
      now,
    });
    expect(fetchPairs).toHaveBeenCalledTimes(1);
    expect(fetchPairs).toHaveBeenCalledWith("5"); // сперва биржа с большим объёмом
    expect(r.pairsSkippedByBudget).toBe(1);
  });

  it("сбой пар одной биржи прогон не роняет", async () => {
    const s = prismaStub([{ id: "binance", name: "Binance", volume24hUsd: 5 }]);
    const r = await syncCoinloreExchanges({
      prisma: s.prisma,
      fetchExchanges: async () => [ex()],
      fetchPairs: async () => {
        throw new Error("502");
      },
      pairBudget: 10,
      now,
    });
    expect(r.matched).toBe(1);
    expect(r.pairFailures).toBe(1);
    expect(s.updates.binance.pairsCount).toBe(908); // число пар из списка всё равно записано
  });
});
