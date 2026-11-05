import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    status: "ready",
    connect: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    disconnect: vi.fn(),
    pending: new Set<(error: Error) => void>(),
  };
  return {
    client,
    Redis: vi.fn(function (..._args: unknown[]) { return client; }),
    shared: { get: vi.fn(), set: vi.fn(), connect: vi.fn() },
    ticker: vi.fn(),
  };
});
vi.mock("ioredis", () => ({ default: mocks.Redis }));
vi.mock("@/lib/redis", () => ({ redis: mocks.shared }));
vi.mock("@/lib/exchange-binance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/exchange-binance")>();
  return { ...actual, fetchExchangeTicker: mocks.ticker };
});

import type { cacheGet as CacheGet, cacheSet as CacheSet } from "@/lib/exchange-cache";
import type { GET as TickerGet } from "@/app/api/exchange/ticker/route";

let cacheGet: typeof CacheGet;
let cacheSet: typeof CacheSet;
let tickerGET: typeof TickerGet;
const ticker = { source: "binance", symbol: "ETHBTC", fetchedAt: 2, lastPrice: 0.0358, priceChangePercent: 1.24, volume: 10, quoteVolume: 0.358 };
const previousRedisUrl = process.env.REDIS_URL;

function hang() {
  return new Promise<never>((_, reject) => { mocks.client.pending.add(reject); });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.REDIS_URL = "redis://cache-test:6379/2";
  mocks.client.status = "ready";
  mocks.client.pending.clear();
  mocks.client.connect.mockImplementation(async () => { mocks.client.status = "ready"; });
  mocks.client.get.mockResolvedValue(null);
  mocks.client.set.mockResolvedValue("OK");
  mocks.client.disconnect.mockImplementation(() => {
    mocks.client.status = "end";
    for (const reject of mocks.client.pending) reject(new Error("disconnected"));
    mocks.client.pending.clear();
  });
  ({ cacheGet, cacheSet } = await import("@/lib/exchange-cache"));
  ({ GET: tickerGET } = await import("@/app/api/exchange/ticker/route"));
});

afterEach(() => {
  vi.useRealTimers();
  if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = previousRedisUrl;
});

describe("exchange cache", () => {
  it("uses a dedicated bounded client and never the shared site Redis", async () => {
    mocks.client.get.mockResolvedValue(JSON.stringify(ticker));
    await expect(cacheGet("key")).resolves.toEqual(ticker);
    await cacheSet("key", ticker, 5);
    expect(mocks.Redis).toHaveBeenCalledWith("redis://cache-test:6379/2", expect.objectContaining({
      lazyConnect: true,
      enableOfflineQueue: false,
      commandTimeout: 250,
      connectTimeout: 250,
      maxRetriesPerRequest: 0,
    }));
    const options = mocks.Redis.mock.calls[0]?.[1] as { retryStrategy: () => null };
    expect(options.retryStrategy()).toBeNull();
    expect(mocks.shared.connect).not.toHaveBeenCalled();
    expect(mocks.shared.get).not.toHaveBeenCalled();
    expect(mocks.shared.set).not.toHaveBeenCalled();
    expect(mocks.client.set).toHaveBeenCalledWith("key", JSON.stringify(ticker), "EX", 5);
  });

  it("does not issue commands while the client is connecting", async () => {
    mocks.client.status = "connecting";
    await expect(cacheGet("key")).resolves.toBeNull();
    await cacheSet("key", ticker, 5);
    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.set).not.toHaveBeenCalled();
    expect(mocks.Redis).toHaveBeenCalledTimes(1);
  });

  it("treats malformed JSON as an ordinary miss and overwrites it without opening the circuit", async () => {
    vi.useFakeTimers();
    mocks.client.get.mockResolvedValueOnce("{broken");
    await expect(cacheGet("key")).resolves.toBeNull();
    await cacheSet("key", ticker, 5);
    mocks.client.get.mockResolvedValue(JSON.stringify(ticker));
    await expect(cacheGet("key")).resolves.toEqual(ticker);
    expect(mocks.client.set).toHaveBeenCalledWith("key", JSON.stringify(ticker), "EX", 5);
    expect(mocks.client.disconnect).not.toHaveBeenCalled();
    expect(mocks.Redis).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["connect", "get", "set"])("swallows rejected %s operations", async (operation) => {
    if (operation === "connect") {
      mocks.client.status = "wait";
      mocks.client.connect.mockRejectedValue(new Error("connect failed"));
      await expect(cacheGet("key")).resolves.toBeNull();
    } else if (operation === "get") {
      mocks.client.get.mockRejectedValue(new Error("get failed"));
      await expect(cacheGet("key")).resolves.toBeNull();
    } else {
      mocks.client.set.mockRejectedValue(new Error("set failed"));
      await expect(cacheSet("key", ticker, 5)).resolves.toBeUndefined();
    }
    expect(mocks.client.disconnect).toHaveBeenCalled();
  });

  it("disconnects a hanging connect and opens the circuit without new commands", async () => {
    vi.useFakeTimers();
    mocks.client.status = "wait";
    mocks.client.connect.mockImplementation(hang);
    const pending = cacheGet("key");
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toBeNull();
    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.disconnect).toHaveBeenCalled();
    expect(mocks.client.pending.size).toBe(0);
    await cacheGet("other");
    await cacheSet("other", ticker, 5);
    expect(mocks.Redis).toHaveBeenCalledTimes(1);
    expect(mocks.client.connect).toHaveBeenCalledTimes(1);
    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.set).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries successfully after the circuit interval", async () => {
    vi.useFakeTimers();
    mocks.client.get.mockImplementation(hang);
    const failed = cacheGet("key");
    await vi.advanceTimersByTimeAsync(250);
    await expect(failed).resolves.toBeNull();
    await expect(cacheGet("key")).resolves.toBeNull();
    expect(mocks.Redis).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    mocks.client.status = "ready";
    mocks.client.get.mockResolvedValue(JSON.stringify(ticker));
    await expect(cacheGet("key")).resolves.toEqual(ticker);
    expect(mocks.Redis).toHaveBeenCalledTimes(2);
  });

  it("bounds concurrent hanging commands without accumulating pending work", async () => {
    vi.useFakeTimers();
    mocks.client.get.mockImplementation(hang);
    const first = Array.from({ length: 25 }, (_, index) => cacheGet(`key:${index}`));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.client.get).toHaveBeenCalledTimes(25);
    expect(mocks.client.pending.size).toBe(25);
    await vi.advanceTimersByTimeAsync(250);
    await expect(Promise.all(first)).resolves.toEqual(Array(25).fill(null));
    expect(mocks.client.pending.size).toBe(0);
    const second = Array.from({ length: 25 }, (_, index) => cacheGet(`circuit:${index}`));
    await expect(Promise.all(second)).resolves.toEqual(Array(25).fill(null));
    expect(mocks.client.get).toHaveBeenCalledTimes(25);
    expect(mocks.client.pending.size).toBe(0);
    expect(mocks.Redis).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fetches upstream data when Redis get hangs", async () => {
    vi.useFakeTimers();
    mocks.client.get.mockImplementation(hang);
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
    mocks.client.set.mockImplementation(hang);
    mocks.ticker.mockResolvedValue(ticker);
    let settled = false;
    const pending = tickerGET(new Request("https://trientes.org/api/exchange/ticker?symbol=ETHBTC"))
      .then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(250);
    expect(settled).toBe(true);
    const response = await pending;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(ticker);
    expect(mocks.client.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
