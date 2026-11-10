import { describe, expect, it } from "vitest";
import { CpHttpError, cpGet } from "@/lib/coinpaprika-http";
import { createRateGate } from "@/lib/rate-gate";
import type { JsonFetch } from "@/lib/coingecko-http";

function clock(start = 10_000) {
  let t = start;
  const slept: number[] = [];
  return {
    now: () => t,
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
  };
}

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function stub(...queue: Array<ReturnType<typeof res> | Error>) {
  const urls: string[] = [];
  const impl: JsonFetch = async (url) => {
    urls.push(url);
    const next = queue.shift() ?? res(200, {});
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, urls };
}

describe("cpGet", () => {
  const base = (c: ReturnType<typeof clock>) => ({
    sleep: c.sleep,
    jitter: () => 0.5,
    gate: createRateGate({ minIntervalMs: 0, sleep: c.sleep, now: c.now }),
    retryDelaysMs: [1_000],
  });

  it("отдаёт разобранный JSON", async () => {
    const c = clock();
    const s = stub(res(200, [{ id: "binance" }]));
    await expect(cpGet("/exchanges", { ...base(c), fetchImpl: s.impl })).resolves.toEqual([
      { id: "binance" },
    ]);
    expect(s.urls[0]).toBe("https://api.coinpaprika.com/v1/exchanges");
  });

  it("повторяет 402 — у бесплатного тарифа это «приходи позже», а не отказ навсегда", async () => {
    const c = clock();
    const s = stub(res(402, "payment required"), res(200, []));
    await expect(cpGet("/exchanges", { ...base(c), fetchImpl: s.impl })).resolves.toEqual([]);
    expect(s.urls).toHaveLength(2);
    expect(c.slept).toEqual([1_000]);
  });

  it("повторяет 429 и 5xx", async () => {
    for (const status of [429, 503]) {
      const c = clock();
      const s = stub(res(status, "nope"), res(200, []));
      await expect(cpGet("/exchanges", { ...base(c), fetchImpl: s.impl })).resolves.toEqual([]);
      expect(s.urls).toHaveLength(2);
    }
  });

  it("не повторяет 404 и несёт код в ошибке", async () => {
    const c = clock();
    const s = stub(res(404, "no such exchange"));
    await expect(
      cpGet("/exchanges/nope", { ...base(c), fetchImpl: s.impl }),
    ).rejects.toMatchObject({ status: 404 });
    expect(s.urls).toHaveLength(1);
  });

  it("ошибка — экземпляр CpHttpError с читаемым текстом", async () => {
    const c = clock();
    const s = stub(res(404, "no"));
    const err = await cpGet("/exchanges/nope", { ...base(c), fetchImpl: s.impl }).catch((e) => e);
    expect(err).toBeInstanceOf(CpHttpError);
    expect(String(err)).toContain("coinpaprika /exchanges/nope 404");
  });
});
