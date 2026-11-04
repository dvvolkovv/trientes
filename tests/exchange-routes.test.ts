import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  klines: vi.fn(),
  ticker: vi.fn(),
}));
vi.mock("@/lib/exchange-cache", () => ({ cacheGet: mocks.get, cacheSet: mocks.set }));
vi.mock("@/lib/exchange-binance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/exchange-binance")>();
  return { ...actual, fetchExchangeKlines: mocks.klines, fetchExchangeTicker: mocks.ticker };
});

import { GET as klinesGET } from "@/app/api/exchange/klines/route";
import { GET as tickerGET } from "@/app/api/exchange/ticker/route";
import { ExchangeApiError } from "@/lib/exchange-binance";

const freshKlines = { source: "binance", symbol: "ETHBTC", interval: "4h", fetchedAt: 2, candles: [] };
const freshTicker = { source: "binance", symbol: "ETHBTC", fetchedAt: 2, lastPrice: 0.0358, priceChangePercent: 1.24, volume: 10, quoteVolume: 0.358 };

beforeEach(() => vi.clearAllMocks());

describe("exchange routes", () => {
  it("rejects malformed input before cache or upstream", async () => {
    const response = await klinesGET(new Request("https://trientes.org/api/exchange/klines?symbol=ETH%2FBTC"));
    expect(response.status).toBe(400);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.klines).not.toHaveBeenCalled();
  });

  it("serves a cached klines response with x-cache: hit", async () => {
    mocks.get.mockResolvedValue({ source: "binance", symbol: "ETHBTC", interval: "1h", fetchedAt: 1, candles: [] });
    const response = await klinesGET(new Request("https://trientes.org/api/exchange/klines?symbol=ETHBTC&interval=1h&limit=720"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-cache")).toBe("hit");
    expect(mocks.klines).not.toHaveBeenCalled();
  });

  it("fetches and caches a ticker on a miss", async () => {
    mocks.get.mockResolvedValue(null);
    mocks.ticker.mockResolvedValue({ source: "binance", symbol: "ETHBTC", fetchedAt: 1, lastPrice: 0.0358, priceChangePercent: 1.24, volume: 10, quoteVolume: 0.358 });
    const response = await tickerGET(new Request("https://trientes.org/api/exchange/ticker?symbol=ETHBTC"));
    expect(response.status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith("exchange:ticker:ETHBTC", expect.anything(), 5);
  });

  it("replaces wrong-shaped cached klines with fresh upstream data", async () => {
    mocks.get.mockResolvedValue({ source: "binance", symbol: "ETHBTC", interval: "4h", fetchedAt: 1, candles: [{ time: "bad" }] });
    mocks.klines.mockResolvedValue(freshKlines);
    const response = await klinesGET(new Request("https://trientes.org/api/exchange/klines?symbol=ETHBTC&interval=4h&limit=25"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-cache")).toBe("miss");
    expect(mocks.klines).toHaveBeenCalledWith("ETHBTC", "4h", 25);
    expect(mocks.set).toHaveBeenCalledWith("exchange:klines:ETHBTC:4h:25", freshKlines, 300);
  });

  it.each([
    { symbol: "BTCUSDT", interval: "1h" },
    { symbol: "ETHBTC", interval: "4h" },
  ])("replaces cached klines for the wrong symbol or interval", async (cachedIdentity) => {
    mocks.get.mockResolvedValue({ source: "binance", ...cachedIdentity, fetchedAt: 1, candles: [] });
    mocks.klines.mockResolvedValue({ ...freshKlines, interval: "1h" });
    const response = await klinesGET(new Request("https://trientes.org/api/exchange/klines?symbol=ETHBTC&interval=1h&limit=500"));
    expect(response.headers.get("x-cache")).toBe("miss");
    expect(mocks.klines).toHaveBeenCalledOnce();
  });

  it("replaces a cached ticker for the wrong symbol", async () => {
    mocks.get.mockResolvedValue({ ...freshTicker, symbol: "BTCUSDT" });
    mocks.ticker.mockResolvedValue(freshTicker);
    const response = await tickerGET(new Request("https://trientes.org/api/exchange/ticker?symbol=ETHBTC"));
    expect(response.headers.get("x-cache")).toBe("miss");
    expect(mocks.ticker).toHaveBeenCalledWith("ETHBTC");
    expect(mocks.set).toHaveBeenCalledWith("exchange:ticker:ETHBTC", freshTicker, 5);
  });

  it.each([
    [404, "pair_unavailable"],
    [503, "upstream_rate_limited"],
    [502, "upstream_unavailable"],
  ])("returns only the normalized error for upstream status %i", async (status, code) => {
    mocks.get.mockResolvedValue(null);
    mocks.ticker.mockRejectedValue(new ExchangeApiError(status, code));
    const response = await tickerGET(new Request("https://trientes.org/api/exchange/ticker?symbol=ETHBTC"));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: code });
  });
});
