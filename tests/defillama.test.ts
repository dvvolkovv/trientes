import { describe, expect, it, vi } from "vitest";

import {
  DL_MIN_CONFIDENCE,
  DL_TIMEOUT_MS,
  fetchLlamaPrices,
  llamaKey,
  parseLlamaPrices,
  pickReference,
} from "@/lib/defillama";
import { createRateGate } from "@/lib/rate-gate";

const gate = () => createRateGate({ minIntervalMs: 0, sleep: async () => {}, now: () => 0 });

describe("defillama", () => {
  it("ключ монеты — её id у CoinGecko", () => {
    expect(llamaKey("moonbeam")).toBe("coingecko:moonbeam");
  });

  it("разбирает цену, тикер, доверие и час самой цены", () => {
    const m = parseLlamaPrices({
      coins: { "coingecko:moonbeam": { price: 0.0065, symbol: "GLMR", timestamp: 1795160472, confidence: 0.999 } },
    });
    expect(m.get("moonbeam")).toMatchObject({ priceUsd: 0.0065, symbol: "GLMR", confidence: 0.999 });
    expect(m.get("moonbeam")?.at?.getTime()).toBe(1795160472 * 1000);
  });

  it("запись без цены не берётся", () => {
    expect(parseLlamaPrices({ coins: { "coingecko:x": { symbol: "X" } } }).size).toBe(0);
    expect(parseLlamaPrices({ coins: { "coingecko:x": { price: 0, symbol: "X" } } }).size).toBe(0);
  });

  it("ответ не того вида даёт пустую карту, а не исключение", () => {
    expect(parseLlamaPrices(null).size).toBe(0);
    expect(parseLlamaPrices({ coins: "нет" }).size).toBe(0);
  });

  it("опора берётся только при сошедшемся тикере", () => {
    const row = { priceUsd: 0.0065, symbol: "GLMR", confidence: 0.99, at: new Date() };
    expect(pickReference(row, "GLMR")).toBe(0.0065);
    expect(pickReference(row, "DOT")).toBeNull();
  });

  it("тикер сверяется без учёта регистра и пробелов", () => {
    expect(pickReference({ priceUsd: 1, symbol: "glmr", confidence: 0.99, at: new Date() }, " GLMR ")).toBe(1);
  });

  it("запись без тикера опорой не считается", () => {
    expect(pickReference({ priceUsd: 1, symbol: null, confidence: 0.99, at: new Date() }, "GLMR")).toBeNull();
  });

  it("низкое доверие опорой не считается", () => {
    expect(pickReference({ priceUsd: 1, symbol: "GLMR", confidence: 0.2, at: new Date() }, "GLMR")).toBeNull();
    expect(DL_MIN_CONFIDENCE).toBe(0.9);
  });

  it("неизвестное доверие опору не отменяет", () => {
    expect(pickReference({ priceUsd: 1, symbol: "GLMR", confidence: null, at: new Date() }, "GLMR")).toBe(1);
  });

  it("спрашивает пачками и складывает ответы", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ coins: { "coingecko:a": { price: 1, symbol: "A", confidence: 0.99 } } }),
        text: async () => "",
      };
    });
    const ids = Array.from({ length: 120 }, (_, i) => `coin${i}`);
    const m = await fetchLlamaPrices(ids, { fetchImpl: fetchImpl as never, gate: gate() });
    expect(seen).toHaveLength(3); // 50 + 50 + 20
    expect(m.size).toBe(1);
  });

  it("сбой пачки остальные не роняет", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n === 1) return { ok: false, status: 404, json: async () => ({}), text: async () => "no" };
      return {
        ok: true,
        status: 200,
        json: async () => ({ coins: { "coingecko:b": { price: 2, symbol: "B", confidence: 0.99 } } }),
        text: async () => "",
      };
    });
    const ids = Array.from({ length: 60 }, (_, i) => `coin${i}`);
    const m = await fetchLlamaPrices(ids, { fetchImpl: fetchImpl as never, gate: gate() });
    expect(m.get("b")?.priceUsd).toBe(2);
  });

  it("у клиента есть срок запроса", () => {
    expect(DL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
