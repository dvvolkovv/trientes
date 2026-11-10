import { describe, expect, it } from "vitest";
import { CG_UI_RETRY_DELAYS_MS, CgHttpError, cgGet, cgGetUi, type JsonFetch } from "@/lib/coingecko-http";
import { createRateGate } from "@/lib/rate-gate";

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

describe("cgGet", () => {
  const base = (c: ReturnType<typeof clock>) => ({
    sleep: c.sleep,
    jitter: () => 0.5,
    gate: createRateGate({ minIntervalMs: 0, sleep: c.sleep, now: c.now }),
  });

  it("строит адрес с параметрами и отдаёт разобранный JSON", async () => {
    const c = clock();
    const s = stub(res(200, { ok: true }));
    const out = await cgGet("/global", { vs_currency: "usd" }, { ...base(c), fetchImpl: s.impl });
    expect(out).toEqual({ ok: true });
    expect(s.urls[0]).toBe("https://api.coingecko.com/api/v3/global?vs_currency=usd");
  });

  it("повторяет 429 и отдаёт успех второй попытки", async () => {
    const c = clock();
    const s = stub(res(429, "rate limited"), res(200, { ok: true }));
    const out = await cgGet("/global", {}, { ...base(c), fetchImpl: s.impl, retryDelaysMs: [1_000] });
    expect(out).toEqual({ ok: true });
    expect(s.urls).toHaveLength(2);
    expect(c.slept).toEqual([1_000]);
  });

  it("повторяет 5xx", async () => {
    const c = clock();
    const s = stub(res(502, "bad gateway"), res(200, { ok: true }));
    await expect(
      cgGet("/global", {}, { ...base(c), fetchImpl: s.impl, retryDelaysMs: [1_000] }),
    ).resolves.toEqual({ ok: true });
    expect(s.urls).toHaveLength(2);
  });

  it("повторяет обрыв связи", async () => {
    const c = clock();
    const s = stub(new TypeError("fetch failed"), res(200, { ok: true }));
    await expect(
      cgGet("/global", {}, { ...base(c), fetchImpl: s.impl, retryDelaysMs: [1_000] }),
    ).resolves.toEqual({ ok: true });
    expect(s.urls).toHaveLength(2);
  });

  it("не повторяет 404 — это ответ сервиса, а не частота", async () => {
    const c = clock();
    const s = stub(res(404, "not found"));
    await expect(
      cgGet("/coins/nope", {}, { ...base(c), fetchImpl: s.impl, retryDelaysMs: [1_000] }),
    ).rejects.toBeInstanceOf(CgHttpError);
    expect(s.urls).toHaveLength(1);
    expect(c.slept).toEqual([]);
  });

  it("исчерпав повторы, сообщает путь, код и начало ответа", async () => {
    const c = clock();
    const s = stub(res(429, "limit"), res(429, "limit"), res(429, "limit"));
    await expect(
      cgGet("/global", {}, { ...base(c), fetchImpl: s.impl, retryDelaysMs: [1_000, 2_000] }),
    ).rejects.toThrow(/coingecko \/global 429: limit/);
    expect(s.urls).toHaveLength(3);
  });

  it("разводит одновременные запросы промежутком шлюза", async () => {
    const c = clock();
    const gate = createRateGate({ minIntervalMs: 1_200, sleep: c.sleep, now: c.now });
    const s = stub(res(200, 1), res(200, 2), res(200, 3));
    const opts = { fetchImpl: s.impl, sleep: c.sleep, jitter: () => 0.5, gate };
    await Promise.all([
      cgGet("/a", {}, opts),
      cgGet("/b", {}, opts),
      cgGet("/c", {}, opts),
    ]);
    expect(c.slept).toEqual([1_200, 1_200]);
    expect(s.urls.map((u) => new URL(u).pathname)).toEqual([
      "/api/v3/a",
      "/api/v3/b",
      "/api/v3/c",
    ]);
  });

  it("сбой одного запроса не запирает шлюз для следующих", async () => {
    const c = clock();
    const gate = createRateGate({ minIntervalMs: 0, sleep: c.sleep, now: c.now });
    const s = stub(res(404, "no"), res(200, { ok: true }));
    const opts = { fetchImpl: s.impl, sleep: c.sleep, jitter: () => 0.5, gate, retryDelaysMs: [] };
    const [first, second] = await Promise.allSettled([
      cgGet("/a", {}, opts),
      cgGet("/b", {}, opts),
    ]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("fulfilled");
  });

  it("ответ не-JSON считает сбоем связи и повторяет", async () => {
    const c = clock();
    const broken = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
      text: async () => "<html>",
    };
    const s = stub(broken, res(200, { ok: true }));
    await expect(
      cgGet("/global", {}, { ...base(c), fetchImpl: s.impl, retryDelaysMs: [1_000] }),
    ).resolves.toEqual({ ok: true });
    expect(s.urls).toHaveLength(2);
  });
});

describe("cgGetUi", () => {
  it("повторяет 429 один раз и быстро — страница не ждёт минуту", async () => {
    const c = clock();
    const s = stub(res(429, "limit"), res(200, { ok: true }));
    await expect(
      cgGetUi("/coins/btc/tickers", {}, { fetchImpl: s.impl, sleep: c.sleep, jitter: () => 0.5 }),
    ).resolves.toEqual({ ok: true });
    expect(CG_UI_RETRY_DELAYS_MS).toHaveLength(1);
    expect(c.slept).toEqual([CG_UI_RETRY_DELAYS_MS[0]]);
  });

  it("не стоит в очереди за медленным фоновым запросом", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const order: string[] = [];

    const slowBackground: JsonFetch = async () => {
      await held;
      order.push("background");
      return res(200, { background: true });
    };
    const fastUi: JsonFetch = async () => {
      order.push("ui");
      return res(200, { ui: true });
    };

    const background = cgGet("/coins/markets", {}, { fetchImpl: slowBackground });
    await expect(cgGetUi("/coins/btc/tickers", {}, { fetchImpl: fastUi })).resolves.toEqual({ ui: true });
    release();
    await background;

    expect(order).toEqual(["ui", "background"]);
  });
});
