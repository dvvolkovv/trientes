import { describe, expect, it } from "vitest";
import {
  dexTradeUrl,
  isOwnDexMarket,
  OWN_DEX_NAME,
  readOwnDexMarket,
  syncOwnDexMarkets,
  type PrismaLike,
} from "../src/lib/coin-card-dex-market";
import type { FetchLike } from "../src/lib/trientes-dex";
import { COINS, PAIRS, QUOTE_OK, QUOTE_REFUSED, TICKERS } from "./fixtures/trientes-dex";

const NOW = new Date("2026-11-11T20:00:00.000Z");

/** Ряд свечей службы заявок: час назад и два часа назад, по сделке в каждой. */
const CANDLES = (now: Date) => ({
  source: "trientes",
  symbol: "TAL/USDT",
  interval: "1h",
  candles: [
    {
      time: Math.floor(now.getTime() / 1000) - 7200,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 2,
    },
    {
      time: Math.floor(now.getTime() / 1000) - 3600,
      open: 110,
      high: 110,
      low: 110,
      close: 110,
      volume: 1,
    },
  ],
});

/** Узел-заглушка: реестр из снимков, котировки — очередью, свечи — по адресу. */
function nodeOf(quotes: string[], candles?: unknown): FetchLike {
  const queue = [...quotes];
  return async (url, init) => {
    if (!init?.body) {
      // Это запрос ряда свечей, а не вызов узла.
      if (candles === undefined) return new Response("no series", { status: 404 });
      return new Response(JSON.stringify(candles), { status: 200 });
    }
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

describe("dexTradeUrl", () => {
  it("открывает обмен на паре карточки, и получает её монету", () => {
    // Монета карточки — база пары: отдаём котировку, получаем монету.
    expect(dexTradeUrl("TAL/USDT", "TAL", "https://trientes.org")).toBe(
      "https://trientes.org/exchange/#/swap/USDT-TAL",
    );
  });

  it("монета карточки в котировке — порядок обратный", () => {
    expect(dexTradeUrl("BTC/TAL", "TAL", "https://trientes.org")).toBe(
      "https://trientes.org/exchange/#/swap/BTC-TAL",
    );
  });

  it("не пара — остаётся обмен без выбора", () => {
    expect(dexTradeUrl("TAL", "TAL", "https://trientes.org")).toBe("https://trientes.org/exchange/");
  });
});

describe("суточный объём нашего обмена", () => {
  it("пишется в рынок по ряду свечей и считается по цене каждой свечи", async () => {
    const { prisma, writes } = prismaOf([{ id: "c1", symbol: "TAL" }]);
    await syncOwnDexMarkets({
      prisma,
      fetchImpl: nodeOf([QUOTE_OK, QUOTE_OK], CANDLES(NOW)),
      now: NOW,
    });
    expect(writes[0].data.volumeUsd24h).toBeCloseTo(2 * 100 + 1 * 110, 6);
    expect(writes[0].data.tradeUrl).toContain("#/swap/USDT-TAL");
  });

  it("служба не ответила — прежнее число не трогаем", async () => {
    const { prisma, writes } = prismaOf([{ id: "c1", symbol: "TAL" }], "m1");
    await syncOwnDexMarkets({ prisma, fetchImpl: nodeOf([QUOTE_OK, QUOTE_OK]), now: NOW });
    expect(writes[0].op).toBe("update");
    expect("volumeUsd24h" in writes[0].data).toBe(false);
  });
});
