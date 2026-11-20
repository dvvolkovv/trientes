import { describe, expect, it, vi } from "vitest";

import { cgGet, cgGetUi } from "@/lib/coingecko-http";
import { cpGet, resetCpQuotaBlock } from "@/lib/coinpaprika-http";
import { countCall, resetQuotaCounter, setQuotaCounter } from "@/lib/quota/count";
import { createRateGate } from "@/lib/rate-gate";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });
const gate = () => createRateGate({ minIntervalMs: 0, sleep: async () => {}, now: () => 0 });

function spy() {
  const seen: string[] = [];
  setQuotaCounter(async (s, scope) => {
    seen.push(`${s}:${scope}`);
  });
  return seen;
}

describe("счёт вызовов в дверях служб", () => {
  it("без установленного счётчика вызов проходит молча", async () => {
    resetQuotaCounter();
    await expect(countCall("coingecko", "bg")).resolves.toBeUndefined();
  });

  it("cgGet считает фоновый вызов", async () => {
    const seen = spy();
    await cgGet("/ping", {}, { fetchImpl: vi.fn(async () => ok({})) as never, gate: gate() });
    expect(seen).toEqual(["coingecko:bg"]);
    resetQuotaCounter();
  });

  it("cgGetUi считает чтение посетителя", async () => {
    const seen = spy();
    await cgGetUi("/ping", {}, { fetchImpl: vi.fn(async () => ok({})) as never, gate: gate() });
    expect(seen).toEqual(["coingecko:ui"]);
    resetQuotaCounter();
  });

  it("повтор после 429 считается отдельным вызовом: служба считает его тоже", async () => {
    const seen = spy();
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return n === 1
        ? { ok: false, status: 429, json: async () => ({}), text: async () => "slow down" }
        : ok({});
    });
    await cgGet("/ping", {}, {
      fetchImpl: fetchImpl as never,
      gate: gate(),
      sleep: async () => {},
      retryDelaysMs: [1],
    });
    expect(seen).toEqual(["coingecko:bg", "coingecko:bg"]);
    resetQuotaCounter();
  });

  it("cpGet считает свой вызов своей службе", async () => {
    resetCpQuotaBlock();
    const seen = spy();
    await cpGet("/exchanges", { fetchImpl: vi.fn(async () => ok([])) as never, gate: gate() });
    expect(seen).toEqual(["coinpaprika:bg"]);
    resetQuotaCounter();
  });

  it("запрос, не ушедший в сеть, не считается", async () => {
    resetCpQuotaBlock();
    const seen = spy();
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 402,
      json: async () => ({}),
      text: async () => "This plan has 20000 monthly requests limit, your requests rate is: 20003",
    }));
    await expect(cpGet("/exchanges", { fetchImpl: fetchImpl as never, gate: gate() })).rejects.toThrow();
    const afterFirst = seen.length;
    expect(afterFirst).toBe(1);
    // Второй вызов под запретом по исчерпанному запасу: в сеть он не уходит,
    // значит и запаса не тратит — считать его было бы ложью в обе стороны.
    await expect(cpGet("/exchanges", { fetchImpl: fetchImpl as never, gate: gate() })).rejects.toThrow();
    expect(seen).toHaveLength(afterFirst);
    resetCpQuotaBlock();
    resetQuotaCounter();
  });

  it("сбой счётчика запрос не роняет", async () => {
    setQuotaCounter(async () => {
      throw new Error("redis down");
    });
    const r = await cgGet("/ping", {}, { fetchImpl: vi.fn(async () => ok({ pong: 1 })) as never, gate: gate() });
    expect(r).toEqual({ pong: 1 });
    resetQuotaCounter();
  });
});
