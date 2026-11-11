import { describe, expect, it } from "vitest";
import {
  decodeCoins,
  decodePairs,
  decodeQuote,
  decodeTickers,
  readPairPrice,
  type FetchLike,
} from "../src/lib/trientes-dex";

import {
  COINS,
  PAIRS,
  QUOTE_OK,
  QUOTE_REFUSED,
  TICKERS,
} from "./fixtures/trientes-dex";

describe("decodeTickers", () => {
  it("читает десять тикеров живого реестра", () => {
    const t = decodeTickers(TICKERS);
    expect(t).toHaveLength(10);
    expect(t[0]).toEqual({ id: 0, symbol: "BTC", decimals: 8, open: true, markupPpm: 2500 });
    expect(t[9]).toEqual({ id: 9, symbol: "TAL", decimals: 12, open: true, markupPpm: 2500 });
  });

  it("не принимает обрезанный ответ", () => {
    expect(() => decodeTickers(TICKERS.slice(0, 40))).toThrow();
  });
});

describe("decodePairs", () => {
  it("читает четырнадцать пар в ориентации сети", () => {
    const p = decodePairs(PAIRS);
    expect(p).toHaveLength(14);
    expect(p).toContainEqual({ base: 9, quote: 2 }); // TAL/USDT
    expect(p).not.toContainEqual({ base: 2, quote: 9 });
  });
});

describe("decodeCoins", () => {
  it("находит хвост каждой записи и сверяет знаки с реестром тикеров", () => {
    const coins = decodeCoins(COINS, decodeTickers(TICKERS));
    expect(coins).toHaveLength(10);
    expect(coins.map((c) => c.symbol)).toEqual([
      "BTC", "ETH", "USDT", "USDC", "LINK", "USDS", "UNI", "LTC", "DOT", "TAL",
    ]);
    expect(coins[9]).toEqual({ id: 9, ticker: 9, symbol: "TAL", decimals: 12, open: true });
  });

  it("отказывается разбирать, когда тикеры не те — подставленный знак ломает хвост", () => {
    const wrong = decodeTickers(TICKERS).map((t) => ({ ...t, decimals: t.decimals + 1 }));
    expect(() => decodeCoins(COINS, wrong)).toThrow();
  });
});

describe("decodeQuote", () => {
  it("раскладывает пять чисел котировки", () => {
    const q = decodeQuote(QUOTE_OK);
    if ("error" in q) throw new Error("ожидался Ok");
    // Живое чтение: 1 TAL отдаётся за 11 929,6719 USDT до вычетов.
    expect(Number(q.price) / 1e18).toBeCloseTo(11929.6719, 4);
    expect(q.net).toBe(q.gross - q.markupFee - q.networkFee);
  });

  it("отказ рантайма по границам заявки — не число, а код", () => {
    expect(decodeQuote(QUOTE_REFUSED)).toEqual({ error: "quote_refused", variant: 4 });
  });
});

/** Узел-заглушка: отдаёт снимки реестра, а котировки — очередью ответов. */
function nodeOf(quotes: string[]): { fetch: FetchLike; quoteCalls: () => number } {
  const queue = [...quotes];
  let asked = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { params: [string, string] };
    const map: Record<string, string> = {
      SwapApi_tickers: TICKERS,
      SwapApi_pairs: PAIRS,
      SwapApi_coins: COINS,
    };
    let result = map[body.params[0]];
    if (body.params[0] === "SwapApi_quote") {
      asked += 1;
      result = queue.shift() ?? QUOTE_REFUSED;
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  };
  return { fetch: fetchImpl, quoteCalls: () => asked };
}

const REGISTRY = {
  tickers: decodeTickers(TICKERS),
  coins: decodeCoins(COINS, decodeTickers(TICKERS)),
  pairs: decodePairs(PAIRS),
};

describe("readPairPrice", () => {
  it("берёт середину двух направлений и считает спред", async () => {
    const node = nodeOf([QUOTE_OK, QUOTE_OK]);
    const r = await readPairPrice(REGISTRY, "TAL", "USDT", node.fetch);
    if ("error" in r) throw new Error(r.error);
    expect(r.pair).toBe("TAL/USDT");
    expect(r.price).toBeCloseTo(11929.6719, 4);
    expect(r.spreadPct).toBe(0);
    expect(r.markupPct).toBe(0.3); // 2500 ppm у TAL + 500 ppm у USDT
    expect(node.quoteCalls()).toBe(2);
  });

  it("пара, которой сеть не котирует, — отказ, а не выдуманная цена", async () => {
    const node = nodeOf([]);
    expect(await readPairPrice(REGISTRY, "TAL", "LINK", node.fetch)).toEqual({ error: "pair_not_found" });
    expect(node.quoteCalls()).toBe(0);
  });

  it("перебирает размеры заявки, пока сеть не примет один", async () => {
    const node = nodeOf([QUOTE_REFUSED, QUOTE_REFUSED, QUOTE_OK, QUOTE_OK]);
    const r = await readPairPrice(REGISTRY, "TAL", "USDT", node.fetch);
    if ("error" in r) throw new Error(r.error);
    expect(r.price).toBeCloseTo(11929.6719, 4);
    expect(node.quoteCalls()).toBe(4);
  });

  it("все размеры отвергнуты — честный код отказа, а не ноль", async () => {
    const node = nodeOf([]);
    const r = await readPairPrice(REGISTRY, "TAL", "USDT", node.fetch);
    expect(r).toEqual({ error: "quote_refused" });
  });
});
