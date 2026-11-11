import { describe, expect, it } from "vitest";
import {
  isOwnDexMarket,
  OWN_DEX_NAME,
  readOwnDexMarket,
  syncOwnDexMarkets,
  type PrismaLike,
} from "../src/lib/coin-card-dex-market";
import type { FetchLike } from "../src/lib/trientes-dex";
import { COINS, PAIRS, QUOTE_OK, QUOTE_REFUSED, TICKERS } from "./fixtures/trientes-dex";

const NOW = new Date("2026-11-11T20:00:00.000Z");

/** Узел-заглушка: реестр из снимков, котировки — очередью. */
function nodeOf(quotes: string[]): FetchLike {
  const queue = [...quotes];
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { params: [string, string] };
    const map: Record<string, string> = {
      SwapApi_tickers: TICKERS,
      SwapApi_pairs: PAIRS,
      SwapApi_coins: COINS,
    };
    const result =
      body.params[0] === "SwapApi_quote" ? (queue.shift() ?? QUOTE_REFUSED) : map[body.params[0]];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  };
}

function prismaOf(rows: Array<{ id: string; symbol: string }>, existing: string | null = null) {
  const writes: Array<{ op: string; data: Record<string, unknown> }> = [];
  const prisma: PrismaLike = {
    coinCard: { findMany: async () => rows },
    coinCardMarket: {
      findFirst: async () => (existing ? { id: existing } : null),
      create: async (args) => {
        writes.push({ op: "create", data: (args as { data: Record<string, unknown> }).data });
      },
      update: async (args) => {
        writes.push({ op: "update", data: (args as { data: Record<string, unknown> }).data });
      },
    },
  };
  return { prisma, writes };
}

describe("isOwnDexMarket", () => {
  it("узнаёт наш обмен и не путает его с чужим пулом", () => {
    expect(isOwnDexMarket({ kind: "DEX", exchangeName: OWN_DEX_NAME })).toBe(true);
    expect(isOwnDexMarket({ kind: "DEX", exchangeName: "Uniswap V3" })).toBe(false);
    expect(isOwnDexMarket({ kind: "CEX", exchangeName: OWN_DEX_NAME })).toBe(false);
  });
});

describe("readOwnDexMarket", () => {
  it("находит стейбловую пару монеты и отдаёт цену в долларах", async () => {
    const r = await readOwnDexMarket({ id: "c1", symbol: "TAL" }, nodeOf([QUOTE_OK, QUOTE_OK]));
    if (r.error) throw new Error(r.error);
    expect(r.fact.pair).toBe("TAL/USDT");
    expect(r.fact.quote).toBe("USDT");
    expect(r.fact.priceUsd).toBeCloseTo(11929.6719, 3);
  });

  it("монета не в реестре обмена — отказ, а не нулевая цена", async () => {
    const r = await readOwnDexMarket({ id: "c1", symbol: "XRP" }, nodeOf([]));
    expect(r).toEqual({ fact: null, error: "pair_not_found" });
  });

  // Монета без стейбловой пары с обмена не пропадает: рынок наш и настоящий,
  // а цена в долларах через второе наше же число не считается.
  it("у LTC пары только к BTC и ETH — рынок есть, цены нет", async () => {
    const r = await readOwnDexMarket({ id: "c1", symbol: "LTC" }, nodeOf([QUOTE_OK, QUOTE_OK]));
    expect(r).toEqual({
      error: null,
      fact: { pair: "LTC/BTC", quote: "BTC", priceUsd: null, spreadPct: null, markupPct: null },
    });
  });
});

describe("syncOwnDexMarkets", () => {
  it("заводит строку рынка и оставляет объём пустым, а не нулевым", async () => {
    const { prisma, writes } = prismaOf([{ id: "c1", symbol: "TAL" }]);
    const stats = await syncOwnDexMarkets({
      prisma,
      fetchImpl: nodeOf([QUOTE_OK, QUOTE_OK]),
      now: NOW,
    });
    expect(stats.written).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe("create");
    expect(writes[0].data.exchangeName).toBe(OWN_DEX_NAME);
    expect(writes[0].data.pair).toBe("TAL/USDT");
    expect(writes[0].data.volumeUsd24h).toBeNull();
    expect(writes[0].data.confirmedAt).toBe(NOW);
  });

  it("второй прогон обновляет ту же строку, а не плодит рынки", async () => {
    const { prisma, writes } = prismaOf([{ id: "c1", symbol: "TAL" }], "m1");
    await syncOwnDexMarkets({ prisma, fetchImpl: nodeOf([QUOTE_OK, QUOTE_OK]), now: NOW });
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe("update");
  });

  it("карточка без пары на обмене проходит молча — это норма, а не сбой", async () => {
    const { prisma, writes } = prismaOf([{ id: "c1", symbol: "XRP" }]);
    const stats = await syncOwnDexMarkets({ prisma, fetchImpl: nodeOf([]), now: NOW });
    expect(stats).toEqual({ cards: 0, written: 0, failed: 0, errors: {} });
    expect(writes).toHaveLength(0);
  });

  it("сбой связи считается сбоем и не стирает прежнюю цену", async () => {
    const dead: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const { prisma, writes } = prismaOf([{ id: "c1", symbol: "TAL" }]);
    const stats = await syncOwnDexMarkets({ prisma, fetchImpl: dead, now: NOW });
    expect(stats.failed).toBe(1);
    expect(stats.errors.rpc_unreachable).toBe(1);
    expect(writes).toHaveLength(0);
  });
});
