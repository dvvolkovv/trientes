import { describe, expect, it, vi } from "vitest";

import { LEDGER_TTL_SECONDS, dayWindow, monthWindow, noteCall, quotaKey, readSpend } from "@/lib/quota/ledger";

const now = new Date(Date.UTC(2026, 10, 20, 12, 0, 0));

function fakeRedis() {
  const store = new Map<string, number>();
  return {
    store,
    incr: vi.fn(async (k: string) => {
      const v = (store.get(k) ?? 0) + 1;
      store.set(k, v);
      return v;
    }),
    expire: vi.fn(async () => 1),
    get: vi.fn(async (k: string) => (store.has(k) ? String(store.get(k)) : null)),
  };
}

describe("счётчик вызовов", () => {
  it("окна считаются по UTC", () => {
    expect(monthWindow(now)).toBe("2026-11");
    expect(dayWindow(now)).toBe("2026-11-20");
  });

  it("ключ несёт службу, назначение и окно", () => {
    expect(quotaKey("coinpaprika", "bg", "2026-11")).toBe("quota:coinpaprika:bg:2026-11");
  });

  it("один вызов тикает оба окна", async () => {
    const r = fakeRedis();
    await noteCall(r, "coinpaprika", "bg", now);
    expect(r.store.get("quota:coinpaprika:bg:2026-11")).toBe(1);
    expect(r.store.get("quota:coinpaprika:bg:2026-11-20")).toBe(1);
    expect(r.expire).toHaveBeenCalledWith("quota:coinpaprika:bg:2026-11", LEDGER_TTL_SECONDS);
  });

  it("назначения считаются раздельно", async () => {
    const r = fakeRedis();
    await noteCall(r, "coinpaprika", "bg", now);
    await noteCall(r, "coinpaprika", "ui", now);
    await noteCall(r, "coinpaprika", "ui", now);
    expect(await readSpend(r, "coinpaprika", now)).toEqual({ bgMonth: 1, bgToday: 1, uiMonth: 2, uiToday: 2 });
  });

  it("сбой Redis вызов не роняет: счётчик дешевле запроса", async () => {
    const r = {
      incr: vi.fn(async () => {
        throw new Error("down");
      }),
      expire: vi.fn(async () => 1),
      get: vi.fn(async () => null),
    };
    await expect(noteCall(r, "coingecko", "ui", now)).resolves.toBeUndefined();
  });

  it("нет Redis — остаток неизвестен, а не ноль", async () => {
    const r = {
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
      get: vi.fn(async () => {
        throw new Error("down");
      }),
    };
    expect(await readSpend(r, "coingecko", now)).toBeNull();
  });

  it("пустой счётчик — это ноль, а не неизвестно", async () => {
    const r = fakeRedis();
    expect(await readSpend(r, "coinlore", now)).toEqual({ bgMonth: 0, bgToday: 0, uiMonth: 0, uiToday: 0 });
  });

  it("негодное значение в ключе читается нулём, а не NaN", async () => {
    const r = fakeRedis();
    r.get = vi.fn(async () => "не число");
    expect(await readSpend(r, "coinlore", now)).toEqual({ bgMonth: 0, bgToday: 0, uiMonth: 0, uiToday: 0 });
  });
});
