import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redis: { status: "ready", connect: vi.fn(), get: vi.fn(), set: vi.fn() },
  ticker: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({ redis: mocks.redis }));
vi.mock("@/lib/exchange-binance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/exchange-binance")>();
  return { ...actual, fetchExchangeTicker: mocks.ticker };
});

import { cacheGet, cacheSet } from "@/lib/exchange-cache";
import { GET as tickerGET } from "@/app/api/exchange/ticker/route";

const ticker = { source: "binance", symbol: "ETHBTC", fetchedAt: 2, lastPrice: 0.0358, priceChangePercent: 1.24, volume: 10, quoteVolume: 0.358 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redis.status = "ready";
});

afterEach(() => vi.useRealTimers());

describe("exchange cache", () => {
  it("treats malformed JSON as a miss and clears its timer", async () => {
    vi.useFakeTimers();
    mocks.redis.get.mockResolvedValue("{broken");
    await expect(cacheGet("exchange:ticker:ETHBTC")).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("swallows rejected connect, get and set operations", async () => {
    mocks.redis.status = "wait";
    mocks.redis.connect.mockRejectedValue(new Error("connect failed"));
    await expect(cacheGet("key")).resolves.toBeNull();
    mocks.redis.status = "ready";
    mocks.redis.get.mockRejectedValue(new Error("get failed"));
    await expect(cacheGet("key")).resolves.toBeNull();
    mocks.redis.set.mockRejectedValue(new Error("set failed"));
    await expect(cacheSet("key", ticker, 5)).resolves.toBeUndefined();
  });

  it("bounds a hanging Redis connect", async () => {
    vi.useFakeTimers();
    mocks.redis.status = "wait";
    mocks.redis.connect.mockReturnValue(new Promise(() => {}));
    let settled = false;
    const pending = cacheGet("key").then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(250);
    expect(settled).toBe(true);
    await expect(pending).resolves.toBeNull();
    expect(mocks.redis.get).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fetches upstream data when Redis get hangs", async () => {
    vi.useFakeTimers();
    mocks.redis.get.mockReturnValue(new Promise(() => {}));
    mocks.redis.set.mockResolvedValue("OK");
    mocks.ticker.mockResolvedValue(ticker);
    let settled = false;
    const pending = tickerGET(new Request("https://trientes.org/api/exchange/ticker?symbol=ETHBTC"))
      .then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(250);
    expect(settled).toBe(true);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("x-cache")).toBe("miss");
    expect(mocks.ticker).toHaveBeenCalledWith("ETHBTC");
  });

  it("returns upstream data when Redis set hangs", async () => {
    vi.useFakeTimers();
    mocks.redis.get.mockResolvedValue(null);
    mocks.redis.set.mockReturnValue(new Promise(() => {}));
    mocks.ticker.mockResolvedValue(ticker);
    let settled = false;
    const pending = tickerGET(new Request("https://trientes.org/api/exchange/ticker?symbol=ETHBTC"))
      .then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(settled).toBe(true);
    const response = await pending;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(ticker);
    expect(vi.getTimerCount()).toBe(0);
  });
});
