import { describe, expect, it } from "vitest";
import {
  ExchangeApiError,
  fetchExchangeKlines,
  fetchExchangeTicker,
  parseInterval,
  parseKlines,
  parseLimit,
  parseSymbol,
  parseTicker,
} from "@/lib/exchange-binance";

const row = [1_793_799_600_000, "0.035", "0.036", "0.034", "0.0358", "123.45", 0, 0, 0, 0, 0, 0];
const statusOf = (run: () => unknown): number => {
  try {
    run();
    return 0;
  } catch (error) {
    return error instanceof ExchangeApiError ? error.status : 0;
  }
};

describe("exchange Binance input", () => {
  it("accepts only explicit symbols, intervals and integer limits", () => {
    expect(parseSymbol("ethbtc")).toBe("ETHBTC");
    expect(parseInterval("1h")).toBe("1h");
    expect(parseLimit("720")).toBe(720);
    for (const bad of [null, "", "ETH/BTC", "ETHBTC?x=1", "A".repeat(31)]) {
      expect(statusOf(() => parseSymbol(bad))).toBe(400);
    }
    expect(statusOf(() => parseInterval("2h"))).toBe(400);
    for (const bad of ["0", "1001", "1.5", "abc", ""]) {
      expect(statusOf(() => parseLimit(bad))).toBe(400);
    }
  });
});

describe("exchange Binance responses", () => {
  it("parses oldest-first OHLCV and 24h ticker as finite numbers", () => {
    expect(parseKlines([row])).toEqual([{ time: 1_793_799_600, open: 0.035, high: 0.036, low: 0.034, close: 0.0358, volume: 123.45 }]);
    expect(parseTicker({ lastPrice: "0.0358", priceChangePercent: "1.24", volume: "184209.1", quoteVolume: "6598.2" })).toEqual({
      lastPrice: 0.0358,
      priceChangePercent: 1.24,
      volume: 184209.1,
      quoteVolume: 6598.2,
    });
  });

  it("rejects malformed candles instead of drawing NaN or inverted data", () => {
    expect(statusOf(() => parseKlines({}))).toBe(502);
    expect(statusOf(() => parseKlines([[1_793_799_600_000, "2", "1", "3", "2", "4"]]))).toBe(502);
    expect(statusOf(() => parseKlines([[1_793_799_600_000, "1", "2", "0.5", "NaN", "4"]]))).toBe(502);
  });

  it("rejects non-numeric coercions in candle time, volume and ticker fields", () => {
    for (const bad of [null, "", " ", false, []]) {
      expect(statusOf(() => parseKlines([[bad, "1", "2", "0.5", "1.5", "4"]]))).toBe(502);
      expect(statusOf(() => parseKlines([[1_793_799_600_000, "1", "2", "0.5", "1.5", bad]]))).toBe(502);
      expect(statusOf(() => parseTicker({ lastPrice: "1", priceChangePercent: bad, volume: "2", quoteVolume: "3" }))).toBe(502);
      expect(statusOf(() => parseTicker({ lastPrice: "1", priceChangePercent: "1", volume: "2", quoteVolume: bad }))).toBe(502);
    }
  });

  it("accepts decimal numeric strings only", () => {
    for (const bad of ["0x10", "0b10", "0o10", "NaN", "Infinity", "1e", "12abc"]) {
      expect(statusOf(() => parseTicker({ lastPrice: "1", priceChangePercent: bad, volume: "2", quoteVolume: "3" }))).toBe(502);
    }
    expect(parseTicker({ lastPrice: " +1.25e-2 ", priceChangePercent: "-1.5E+1", volume: ".5", quoteVolume: "2." })).toEqual({
      lastPrice: 0.0125,
      priceChangePercent: -15,
      volume: 0.5,
      quoteVolume: 2,
    });
  });

  it("requires safe nonnegative integer candle milliseconds", () => {
    for (const bad of [1_793_799_600_000.5, -1, Number.MAX_VALUE]) {
      expect(statusOf(() => parseKlines([[bad, "1", "2", "0.5", "1.5", "4"]]))).toBe(502);
    }
  });

  it("maps only Binance error -1121 to pair_unavailable", async () => {
    const missing = async () => new Response(JSON.stringify({ code: -1121, msg: "Invalid symbol." }), { status: 400 });
    await expect(fetchExchangeKlines("NOSUCHPAIR", "1h", 10, missing as typeof fetch)).rejects.toMatchObject({ status: 404, code: "pair_unavailable" });
  });

  it.each([
    { upstream: "another Binance 400 code", body: JSON.stringify({ code: -1100, msg: "Illegal characters" }) },
    { upstream: "non-JSON WAF 400", body: "<html>secret WAF response</html>" },
  ])("maps $upstream to 502 without treating it as a missing pair", async ({ body }) => {
    const badRequest = async () => new Response(body, { status: 400 });
    const error = await fetchExchangeTicker("ETHBTC", badRequest as typeof fetch).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 502, code: "upstream_unavailable", message: "upstream_unavailable" });
    expect(String(error)).not.toContain("secret WAF");
  });

  it("maps upstream rate limiting to 503", async () => {
    const limited = async () => new Response("rate limited", { status: 429 });
    await expect(fetchExchangeTicker("ETHBTC", limited as typeof fetch)).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    { upstream: "418 response", status: 503, code: "upstream_rate_limited", fetcher: async () => new Response("banned", { status: 418 }) },
    { upstream: "500 response", status: 502, code: "upstream_unavailable", fetcher: async () => new Response("broken", { status: 500 }) },
    { upstream: "rejected fetch", status: 502, code: "upstream_unavailable", fetcher: async () => { throw new Error("offline"); } },
    { upstream: "malformed JSON", status: 502, code: "upstream_shape", fetcher: async () => new Response("{", { status: 200 }) },
  ])("maps $upstream to $status", async ({ fetcher, status, code }) => {
    await expect(fetchExchangeTicker("ETHBTC", fetcher as typeof fetch)).rejects.toMatchObject({ status, code });
  });
});
